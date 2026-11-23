import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { rmSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Stage 2 media coverage against the real Express routers, over localhost, using
// the LOCAL JSON adapter. No LiveKit server is contacted: tokens are signed
// locally with dummy credentials that exist only inside this test worker.
const dataFile = join(tmpdir(), `saha-stage2-media-tests-${process.pid}.json`);
process.env.LOCAL_DATA_FILE = dataFile;
delete process.env.DATA_ADAPTER;
process.env.COOKIE_SECURE = 'false';
process.env.APP_URL = 'http://localhost:5173';

const priorEnv = {
  LIVEKIT_URL: process.env.LIVEKIT_URL,
  LIVEKIT_API_KEY: process.env.LIVEKIT_API_KEY,
  LIVEKIT_API_SECRET: process.env.LIVEKIT_API_SECRET,
};
delete process.env.LIVEKIT_URL;
delete process.env.LIVEKIT_API_KEY;
delete process.env.LIVEKIT_API_SECRET;

const { store } = await import('../common/store.js');
const { createApp } = await import('../app.js');

const PASSWORD = 'Passw0rd!';
const SECRET = 'local-only-test-api-secret-not-a-real-key';
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
  for (const [key, value] of Object.entries(priorEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

beforeEach(() => {
  store.reset();
  delete process.env.LIVEKIT_URL;
  delete process.env.LIVEKIT_API_KEY;
  delete process.env.LIVEKIT_API_SECRET;
});

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
}

async function api(jar: Jar, method: string, path: string, body?: unknown,
  options: { csrf?: boolean } = {}): Promise<Result> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const cookies = jar.header();
  if (cookies) headers.Cookie = cookies;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if ((options.csrf ?? true) && !['GET', 'HEAD', 'OPTIONS'].includes(method) && jar.get('saha_csrf')) {
    headers['x-csrf-token'] = jar.get('saha_csrf')!;
  }
  const response = await fetch(`${baseUrl}${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  jar.ingest(response);
  const raw = await response.text();
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { parsed = raw; }
  return { status: response.status, body: parsed, raw };
}

async function register(name: string, phone: string): Promise<Jar> {
  const jar = new Jar();
  const result = await api(jar, 'POST', '/api/auth/register', { name, phone, password: PASSWORD }, { csrf: false });
  expect(result.status, result.raw).toBe(201);
  return jar;
}

async function login(phone: string, password = PASSWORD): Promise<Jar> {
  const jar = new Jar();
  const result = await api(jar, 'POST', '/api/auth/login', { phone, password }, { csrf: false });
  expect(result.status, result.raw).toBe(200);
  return jar;
}

async function createOwner(name: string, phone: string) {
  const jar = await register(name, phone);
  const created = await api(jar, 'POST', '/api/orgs', { name: `${name} Org`, timezone: 'UTC' });
  expect(created.status, created.raw).toBe(201);
  const orgId = created.body.organization.id as string;
  const workspaces = await api(jar, 'GET', `/api/orgs/${orgId}/workspaces`);
  expect(workspaces.status, workspaces.raw).toBe(200);
  const workspaceId = workspaces.body.workspaces[0].id as string;
  const detail = await api(jar, 'GET', `/api/orgs/${orgId}/workspaces/${workspaceId}`);
  expect(detail.status, detail.raw).toBe(200);
  return { jar, orgId, workspaceId, roomId: detail.body.rooms[0].id as string };
}

async function createMeeting(owner: Awaited<ReturnType<typeof createOwner>>, title = 'Planning sync') {
  const created = await api(owner.jar, 'POST', `/api/orgs/${owner.orgId}/media/meetings`, {
    title, workspaceId: owner.workspaceId, roomId: owner.roomId,
  });
  expect(created.status, created.raw).toBe(201);
  return created.body.meeting as { id: string; status: string; provider: string };
}

describe('stage 2 media: local adapter status, tokens and meeting lifecycle', () => {
  it('reports the local provider and refuses tokens while LiveKit env vars are absent', async () => {
    const owner = await createOwner('Media Status Admin', '+14155557001');
    const status = await api(owner.jar, 'GET', `/api/orgs/${owner.orgId}/media/status`);
    expect(status.status, status.raw).toBe(200);
    expect(status.body).toMatchObject({ provider: 'local', configured: false, url: null });
    expect(status.body.message).toContain('not configured');

    const meeting = await createMeeting(owner);
    expect(meeting.provider).toBe('local');
    expect(meeting.status).toBe('scheduled');

    const token = await api(owner.jar, 'POST', `/api/orgs/${owner.orgId}/media/token`, { meetingId: meeting.id });
    expect(token.status, token.raw).toBe(503);
    expect(token.body.error.code).toBe('PROVIDER_NOT_CONFIGURED');
  });

  it('signs a short-lived HS256 JWT without leaking the API secret when credentials are set', async () => {
    const owner = await createOwner('Media Token Admin', '+14155557002');
    const meeting = await createMeeting(owner, 'Token meeting');
    process.env.LIVEKIT_URL = 'wss://livekit.example.invalid';
    process.env.LIVEKIT_API_KEY = 'APIkeyABC123';
    process.env.LIVEKIT_API_SECRET = SECRET;

    try {
      const status = await api(owner.jar, 'GET', `/api/orgs/${owner.orgId}/media/status`);
      expect(status.body).toMatchObject({ provider: 'livekit', configured: true, url: 'wss://livekit.example.invalid' });

      const issued = await api(owner.jar, 'POST', `/api/orgs/${owner.orgId}/media/token`, { meetingId: meeting.id });
      expect(issued.status, issued.raw).toBe(200);
      expect(issued.body.url).toBe('wss://livekit.example.invalid');
      expect(issued.body.identity).toBeTruthy();

      const parts = String(issued.body.token).split('.');
      expect(parts).toHaveLength(3);
      const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      expect(header).toMatchObject({ alg: 'HS256', typ: 'JWT' });
      expect(payload.iss).toBe('APIkeyABC123');
      expect(payload.sub).toBe(issued.body.identity);
      expect(payload.video).toMatchObject({ room: `saha-${meeting.id}`, roomJoin: true });
      expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
      expect(payload.exp - payload.nbf).toBe(3600);
      expect(JSON.parse(payload.metadata)).toMatchObject({
        organizationId: owner.orgId, meetingId: meeting.id,
      });
      expect(Date.parse(issued.body.expiresAt)).toBeGreaterThan(Date.now());
      expect(issued.raw).not.toContain(SECRET);
      expect(issued.body.token).not.toContain(SECRET);
    } finally {
      delete process.env.LIVEKIT_URL;
      delete process.env.LIVEKIT_API_KEY;
      delete process.env.LIVEKIT_API_SECRET;
    }
  });

  it('runs the full meeting lifecycle with host/participant controls and exclusivity', async () => {
    const admin = await createOwner('Meeting Host', '+14155557003');
    const added = await api(admin.jar, 'POST', `/api/orgs/${admin.orgId}/members`, {
      phone: '+14155557004', name: 'Joining Student', role: 'student', team: 'Learners',
    });
    expect(added.status, added.raw).toBe(201);
    const student = await login('+14155557004', added.body.temporaryPassword);

    const meeting = await createMeeting(admin, 'Team sync');
    const base = `/api/orgs/${admin.orgId}/media/meetings/${meeting.id}`;

    // Students may read meetings but cannot manage them.
    const studentCreate = await api(student, 'POST', `/api/orgs/${admin.orgId}/media/meetings`, {
      title: 'Not allowed', workspaceId: admin.workspaceId,
    });
    expect(studentCreate.status).toBe(403);

    const listed = await api(admin.jar, 'GET', `/api/orgs/${admin.orgId}/media/meetings`);
    expect(listed.body.meetings.map((m: { id: string }) => m.id)).toContain(meeting.id);
    const detail = await api(admin.jar, 'GET', base);
    expect(detail.body.meeting).toMatchObject({ id: meeting.id, status: 'scheduled', hostUserId: detail.body.meeting.hostUserId });
    expect(detail.body.participants).toEqual([]);

    const earlyJoin = await api(student, 'POST', `${base}/join`, {});
    expect(earlyJoin.status, earlyJoin.raw).toBe(400);
    expect(earlyJoin.body.error.code).toBe('MEETING_NOT_LIVE');

    const started = await api(admin.jar, 'POST', `${base}/start`, {});
    expect(started.status, started.raw).toBe(200);
    expect(started.body.meeting).toMatchObject({ status: 'live', startedAt: expect.any(String) });

    const hostJoin = await api(admin.jar, 'POST', `${base}/join`, {});
    expect(hostJoin.status, hostJoin.raw).toBe(200);
    expect(hostJoin.body.participant).toMatchObject({
      meetingId: meeting.id, role: 'host', micEnabled: true, cameraEnabled: true,
      sharing: false, leftAt: null,
    });
    const studentJoin = await api(student, 'POST', `${base}/join`, {});
    expect(studentJoin.status, studentJoin.raw).toBe(200);
    expect(studentJoin.body.participant).toMatchObject({
      meetingId: meeting.id, role: 'participant', micEnabled: true, cameraEnabled: true,
      sharing: false, leftAt: null,
    });
    expect(studentJoin.body.participant.userId).not.toBe(hostJoin.body.participant.userId);

    const hostSharing = await api(admin.jar, 'PATCH', `${base}/controls`, { sharing: true, micEnabled: false });
    expect(hostSharing.status, hostSharing.raw).toBe(200);
    expect(hostSharing.body.participant).toMatchObject({ sharing: true, micEnabled: false, cameraEnabled: true });

    const studentSharing = await api(student, 'PATCH', `${base}/controls`, {
      sharing: true, micEnabled: false, cameraEnabled: false,
    });
    expect(studentSharing.status, studentSharing.raw).toBe(200);
    expect(studentSharing.body.participant).toMatchObject({
      sharing: true, micEnabled: false, cameraEnabled: false,
    });

    let participants = (await api(admin.jar, 'GET', `${base}/participants`)).body.participants;
    expect(participants).toHaveLength(2);
    const byId = new Map(participants.map((p: { id: string }) => [p.id, p]));
    expect(byId.get(hostJoin.body.participant.id)).toMatchObject({ sharing: false, micEnabled: false });
    expect(byId.get(studentJoin.body.participant.id)).toMatchObject({ sharing: true, cameraEnabled: false });

    const left = await api(student, 'POST', `${base}/leave`, {});
    expect(left.status, left.raw).toBe(200);
    expect(left.body.participant.leftAt).toBeTruthy();
    participants = (await api(admin.jar, 'GET', `${base}/participants`)).body.participants;
    expect(participants.filter((p: { leftAt: string | null }) => p.leftAt === null)).toHaveLength(1);

    const ended = await api(admin.jar, 'POST', `${base}/end`, {});
    expect(ended.status, ended.raw).toBe(200);
    expect(ended.body.meeting).toMatchObject({ status: 'ended', endedAt: expect.any(String) });
    participants = (await api(admin.jar, 'GET', `${base}/participants`)).body.participants;
    expect(participants.every((p: { leftAt: string | null }) => Boolean(p.leftAt))).toBe(true);

    const afterEnd = await api(student, 'POST', `${base}/join`, {});
    expect(afterEnd.status, afterEnd.raw).toBe(400);
    expect(afterEnd.body.error.code).toBe('MEETING_NOT_LIVE');
  });
});
