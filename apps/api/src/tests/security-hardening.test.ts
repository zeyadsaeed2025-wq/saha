import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Integration coverage for the Phase B security repairs, driven over localhost
// with the local JSON adapter. No PostgreSQL, SMS or email provider is used.
const dataFile = join(tmpdir(), `saha-security-tests-${process.pid}.json`);
process.env.LOCAL_DATA_FILE = dataFile;
delete process.env.DATA_ADAPTER;
process.env.COOKIE_SECURE = 'false';
process.env.APP_URL = 'http://localhost:5173';
delete process.env.SESSION_SECRET;

const { store } = await import('../common/store.js');
const { createApp } = await import('../app.js');
const { findSessionByWorldCredential, isWorldOnlySession, otpCodeHash, safeEqualHex, sha256 } =
  await import('../common/security.js');

const PASSWORD = 'Passw0rd!';
let server: Server;
let baseUrl = '';

beforeAll(async () => {
  server = createApp().listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  server.closeAllConnections();
  rmSync(dataFile, { force: true });
});

beforeEach(() => store.reset());
afterEach(() => vi.useRealTimers());

class Jar {
  private readonly cookies = new Map<string, string>();

  ingest(response: Response): void {
    for (const raw of response.headers.getSetCookie()) {
      const [pair] = raw.split(';');
      const at = pair.indexOf('=');
      if (at < 0) continue;
      const name = pair.slice(0, at).trim();
      const value = pair.slice(at + 1).trim();
      if (!value || /expires=Thu, 01 Jan 1970/i.test(raw)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  get(name: string): string | undefined { return this.cookies.get(name); }

  header(): string { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '); }
}

interface Result {
  status: number;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any -- test helper parses arbitrary JSON
  raw: string;
  headers: Headers;
}

async function api(jar: Jar | null, method: string, path: string, body?: unknown,
  options: { csrf?: boolean; cookie?: string; headers?: Record<string, string> } = {}): Promise<Result> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const cookie = options.cookie ?? jar?.header() ?? '';
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const csrf = jar?.get('saha_csrf');
  if ((options.csrf ?? true) && !['GET', 'HEAD', 'OPTIONS'].includes(method) && csrf) {
    headers['x-csrf-token'] = csrf;
  }
  Object.assign(headers, options.headers);
  const response = await fetch(`${baseUrl}${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  jar?.ingest(response);
  const raw = await response.text();
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { parsed = raw; }
  return { status: response.status, body: parsed, raw, headers: response.headers };
}

async function register(name: string, phone: string): Promise<Jar> {
  const jar = new Jar();
  const result = await api(jar, 'POST', '/api/auth/register', { name, phone, password: PASSWORD }, { csrf: false });
  expect(result.status, result.raw).toBe(201);
  return jar;
}

async function login(phone: string): Promise<Jar> {
  const jar = new Jar();
  const result = await api(jar, 'POST', '/api/auth/login', { phone, password: PASSWORD }, { csrf: false });
  expect(result.status, result.raw).toBe(200);
  return jar;
}

async function owner(name: string, phone: string) {
  const jar = await register(name, phone);
  await api(jar, 'POST', '/api/auth/login', { phone, password: PASSWORD }, { csrf: false });
  const created = await api(jar, 'POST', '/api/orgs', { name: `${name} Org`, timezone: 'UTC' });
  expect(created.status, created.raw).toBe(201);
  const orgId = created.body.organization.id as string;
  const workspaces = await api(jar, 'GET', `/api/orgs/${orgId}/workspaces`);
  const workspaceId = workspaces.body.workspaces[0].id as string;
  const detail = await api(jar, 'GET', `/api/orgs/${orgId}/workspaces/${workspaceId}`);
  return { jar, orgId, workspaceId, roomId: detail.body.rooms[0].id as string };
}

async function addStudent(admin: Jar, orgId: string, phone: string) {
  const created = await api(admin, 'POST', `/api/orgs/${orgId}/members`, {
    phone, name: 'Sample Student', role: 'student', team: 'Learners',
  });
  expect(created.status, created.raw).toBe(201);
  const jar = new Jar();
  const student = await api(jar, 'POST', '/api/auth/login',
    { phone, password: created.body.temporaryPassword }, { csrf: false });
  expect(student.status, student.raw).toBe(200);
  const me = await api(jar, 'GET', '/api/auth/me');
  return { jar, userId: me.body.user.id as string };
}

describe('Phase B backend security repairs (local JSON adapter; not PostgreSQL)', () => {
  it('keeps session, CSRF and WS tickets separate and world-only', async () => {
    const jar = await register('Split Tester', '+15551000001');
    const sessionToken = jar.get('saha_session')!;
    const csrfToken = jar.get('saha_csrf')!;
    expect(sessionToken).toBeTruthy();
    expect(csrfToken).toBeTruthy();
    expect(csrfToken).not.toBe(sessionToken);

    const ticketResult = await api(jar, 'POST', '/api/auth/ws-ticket', {});
    expect(ticketResult.status, ticketResult.raw).toBe(200);
    const { ticket, expiresAt } = ticketResult.body;
    expect(ticket).not.toBe(sessionToken);
    expect(ticket).not.toBe(csrfToken);
    expect(Date.parse(expiresAt) - Date.now()).toBeLessThanOrEqual(10 * 60 * 1000);

    const state = store.read((draft) => draft);
    for (const credential of [csrfToken, ticket]) {
      const resolved = findSessionByWorldCredential(state, credential);
      expect(resolved).not.toBeNull();
      expect(isWorldOnlySession(resolved!.id)).toBe(true);
      expect((resolved as { worldOnly?: boolean }).worldOnly).toBe(true); // survives restarts
      const spoofed = await api(null, 'GET', '/api/auth/me', undefined, { cookie: `saha_session=${credential}` });
      expect(spoofed.status).toBe(401);
    }
    expect(findSessionByWorldCredential(state, sessionToken)?.id).toBeTruthy();
    expect(isWorldOnlySession(findSessionByWorldCredential(state, sessionToken)!.id)).toBe(false);

    const noCsrf = await api(jar, 'POST', '/api/orgs', { name: 'No CSRF', timezone: 'UTC' }, { csrf: false });
    expect(noCsrf.status).toBe(403);
    const withCsrf = await api(jar, 'POST', '/api/orgs', { name: 'With CSRF', timezone: 'UTC' });
    expect(withCsrf.status, withCsrf.raw).toBe(201);
    expect((await api(jar, 'GET', '/api/auth/me')).body.activeOrgId).toBe(withCsrf.body.organization.id);
  });

  it('hardens OTP issue/reset and revokes other sessions', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-05-01T00:00:00.000Z'));
    const phone = '+15551000002';
    await register('OTP Tester', phone);
    const firstSession = await login(phone);
    const secondSession = await login(phone);

    const first = await api(null, 'POST', '/api/auth/forgot', { phone }, { csrf: false });
    expect(first.status, first.raw).toBe(200);
    const codeA = first.body.devCode as string;
    expect(codeA).toMatch(/^\d{6}$/);
    const firstOtp = store.read((state) => state.otps[0]);
    expect(firstOtp.codeHash).not.toBe(sha256(codeA));
    expect(safeEqualHex(otpCodeHash(codeA, sha256(phone)), firstOtp.codeHash)).toBe(true);

    vi.setSystemTime(new Date('2026-05-01T00:01:01.000Z'));
    const second = await api(null, 'POST', '/api/auth/forgot', { phone }, { csrf: false });
    const codeB = second.body.devCode as string;
    expect(codeB).toMatch(/^\d{6}$/);
    const otps = store.read((state) => state.otps);
    expect(otps).toHaveLength(2);
    expect(otps[0].consumedAt).not.toBeNull(); // superseded codes are invalidated
    expect(otps[1].consumedAt).toBeNull();

    const stale = await api(null, 'POST', '/api/auth/reset',
      { phone, code: codeA, newPassword: 'NewPassw0rd!' }, { csrf: false });
    expect(stale.status).toBe(400);

    const reset = await api(null, 'POST', '/api/auth/reset',
      { phone, code: codeB, newPassword: 'NewPassw0rd!' }, { csrf: false });
    expect(reset.status, reset.raw).toBe(200);
    expect((await api(firstSession, 'GET', '/api/auth/me')).status).toBe(401);
    expect((await api(secondSession, 'GET', '/api/auth/me')).status).toBe(401);
    expect((await api(null, 'POST', '/api/auth/login', { phone, password: PASSWORD }, { csrf: false })).status).toBe(401);
    expect((await api(null, 'POST', '/api/auth/login',
      { phone, password: 'NewPassw0rd!' }, { csrf: false })).status).toBe(200);
    const state = store.read((draft) => draft);
    expect(state.auditLogs.some((log) => log.action === 'session.revoked_after_reset')).toBe(true);
  });

  it('throttles OTP sending and caps verification attempts', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-05-01T00:00:00.000Z'));
    const phone = '+15551000008';
    await register('Throttle Tester', phone);

    const first = await api(null, 'POST', '/api/auth/forgot', { phone }, { csrf: false });
    const code = first.body.devCode as string;
    expect(code).toMatch(/^\d{6}$/);
    const immediate = await api(null, 'POST', '/api/auth/forgot', { phone }, { csrf: false });
    expect(immediate.body.devCode).toBeUndefined();
    expect(store.read((state) => state.otps)).toHaveLength(1);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, '0');
      expect((await api(null, 'POST', '/api/auth/reset',
        { phone, code: wrong, newPassword: 'NewPassw0rd!' }, { csrf: false })).status).toBe(400);
    }
    const capped = await api(null, 'POST', '/api/auth/reset',
      { phone, code, newPassword: 'NewPassw0rd!' }, { csrf: false });
    expect(capped.status).toBe(400);
    expect(store.read((state) => state.otps[0].attempts)).toBe(5);
  });

  it('validates access links, hides subjects and revokes guest sessions', async () => {
    const admin = await owner('Link Owner', '+15551000003');
    const subject = await addStudent(admin.jar, admin.orgId, '+15551000004');
    const foreignRoom = randomUUID();

    const badRoom = await api(admin.jar, 'POST', `/api/orgs/${admin.orgId}/access-links`, {
      kind: 'public_guest', workspaceId: admin.workspaceId, roomId: foreignRoom,
    });
    expect(badRoom.status).toBe(400);
    const badSubject = await api(admin.jar, 'POST', `/api/orgs/${admin.orgId}/access-links`, {
      kind: 'passwordless_member', workspaceId: admin.workspaceId, subjectUserId: randomUUID(),
    });
    expect(badSubject.status).toBe(400);

    const memberLink = await api(admin.jar, 'POST', `/api/orgs/${admin.orgId}/access-links`, {
      kind: 'passwordless_member', workspaceId: admin.workspaceId, subjectUserId: subject.userId,
    });
    expect(memberLink.status, memberLink.raw).toBe(201);
    expect(memberLink.body.link.maxUses).toBe(1);
    expect(Date.parse(memberLink.body.link.expiresAt) - Date.now()).toBeLessThanOrEqual(4 * 3_600_000 + 1000);
    const info = await api(null, 'GET', `/api/access/${memberLink.body.token}/info`);
    expect(info.body.kind).toBe('passwordless_member');
    expect(info.body.subjectName).toBeUndefined();

    const guestLink = await api(admin.jar, 'POST', `/api/orgs/${admin.orgId}/access-links`, {
      kind: 'public_guest', workspaceId: admin.workspaceId, roomId: admin.roomId,
    });
    expect(guestLink.status, guestLink.raw).toBe(201);
    const guest = new Jar();
    const redeemed = await api(guest, 'POST', `/api/access/${guestLink.body.token}/redeem`, {}, { csrf: false });
    expect(redeemed.status, redeemed.raw).toBe(200);
    expect((await api(guest, 'GET', '/api/auth/me')).body.isGuest).toBe(true);

    const guestMe = await api(guest, 'GET', '/api/auth/me');
    expect(guestMe.body.organization.settings).toBeUndefined();
    expect(guestMe.body.organization.id).toBe(admin.orgId);

    const revoked = await api(admin.jar, 'POST', `/api/orgs/${admin.orgId}/access-links/${guestLink.body.link.id}/revoke`, {});
    expect(revoked.status, revoked.raw).toBe(200);
    expect((await api(guest, 'GET', '/api/auth/me')).status).toBe(401);
  });

  it('scopes reports and attendance and neutralizes CSV formulas', async () => {
    const admin = await owner('Report Owner', '+15551000005');
    const student = await addStudent(admin.jar, admin.orgId, '+15551000006');
    const day = '2026-06-01';
    const adminId = (await api(admin.jar, 'GET', '/api/auth/me')).body.user.id as string;
    await store.mutate((draft) => {
      const make = (userId: string, note: string) => {
        const scheduledId = randomUUID();
        draft.scheduledSessions.push({
          id: scheduledId, organizationId: admin.orgId, scheduleRuleId: randomUUID(), userId,
          kind: 'shift', title: 'Test shift', startsAt: `${day}T09:00:00.000Z`,
          endsAt: `${day}T10:00:00.000Z`, graceMinutes: 10, minimumMinutes: 60,
          status: 'scheduled', policySnapshot: {}, createdAt: `${day}T08:00:00.000Z`,
        });
        draft.attendanceSessions.push({
          id: randomUUID(), organizationId: admin.orgId, scheduledSessionId: scheduledId, userId,
          firstJoin: `${day}T09:00:00.000Z`, lastLeave: `${day}T10:00:00.000Z`, lastHeartbeat: null,
          status: 'on_time', rawLatenessSeconds: 0, countedLatenessSeconds: 0,
          confirmedConnectedSeconds: 3600, breakSeconds: 0, earlyLeaveSeconds: 0,
          finalizedAt: null, note, createdAt: `${day}T09:00:00.000Z`,
        });
      };
      make(adminId, '=HYPERLINK("https://evil.test")');
      make(student.userId, 'normal note');
    });

    const adminRows = await api(admin.jar, 'GET', `/api/orgs/${admin.orgId}/reports/sessions`);
    expect(adminRows.body.sessions).toHaveLength(2);
    const studentRows = await api(student.jar, 'GET', `/api/orgs/${admin.orgId}/reports/sessions`);
    expect(studentRows.body.sessions).toHaveLength(1);
    expect(studentRows.body.sessions[0].userId).toBe(student.userId);

    const studentAttendance = await api(student.jar, 'GET', `/api/orgs/${admin.orgId}/attendance`);
    expect(studentAttendance.body.sessions).toHaveLength(1);
    expect(studentAttendance.body.sessions[0].userId).toBe(student.userId);
    const studentCsv = await api(student.jar, 'GET', `/api/orgs/${admin.orgId}/reports/export.csv`);
    expect(studentCsv.status).toBe(403);

    const csv = await api(admin.jar, 'GET', `/api/orgs/${admin.orgId}/reports/export.csv`);
    expect(csv.status, csv.raw).toBe(200);
    expect(csv.raw).toContain('"\'=HYPERLINK');
    expect(csv.raw).not.toContain('"=HYPERLINK');
  });

  it('revalidates schedules, caps ranges and uses the rule timezone', async () => {
    const admin = await owner('Schedule Owner', '+15551000007');
    const created = await api(admin.jar, 'POST', `/api/orgs/${admin.orgId}/schedules`, {
      userId: (await api(admin.jar, 'GET', '/api/auth/me')).body.user.id,
      kind: 'shift', title: 'NY shift', days: [0, 1], startTime: '09:00', endTime: '10:00',
      timezone: 'America/New_York', graceMinutes: 10, minimumMinutes: 60,
    });
    expect(created.status, created.raw).toBe(201);
    const ruleId = created.body.schedule.id as string;

    const badTz = await api(admin.jar, 'PATCH', `/api/orgs/${admin.orgId}/schedules/${ruleId}`, { timezone: 'Mars/Olympus' });
    expect(badTz.status).toBe(400);
    const badTime = await api(admin.jar, 'PATCH', `/api/orgs/${admin.orgId}/schedules/${ruleId}`, { endTime: '08:00' });
    expect(badTime.status).toBe(400);
    const goodPatch = await api(admin.jar, 'PATCH', `/api/orgs/${admin.orgId}/schedules/${ruleId}`, { graceMinutes: 5 });
    expect(goodPatch.status, goodPatch.raw).toBe(200);

    const tooLong = await api(admin.jar, 'POST', `/api/orgs/${admin.orgId}/schedules/${ruleId}/generate`, {
      from: '2026-01-01', to: '2027-01-02',
    });
    expect(tooLong.status).toBe(400);
    const foreignWorkspace = await api(admin.jar, 'POST', `/api/orgs/${admin.orgId}/schedules/${ruleId}/generate`, {
      from: '2026-03-02', to: '2026-03-02', workspaceId: randomUUID(),
    });
    expect(foreignWorkspace.status).toBe(400);

    const revalidated = await api(admin.jar, 'PATCH', `/api/orgs/${admin.orgId}/schedules/${ruleId}`, {
      exceptions: [{ date: '2026-03-02', type: 'extra_session', reason: 'cover' }],
    });
    expect(revalidated.status, revalidated.raw).toBe(200);
    const generated = await api(admin.jar, 'POST', `/api/orgs/${admin.orgId}/schedules/${ruleId}/generate`, {
      from: '2026-03-02', to: '2026-03-02', workspaceId: admin.workspaceId,
    });
    expect(generated.status, generated.raw).toBe(200);
    const sessions = (await api(admin.jar, 'GET',
      `/api/orgs/${admin.orgId}/schedules/sessions/list?from=2026-03-02&to=2026-03-02`)).body.sessions;
    expect(sessions).toHaveLength(2);
    expect(sessions[0].startsAt).toBe('2026-03-02T14:00:00.000Z'); // 09:00 America/New_York
    expect(new Set(sessions.map((s: { startsAt: string }) => s.startsAt)).size).toBe(2);
  });

  it('syncs a new holiday exception into already materialized sessions', async () => {
    const admin = await owner('Exception Owner', '+15551000008');
    const userId = (await api(admin.jar, 'GET', '/api/auth/me')).body.user.id as string;
    const rule = await api(admin.jar, 'POST', `/api/orgs/${admin.orgId}/schedules`, {
      userId, kind: 'shift', title: 'UTC shift', days: [1], startTime: '09:00', endTime: '10:00',
      timezone: 'UTC', graceMinutes: 10, minimumMinutes: 60,
    });
    expect(rule.status, rule.raw).toBe(201);
    const ruleId = rule.body.schedule.id as string;

    const generated = await api(admin.jar, 'POST', `/api/orgs/${admin.orgId}/schedules/${ruleId}/generate`, {
      from: '2026-03-02', to: '2026-03-02', workspaceId: admin.workspaceId,
    });
    expect(generated.status, generated.raw).toBe(200);
    const before = await api(admin.jar, 'GET',
      `/api/orgs/${admin.orgId}/schedules/sessions/list?from=2026-03-02&to=2026-03-02`);
    expect(before.body.sessions).toHaveLength(1);
    expect(before.body.sessions[0].status).toBe('scheduled');

    const patched = await api(admin.jar, 'PATCH', `/api/orgs/${admin.orgId}/schedules/${ruleId}`, {
      exceptions: [{ date: '2026-03-02', type: 'holiday', reason: 'Public holiday' }],
    });
    expect(patched.status, patched.raw).toBe(200);
    const synced = await api(admin.jar, 'POST', `/api/orgs/${admin.orgId}/schedules/${ruleId}/sync-exceptions`, {});
    expect(synced.status, synced.raw).toBe(200);

    const after = await api(admin.jar, 'GET',
      `/api/orgs/${admin.orgId}/schedules/sessions/list?from=2026-03-02&to=2026-03-02`);
    expect(after.body.sessions).toHaveLength(1);
    expect(after.body.sessions[0].status).toBe('cancelled');
  });
});
