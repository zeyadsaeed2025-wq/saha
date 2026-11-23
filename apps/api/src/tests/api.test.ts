import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { rmSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// These integration tests drive the real Express routes over localhost using
// the LOCAL JSON adapter (singleton reset before each test, temp data file).
// They do NOT connect to, configure, or verify PostgreSQL in any way.
const dataFile = join(tmpdir(), `saha-api-tests-${process.pid}.json`);
process.env.LOCAL_DATA_FILE = dataFile;
delete process.env.DATA_ADAPTER;
process.env.COOKIE_SECURE = 'false';
process.env.APP_URL = 'http://localhost:5173';

const { store } = await import('../common/store.js');
const { createApp } = await import('../app.js');

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
  const closing = new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  server.closeAllConnections();
  await closing;
  rmSync(dataFile, { force: true });
});

afterEach(() => vi.useRealTimers());
beforeEach(() => store.reset());

/** Minimal cookie jar: parses Set-Cookie headers and sends them back on fetch calls. */
class CookieJar {
  private readonly cookies = new Map<string, string>();

  ingest(response: Response): void {
    for (const raw of response.headers.getSetCookie()) {
      const [pair] = raw.split(';');
      const separator = pair.indexOf('=');
      if (separator < 0) continue;
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      if (!value || /expires=Thu, 01 Jan 1970/i.test(raw)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  get(name: string): string | undefined {
    return this.cookies.get(name);
  }

  header(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  }
}

interface ApiResult {
  status: number;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any -- test helper parses arbitrary JSON
  raw: string;
  headers: Headers;
  setCookies: string[];
}

async function api(
  jar: CookieJar,
  method: string,
  path: string,
  body?: unknown,
  options: { csrf?: boolean; headers?: Record<string, string> } = {},
): Promise<ApiResult> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const cookies = jar.header();
  if (cookies) headers.Cookie = cookies;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if ((options.csrf ?? true) && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const csrf = jar.get('saha_csrf');
    if (csrf) headers['x-csrf-token'] = csrf;
  }
  Object.assign(headers, options.headers);

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  jar.ingest(response);
  const raw = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = raw;
  }
  return {
    status: response.status,
    body: parsed,
    raw,
    headers: response.headers,
    setCookies: response.headers.getSetCookie(),
  };
}

const PASSWORD = 'Passw0rd!';

async function register(name: string, phone: string) {
  const jar = new CookieJar();
  const response = await api(jar, 'POST', '/api/auth/register', { name, phone, password: PASSWORD }, { csrf: false });
  expect(response.status, `register: ${response.raw}`).toBe(201);
  return { jar, userId: response.body.user.id as string, setCookies: response.setCookies };
}

async function login(phone: string, password = PASSWORD) {
  const jar = new CookieJar();
  const response = await api(jar, 'POST', '/api/auth/login', { phone, password }, { csrf: false });
  expect(response.status, `login: ${response.raw}`).toBe(200);
  return { jar, userId: response.body.user.id as string, setCookies: response.setCookies };
}

interface Owner {
  jar: CookieJar;
  userId: string;
  orgId: string;
  workspaceId: string;
  roomId: string;
  phone: string;
}

async function createOwner(name: string, phone: string): Promise<Owner> {
  await register(name, phone);
  const signedIn = await login(phone);
  const created = await api(signedIn.jar, 'POST', '/api/orgs', { name: `${name} Organization`, timezone: 'UTC' });
  expect(created.status, `create org: ${created.raw}`).toBe(201);
  const orgId = created.body.organization.id as string;

  const workspaces = await api(signedIn.jar, 'GET', `/api/orgs/${orgId}/workspaces`);
  expect(workspaces.status).toBe(200);
  const workspace = workspaces.body.workspaces[0];
  const withRooms = await api(signedIn.jar, 'GET', `/api/orgs/${orgId}/workspaces/${workspace.id}`);
  expect(withRooms.status).toBe(200);
  return {
    jar: signedIn.jar,
    userId: signedIn.userId,
    orgId,
    workspaceId: workspace.id as string,
    roomId: withRooms.body.rooms[0].id as string,
    phone,
  };
}

async function createSchedule(
  jar: CookieJar, orgId: string, userId: string,
  title: string, startTime: string, endTime: string, minimumMinutes = 1,
): Promise<string> {
  const created = await api(jar, 'POST', `/api/orgs/${orgId}/schedules`, {
    userId, kind: 'shift', title, days: [1], startTime, endTime, timezone: 'UTC',
    graceMinutes: 10, minimumMinutes,
  });
  expect(created.status, `create schedule: ${created.raw}`).toBe(201);
  const id = created.body.schedule.id as string;
  const generated = await api(jar, 'POST', `/api/orgs/${orgId}/schedules/${id}/generate`, {
    from: '2026-03-02', to: '2026-03-02', // Monday, expressed explicitly for determinism
  });
  expect(generated.status, `generate sessions: ${generated.raw}`).toBe(200);
  expect(generated.body.created).toBe(1);
  return id;
}

describe('Saha API integration (local JSON adapter; NOT PostgreSQL)', () => {
  it('registers, logs in, enforces cookies/CSRF, creates an org, schedule and sessions', async () => {
    const health = await api(new CookieJar(), 'GET', '/api/health');
    expect(health.status).toBe(200);
    expect(health.body.dataAdapter).toBe('local-json');

    const registered = await register('Alice Admin', '+1 (415) 555-0101');
    expect(registered.setCookies.some((c) => c.startsWith('saha_session=') && /HttpOnly/i.test(c))).toBe(true);
    expect(registered.setCookies.some((c) => c.startsWith('saha_csrf=') && !/HttpOnly/i.test(c))).toBe(true);

    const signedIn = await login('+14155550101');
    expect(signedIn.userId).toBe(registered.userId);
    expect(signedIn.jar.get('saha_session')).toBeTruthy();
    expect(signedIn.jar.get('saha_csrf')).toBeTruthy();

    const anonymousMe = await api(new CookieJar(), 'GET', '/api/auth/me');
    expect(anonymousMe.status).toBe(401);
    const me = await api(signedIn.jar, 'GET', '/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.activeOrgId).toBe(''); // no active organization yet

    const noCsrf = await api(signedIn.jar, 'POST', '/api/orgs', { name: 'No CSRF Org', timezone: 'UTC' }, { csrf: false });
    expect(noCsrf.status).toBe(403);
    expect(noCsrf.body.error.code).toBe('CSRF_FAILED');
    const badCsrf = await api(signedIn.jar, 'POST', '/api/orgs', { name: 'Bad CSRF Org', timezone: 'UTC' }, {
      headers: { 'x-csrf-token': 'not-the-cookie' },
    });
    expect(badCsrf.status).toBe(403);

    const created = await api(signedIn.jar, 'POST', '/api/orgs', { name: 'Alpha Org', timezone: 'UTC' });
    expect(created.status, `create org: ${created.raw}`).toBe(201);
    const orgId = created.body.organization.id as string;
    expect(orgId).toBeTruthy();

    const meAfterOrg = await api(signedIn.jar, 'GET', '/api/auth/me');
    expect(meAfterOrg.body.activeOrgId).toBe(orgId);
    expect(meAfterOrg.body.role).toBe('org_admin');

    const scheduleId = await createSchedule(signedIn.jar, orgId, signedIn.userId, 'Morning shift', '09:00', '10:00');
    const sessions = await api(signedIn.jar, 'GET', `/api/orgs/${orgId}/schedules/sessions/list?from=2026-03-02&to=2026-03-02`);
    expect(sessions.status).toBe(200);
    expect(sessions.body.sessions).toHaveLength(1);
    expect(sessions.body.sessions[0]).toMatchObject({
      scheduleRuleId: scheduleId,
      startsAt: '2026-03-02T09:00:00.000Z',
      endsAt: '2026-03-02T10:00:00.000Z',
      status: 'scheduled',
    });

    const regenerated = await api(signedIn.jar, 'POST', `/api/orgs/${orgId}/schedules/${scheduleId}/generate`, {
      from: '2026-03-02', to: '2026-03-02',
    });
    expect(regenerated.body.created).toBe(0); // idempotent materialization
  });

  it('enforces student RBAC and tenant isolation across organizations', async () => {
    const adminA = await createOwner('Admin A', '+14155550201');
    const adminB = await createOwner('Admin B', '+14155550202');

    const added = await api(adminA.jar, 'POST', `/api/orgs/${adminA.orgId}/members`, {
      phone: '+14155550203', name: 'Sam Student', role: 'student', team: 'Learners',
    });
    expect(added.status, `add member: ${added.raw}`).toBe(201);
    expect(added.body.temporaryPassword).toBeTruthy();
    const student = await login('+14155550203', added.body.temporaryPassword);
    const studentMe = await api(student.jar, 'GET', '/api/auth/me');
    expect(studentMe.body.role).toBe('student');
    expect(studentMe.body.memberships[0].organizationId).toBe(adminA.orgId);

    // Students can read the org and workspaces but have neither member:read nor member:manage.
    const membersRead = await api(student.jar, 'GET', `/api/orgs/${adminA.orgId}/members`);
    expect(membersRead.status).toBe(403);
    const forbidden = await api(student.jar, 'POST', `/api/orgs/${adminA.orgId}/members`, {
      phone: '+14155550204', name: 'Another Student', role: 'student',
    });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('FORBIDDEN');
    const adminMembers = await api(adminA.jar, 'GET', `/api/orgs/${adminA.orgId}/members`);
    expect(adminMembers.status).toBe(200);
    expect(adminMembers.body.members.some((m: any) => m.role === 'student')).toBe(true);

    const ownOrg = await api(adminA.jar, 'GET', `/api/orgs/${adminA.orgId}`);
    expect(ownOrg.status).toBe(200);
    const crossOrg = await api(adminA.jar, 'GET', `/api/orgs/${adminB.orgId}`);
    expect(crossOrg.status).toBe(403);
    const crossOrgSchedules = await api(adminA.jar, 'GET', `/api/orgs/${adminB.orgId}/schedules`);
    expect(crossOrgSchedules.status).toBe(403);
    const crossOrgWorkspaces = await api(student.jar, 'GET', `/api/orgs/${adminB.orgId}/workspaces`);
    expect(crossOrgWorkspaces.status).toBe(403);
    const reverse = await api(adminB.jar, 'GET', `/api/orgs/${adminA.orgId}`);
    expect(reverse.status).toBe(403);
  });

  it('creates and redeems invitations and scoped access links', async () => {
    const admin = await createOwner('Link Admin', '+14155550301');
    const invitee = await register('Invitee Mentor', '+14155550302');

    const invitation = await api(admin.jar, 'POST', `/api/orgs/${admin.orgId}/invitations`, {
      phone: '+14155550302', role: 'mentor', team: 'Mentors',
    });
    expect(invitation.status, `invite: ${invitation.raw}`).toBe(201);
    const invitationToken = invitation.body.token as string;
    // Token lookup lives under /api/orgs, which requires a signed-in caller.
    const mentor = await login('+14155550302');
    const tokenInfo = await api(mentor.jar, 'GET', `/api/orgs/token/${invitationToken}`);
    expect(tokenInfo.status, `token info: ${tokenInfo.raw}`).toBe(200);
    expect(tokenInfo.body).toMatchObject({
      organizationName: 'Link Admin Organization', role: 'mentor', active: true,
    });

    const accepted = await api(mentor.jar, 'POST', `/api/orgs/token/${invitationToken}/accept`, {});
    expect(accepted.status, `accept: ${accepted.raw}`).toBe(200);
    expect(accepted.body).toMatchObject({ organizationId: admin.orgId, role: 'mentor' });
    const members = await api(admin.jar, 'GET', `/api/orgs/${admin.orgId}/members`);
    expect(members.body.members.some((m: any) => m.userId === invitee.userId && m.role === 'mentor')).toBe(true);

    const guestLink = await api(admin.jar, 'POST', `/api/orgs/${admin.orgId}/access-links`, {
      kind: 'public_guest', workspaceId: admin.workspaceId, roomId: admin.roomId,
    });
    expect(guestLink.status, `guest link: ${guestLink.raw}`).toBe(201);
    const guestInfo = await api(new CookieJar(), 'GET', `/api/access/${guestLink.body.token}/info`);
    expect(guestInfo.body).toMatchObject({ kind: 'public_guest', active: true, roomName: 'Reception' });

    const guestJar = new CookieJar();
    const guestRedeem = await api(guestJar, 'POST', `/api/access/${guestLink.body.token}/redeem`, {});
    expect(guestRedeem.status, `guest redeem: ${guestRedeem.raw}`).toBe(200);
    expect(guestRedeem.body).toMatchObject({
      kind: 'guest', organizationId: admin.orgId, workspaceId: admin.workspaceId, roomId: admin.roomId,
    });
    const guestMe = await api(guestJar, 'GET', '/api/auth/me');
    expect(guestMe.body.isGuest).toBe(true);
    expect(guestMe.body.activeOrgId).toBe(admin.orgId);
    const presence = await api(guestJar, 'GET', `/api/orgs/${admin.orgId}/world/presence`);
    expect(presence.status).toBe(200);
    expect(presence.body.count).toBe(0);

    const memberLink = await api(admin.jar, 'POST', `/api/orgs/${admin.orgId}/access-links`, {
      kind: 'passwordless_member', workspaceId: admin.workspaceId, subjectUserId: invitee.userId,
    });
    expect(memberLink.status, `member link: ${memberLink.raw}`).toBe(201);
    const memberInfo = await api(new CookieJar(), 'GET', `/api/access/${memberLink.body.token}/info`);
    expect(memberInfo.body).toMatchObject({ kind: 'passwordless_member', active: true });
    expect(memberInfo.body.subjectName).toBeUndefined(); // public info never identifies the subject

    const passwordlessJar = new CookieJar();
    const memberRedeem = await api(passwordlessJar, 'POST', `/api/access/${memberLink.body.token}/redeem`, {});
    expect(memberRedeem.status, `member redeem: ${memberRedeem.raw}`).toBe(200);
    expect(memberRedeem.body).toMatchObject({ kind: 'member', userId: invitee.userId, organizationId: admin.orgId });
    const memberMe = await api(passwordlessJar, 'GET', '/api/auth/me');
    expect(memberMe.body.activeOrgId).toBe(admin.orgId);
    expect(memberMe.body.role).toBe('mentor');
  });

  it('records attendance events, finalizes absences, corrects a session and reports results', async () => {
    // Only Date is faked; HTTP timers are untouched. All event timestamps come
    // from the server's clock, so the flow is deterministic with explicit ISOs.
    vi.useFakeTimers({ toFake: ['Date'] });
    const at = (iso: string) => vi.setSystemTime(new Date(iso));
    at('2026-03-02T10:05:00.000Z');

    const admin = await createOwner('Attendance Admin', '+14155550401');
    const settings = await api(admin.jar, 'PATCH', `/api/orgs/${admin.orgId}`, {
      verificationWindowMinutes: 0, heartbeatSeconds: 60,
    });
    expect(settings.status).toBe(200);
    await createSchedule(admin.jar, admin.orgId, admin.userId, 'Late shift', '09:00', '10:00', 1);
    await createSchedule(admin.jar, admin.orgId, admin.userId, 'No-show shift', '08:00', '08:30', 1);

    const attendance = `/api/orgs/${admin.orgId}/attendance`;
    const join = await api(admin.jar, 'POST', `${attendance}/join`, {});
    expect(join.status, `join: ${join.raw}`).toBe(200);
    const sessionId = join.body.session.id as string;

    at('2026-03-02T10:06:00.000Z');
    expect((await api(admin.jar, 'POST', `${attendance}/break/start`, {})).status).toBe(200);
    at('2026-03-02T10:07:00.000Z');
    expect((await api(admin.jar, 'POST', `${attendance}/break/end`, {})).status).toBe(200);
    at('2026-03-02T10:08:00.000Z');
    expect((await api(admin.jar, 'POST', `${attendance}/heartbeat`, {})).status).toBe(200);
    at('2026-03-02T10:09:00.000Z');
    const left = await api(admin.jar, 'POST', `${attendance}/leave`, {});
    expect(left.status, `leave: ${left.raw}`).toBe(200);
    expect(left.body.session).toMatchObject({
      status: 'late',
      firstJoin: '2026-03-02T10:05:00.000Z',
      lastLeave: '2026-03-02T10:09:00.000Z',
      countedLatenessSeconds: 65 * 60 - 10 * 60, // 65 min late minus the 10-min grace
      confirmedConnectedSeconds: 180, // 4 minutes connected minus 1 minute break
      breakSeconds: 60,
    });

    const events = await api(admin.jar, 'GET', `${attendance}/events?sessionId=${sessionId}`);
    expect(events.body.events).toHaveLength(5);
    expect(events.body.events.map((e: any) => e.type)).toEqual([
      'joined', 'break_started', 'break_ended', 'heartbeat', 'left',
    ]);
    const listed = await api(admin.jar, 'GET', `${attendance}?from=2026-03-02&to=2026-03-02`);
    expect(listed.body.sessions).toHaveLength(1);

    at('2026-03-02T10:10:00.000Z');
    const finalized = await api(admin.jar, 'POST', `${attendance}/finalize`, {});
    expect(finalized.status, `finalize: ${finalized.raw}`).toBe(200);
    expect(finalized.body).toEqual({ absences: 1, finalized: 1 });

    const lateCheckIn = await api(admin.jar, 'POST', `${attendance}/join`, {
      scheduledSessionId: join.body.session.scheduledSessionId,
    });
    expect(lateCheckIn.status, lateCheckIn.raw).toBe(400);
    expect(lateCheckIn.body.error.code).toBe('ATTENDANCE_FINALIZED');

    const corrected = await api(admin.jar, 'POST', `${attendance}/${sessionId}/correct`, {
      reason: 'Verified medical note', status: 'excused', note: 'Approved leave',
    });
    expect(corrected.status, `correct: ${corrected.raw}`).toBe(200);
    expect(corrected.body.session.status).toBe('excused');
    const history = await api(admin.jar, 'GET', `${attendance}/${sessionId}/history`);
    expect(history.body.history).toHaveLength(1);
    expect(history.body.history[0]).toMatchObject({
      reason: 'Verified medical note',
      before: { status: 'late' },
      after: { status: 'excused', note: 'Approved leave' },
    });

    const range = '?from=2026-03-02&to=2026-03-02';
    const summary = await api(admin.jar, 'GET', `/api/orgs/${admin.orgId}/reports/summary${range}`);
    expect(summary.status).toBe(200);
    expect(summary.body.summary).toMatchObject({
      expected: 2, absent: 1, excused: 1, confirmedConnectedSeconds: 180,
    });
    const members = await api(admin.jar, 'GET', `/api/orgs/${admin.orgId}/reports/members${range}`);
    expect(members.body.members[0]).toMatchObject({
      userId: admin.userId, scheduled: 2, connectedSeconds: 180,
    });
    const filtered = await api(admin.jar, 'GET', `/api/orgs/${admin.orgId}/reports/sessions?status=excused`);
    expect(filtered.body.sessions).toHaveLength(1);

    const csv = await api(admin.jar, 'GET', `/api/orgs/${admin.orgId}/reports/export.csv${range}`);
    expect(csv.status).toBe(200);
    expect(csv.headers.get('content-type')).toContain('text/csv');
    // Response.text() decodes UTF-8 and strips the leading BOM emitted by the API.
    expect(csv.raw.startsWith('"Date"')).toBe(true);
    expect(csv.raw).toContain('"Attendance Admin"');
    expect(csv.raw).toContain('"excused"');
    expect(csv.raw).toContain('"absent"');
  });
});
