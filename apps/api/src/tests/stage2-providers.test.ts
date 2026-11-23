import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { rmSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Stage 2 adapter coverage: recordings, Drive, integration listing and HMAC
// webhooks. All providers are intentionally unconfigured; no external HTTP call
// is made and no fabricated provider artifact is accepted as a success.
const dataFile = join(tmpdir(), `saha-stage2-providers-tests-${process.pid}.json`);
process.env.LOCAL_DATA_FILE = dataFile;
delete process.env.DATA_ADAPTER;
process.env.COOKIE_SECURE = 'false';
process.env.APP_URL = 'http://localhost:5173';

const envKeys = [
  'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'INTEGRATION_WEBHOOK_SECRET',
  'LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET',
];
const priorEnv = new Map(envKeys.map((key) => [key, process.env[key]]));
for (const key of envKeys) delete process.env[key];

const { store } = await import('../common/store.js');
const { createApp } = await import('../app.js');

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
  for (const [key, value] of priorEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

beforeEach(() => {
  store.reset();
  for (const key of envKeys) delete process.env[key];
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

async function api(jar: Jar | null, method: string, path: string, body?: unknown,
  options: { csrf?: boolean; headers?: Record<string, string> } = {}): Promise<Result> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const cookies = jar?.header();
  if (cookies) headers.Cookie = cookies;
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
  return { status: response.status, body: parsed, raw };
}

async function createOwner(name: string, phone: string) {
  const jar = new Jar();
  const registered = await api(null, 'POST', '/api/auth/register', { name, phone, password: PASSWORD }, { csrf: false });
  expect(registered.status, registered.raw).toBe(201);
  const created = await api(jar, 'POST', '/api/auth/login', { phone, password: PASSWORD }, { csrf: false });
  expect(created.status, created.raw).toBe(200);
  const organized = await api(jar, 'POST', '/api/orgs', { name: `${name} Org`, timezone: 'UTC' });
  expect(organized.status, organized.raw).toBe(201);
  const orgId = organized.body.organization.id as string;
  const workspaces = await api(jar, 'GET', `/api/orgs/${orgId}/workspaces`);
  const detail = await api(jar, 'GET', `/api/orgs/${orgId}/workspaces/${workspaces.body.workspaces[0].id}`);
  return { jar, orgId, workspaceId: workspaces.body.workspaces[0].id as string, roomId: detail.body.rooms[0].id as string };
}

async function createMeeting(owner: Awaited<ReturnType<typeof createOwner>>) {
  const created = await api(owner.jar, 'POST', `/api/orgs/${owner.orgId}/media/meetings`, {
    title: 'Recording source', workspaceId: owner.workspaceId, roomId: owner.roomId,
  });
  expect(created.status, created.raw).toBe(201);
  return created.body.meeting.id as string;
}

describe('stage 2 recordings: honest local adapter state', () => {
  it('creates a pending recording with no provider file and fails the stop without Drive', async () => {
    const owner = await createOwner('Recording Owner', '+14155557101');
    const meetingId = await createMeeting(owner);
    const base = `/api/orgs/${owner.orgId}/recordings`;

    const created = await api(owner.jar, 'POST', base, { meetingId });
    expect(created.status, created.raw).toBe(201);
    expect(created.body.recording).toMatchObject({
      organizationId: owner.orgId, meetingId, status: 'pending',
      providerFileId: null, providerUrl: null, attempts: 0, retentionDays: 30,
    });
    expect(created.body.recording.lastError).toMatch(/local adapter/i);
    expect(created.body.note).toContain('No recording file will exist');

    const recordingId = created.body.recording.id as string;
    const listed = await api(owner.jar, 'GET', `${base}?meetingId=${meetingId}`);
    expect(listed.body.recordings.map((r: { id: string }) => r.id)).toEqual([recordingId]);
    const single = await api(owner.jar, 'GET', `${base}/${recordingId}`);
    expect(single.body.recording.status).toBe('pending');

    const stopped = await api(owner.jar, 'POST', `${base}/${recordingId}/stop`, {});
    expect(stopped.status, stopped.raw).toBe(200);
    expect(stopped.body.recording).toMatchObject({
      status: 'failed', lastError: 'No connected Google Drive folder is selected.',
      providerFileId: null, providerUrl: null, endedAt: expect.any(String),
    });

    const retried = await api(owner.jar, 'POST', `${base}/${recordingId}/retry`, {});
    expect(retried.status, retried.raw).toBe(200);
    expect(retried.body.recording).toMatchObject({ status: 'retrying', attempts: 1, lastError: null });
    // The adapter also allows retrying an in-progress attempt, up to three total.
    const secondRetry = await api(owner.jar, 'POST', `${base}/${recordingId}/retry`, {});
    expect(secondRetry.status, secondRetry.raw).toBe(200);
    expect(secondRetry.body.recording.attempts).toBe(2);
    const thirdRetry = await api(owner.jar, 'POST', `${base}/${recordingId}/retry`, {});
    expect(thirdRetry.body.recording.attempts).toBe(3);
    const exhausted = await api(owner.jar, 'POST', `${base}/${recordingId}/retry`, {});
    expect(exhausted.status, exhausted.raw).toBe(400);
    expect(exhausted.body.error.code).toBe('RETRY_LIMIT');
  });
});

describe('stage 2 Google Drive adapter', () => {
  it('returns a default not-connected status and refuses prepare without credentials', async () => {
    const owner = await createOwner('Drive Owner', '+14155557102');
    const base = `/api/orgs/${owner.orgId}/drive`;

    const status = await api(owner.jar, 'GET', `${base}/status`);
    expect(status.status, status.raw).toBe(200);
    expect(status.body.connection).toMatchObject({
      organizationId: owner.orgId, status: 'not_connected', configured: false,
      folderId: null, folderName: null, connectedBy: null,
    });

    const prepare = await api(owner.jar, 'POST', `${base}/connect/prepare`, {});
    expect(prepare.status, prepare.raw).toBe(503);
    expect(prepare.body.error.code).toBe('PROVIDER_NOT_CONFIGURED');

    const folder = await api(owner.jar, 'POST', `${base}/folder`, { folderId: 'fake', folderName: 'Fake' });
    expect(folder.status).toBe(400);
    expect(folder.body.error.code).toBe('DRIVE_NOT_CONNECTED');
  });
});

describe('stage 2 integration catalog and webhook signatures', () => {
  it('lists all seven providers as not connected and never exposes stored secrets', async () => {
    const owner = await createOwner('Integrations Owner', '+14155557103');
    const base = `/api/orgs/${owner.orgId}/integrations`;

    const first = await api(owner.jar, 'GET', base);
    expect(first.status, first.raw).toBe(200);
    expect(first.body.integrations).toHaveLength(7);
    expect(first.body.integrations.map((item: { provider: string }) => item.provider)).toEqual([
      'google_drive', 'google_calendar', 'outlook', 'slack', 'teams', 'webhook', 'public_api',
    ]);
    expect(first.body.integrations.every((item: { status: string }) => item.status === 'not_connected')).toBe(true);

    await store.mutate((draft) => {
      draft.integrations.push({
        id: 'integration-with-secret', organizationId: owner.orgId, provider: 'slack',
        status: 'connected', scopes: ['chat:write'], connectedBy: owner.jar.get('saha_session') ?? null,
        connectedAt: new Date().toISOString(), lastError: null,
        metadata: { access_token: 'secret-token', webhook_secret: 'secret-hook' },
        updatedAt: new Date().toISOString(),
      });
    });
    const second = await api(owner.jar, 'GET', base);
    expect(second.body.integrations).toHaveLength(7);
    const slack = second.body.integrations.find((item: { provider: string }) => item.provider === 'slack');
    expect(slack.status).toBe('connected');
    expect(second.raw).not.toContain('secret-token');
    expect(second.raw).not.toContain('secret-hook');
  });

  it('needs INTEGRATION_WEBHOOK_SECRET for prepare and returns no secret in the response', async () => {
    const owner = await createOwner('Prepare Owner', '+14155557104');
    const base = `/api/orgs/${owner.orgId}/integrations`;
    const missing = await api(owner.jar, 'POST', `${base}/webhook/prepare`, {});
    expect(missing.status, missing.raw).toBe(503);
    expect(missing.body.error.code).toBe('PROVIDER_NOT_CONFIGURED');

    process.env.INTEGRATION_WEBHOOK_SECRET = 'test-secret';
    try {
      const ready = await api(owner.jar, 'POST', `${base}/webhook/prepare`, {});
      expect(ready.status, ready.raw).toBe(200);
      expect(ready.body).toMatchObject({ provider: 'webhook', ready: true });
      expect(ready.raw).not.toContain('test-secret');
    } finally {
      delete process.env.INTEGRATION_WEBHOOK_SECRET;
    }
  });

  it('verifies HMAC signatures, deduplicates events, and bypasses browser CSRF', async () => {
    const owner = await createOwner('Webhook Owner', '+14155557105');
    expect(owner.jar.get('saha_session')).toBeTruthy();

    const noSecret = await api(null, 'POST', '/api/webhooks/slack', { id: 'evt-0', type: 'test' }, { csrf: false });
    expect(noSecret.status, noSecret.raw).toBe(503);
    expect(noSecret.body.error.code).toBe('PROVIDER_NOT_CONFIGURED');

    process.env.INTEGRATION_WEBHOOK_SECRET = 'test-secret';
    try {
      const body = { id: 'evt-1', type: 'test' };
      const signature = createHmac('sha256', 'test-secret').update(JSON.stringify(body)).digest('hex');
      // A completely cookie-less caller: CSRF must not gate provider webhooks.
      const first = await api(null, 'POST', '/api/webhooks/slack', body, {
        csrf: false, headers: { 'x-webhook-signature': signature },
      });
      expect(first.status, first.raw).toBe(200);
      expect(first.body).toEqual({ received: true, duplicate: false });

      const duplicate = await api(null, 'POST', '/api/webhooks/slack', body, {
        csrf: false, headers: { 'x-webhook-signature': signature },
      });
      expect(duplicate.status, duplicate.raw).toBe(200);
      expect(duplicate.body).toEqual({ received: true, duplicate: true });

      const invalid = await api(null, 'POST', '/api/webhooks/slack', body, {
        csrf: false, headers: { 'x-webhook-signature': 'deadbeef' },
      });
      expect([401, 403]).toContain(invalid.status);
      expect(invalid.body.error.code).toBe('INVALID_SIGNATURE');

      const audits = store.read((state) => state.auditLogs.filter((log) => log.action === 'webhook.slack.evt-1'));
      expect(audits).toHaveLength(1);
    } finally {
      delete process.env.INTEGRATION_WEBHOOK_SECRET;
    }
  });
});
