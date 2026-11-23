import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { rmSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Guest waiting-room coverage over the real access-link routers using the local
// JSON adapter. Guests are anonymous cookie holders; approval is done by the
// organization admin through the scoped access-link routes.
const dataFile = join(tmpdir(), `saha-guest-room-tests-${process.pid}.json`);
process.env.LOCAL_DATA_FILE = dataFile;
delete process.env.DATA_ADAPTER;
process.env.COOKIE_SECURE = 'false';
process.env.APP_URL = 'http://localhost:5173';

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
});

beforeEach(() => store.reset());

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
  options: { csrf?: boolean } = {}): Promise<Result> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const cookies = jar?.header();
  if (cookies) headers.Cookie = cookies;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const csrf = jar?.get('saha_csrf');
  if ((options.csrf ?? true) && !['GET', 'HEAD', 'OPTIONS'].includes(method) && csrf) {
    headers['x-csrf-token'] = csrf;
  }
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
  const signedIn = await api(jar, 'POST', '/api/auth/login', { phone, password: PASSWORD }, { csrf: false });
  expect(signedIn.status, signedIn.raw).toBe(200);
  const created = await api(jar, 'POST', '/api/orgs', { name: `${name} Org`, timezone: 'UTC' });
  expect(created.status, created.raw).toBe(201);
  const orgId = created.body.organization.id as string;
  const workspaces = await api(jar, 'GET', `/api/orgs/${orgId}/workspaces`);
  const detail = await api(jar, 'GET', `/api/orgs/${orgId}/workspaces/${workspaces.body.workspaces[0].id}`);
  return {
    jar, orgId, userId: signedIn.body.user.id as string,
    workspaceId: workspaces.body.workspaces[0].id as string,
    roomId: detail.body.rooms[0].id as string,
  };
}

async function createApprovalLink(admin: Awaited<ReturnType<typeof createOwner>>) {
  const created = await api(admin.jar, 'POST', `/api/orgs/${admin.orgId}/access-links`, {
    kind: 'public_guest', workspaceId: admin.workspaceId, roomId: admin.roomId, requiresApproval: true,
  });
  expect(created.status, created.raw).toBe(201);
  return { token: created.body.token as string, linkId: created.body.link.id as string };
}

describe('guest waiting room: approval, rejection and revocation', () => {
  it('waits for approval, then issues a guest session only after the admin approves', async () => {
    const admin = await createOwner('Guest Approver', '+14155559001');
    const link = await createApprovalLink(admin);

    const info = await api(null, 'GET', `/api/access/${link.token}/info`);
    expect(info.status, info.raw).toBe(200);
    expect(info.body).toMatchObject({
      kind: 'public_guest', requiresApproval: true, active: true,
      organizationName: 'Guest Approver Org',
      roomName: 'Reception', uses: 0,
    });

    const guest = new Jar();
    const waiting = await api(guest, 'POST', `/api/access/${link.token}/redeem`, { name: 'Test Guest' }, { csrf: false });
    expect(waiting.status, waiting.raw).toBe(202);
    expect(waiting.body.kind).toBe('waiting');
    expect(waiting.body.requestId).toBeTruthy();
    expect(waiting.body.session).toBeUndefined();
    expect(guest.get('saha_session')).toBeUndefined();
    const requestId = waiting.body.requestId as string;

    const pending = await api(null, 'GET', `/api/access/${link.token}/status?requestId=${requestId}`);
    expect(pending.status, pending.raw).toBe(200);
    expect(pending.body).toMatchObject({ status: 'pending', requestId, linkActive: true });

    const earlyRedeem = await api(guest, 'POST', `/api/access/${link.token}/redeem`, { name: 'Test Guest', requestId });
    expect(earlyRedeem.status, earlyRedeem.raw).toBe(400);
    expect(earlyRedeem.body.error.code).toBe('GUEST_PENDING');
    expect(guest.get('saha_session')).toBeUndefined();

    const queue = await api(admin.jar, 'GET', `/api/orgs/${admin.orgId}/access-links/guest-requests`);
    expect(queue.status, queue.raw).toBe(200);
    expect(queue.body.requests).toHaveLength(1);
    expect(queue.body.requests[0]).toMatchObject({
      id: requestId, linkId: link.linkId, organizationId: admin.orgId,
      name: 'Test Guest', status: 'pending', reviewedBy: null,
    });

    const approved = await api(admin.jar, 'POST',
      `/api/orgs/${admin.orgId}/access-links/guest-requests/${requestId}/approve`, {});
    expect(approved.status, approved.raw).toBe(200);
    expect(approved.body.request.status).toBe('approved');
    expect(approved.body.request.reviewedBy).toBe(admin.userId);

    const polled = await api(null, 'GET', `/api/access/${link.token}/status?requestId=${requestId}`);
    expect(polled.body.status).toBe('approved');

    const redeemed = await api(guest, 'POST', `/api/access/${link.token}/redeem`,
      { name: 'Test Guest', requestId }, { csrf: false });
    expect(redeemed.status, redeemed.raw).toBe(200);
    expect(redeemed.body).toMatchObject({
      kind: 'guest', organizationId: admin.orgId, workspaceId: admin.workspaceId, roomId: admin.roomId,
    });
    expect(guest.get('saha_session')).toBeTruthy();

    const me = await api(guest, 'GET', '/api/auth/me');
    expect(me.status, me.raw).toBe(200);
    expect(me.body).toMatchObject({ isGuest: true, activeOrgId: admin.orgId });
    expect(me.body.user.name).toBe('Test Guest');

    const state = store.read((draft) => draft);
    expect(state.guestRequests.find((request) => request.id === requestId)?.status).toBe('approved');
    expect(state.users.some((user) => user.id === `guest-${link.linkId.slice(0, 8)}`)).toBe(true);
    expect(state.authSessions.some((session) => session.kind === 'guest'
      && session.guestLinkId === link.linkId && !session.revokedAt)).toBe(true);
  });

  it('keeps a rejected guest out and records the review', async () => {
    const admin = await createOwner('Guest Rejecter', '+14155559002');
    const link = await createApprovalLink(admin);
    const guest = new Jar();
    const waiting = await api(guest, 'POST', `/api/access/${link.token}/redeem`, { name: 'Rejected Guest' }, { csrf: false });
    expect(waiting.status, waiting.raw).toBe(202);
    const requestId = waiting.body.requestId as string;

    const rejected = await api(admin.jar, 'POST',
      `/api/orgs/${admin.orgId}/access-links/guest-requests/${requestId}/reject`, {});
    expect(rejected.status, rejected.raw).toBe(200);
    expect(rejected.body.request.status).toBe('rejected');

    const polled = await api(null, 'GET', `/api/access/${link.token}/status?requestId=${requestId}`);
    expect(polled.body.status).toBe('rejected');

    const redeem = await api(guest, 'POST', `/api/access/${link.token}/redeem`,
      { name: 'Rejected Guest', requestId }, { csrf: false });
    expect(redeem.status, redeem.raw).toBe(400);
    expect(redeem.body.error.code).toBe('GUEST_REJECTED');
    expect(guest.get('saha_session')).toBeUndefined();

    const secondReview = await api(admin.jar, 'POST',
      `/api/orgs/${admin.orgId}/access-links/guest-requests/${requestId}/approve`, {});
    expect(secondReview.status).toBe(400);
    expect(secondReview.body.error.code).toBe('ALREADY_REVIEWED');
  });

  it('rejects pending requests and deactivates the link when the admin revokes it', async () => {
    const admin = await createOwner('Guest Revoker', '+14155559003');
    const link = await createApprovalLink(admin);
    const guest = new Jar();
    const waiting = await api(guest, 'POST', `/api/access/${link.token}/redeem`, { name: 'Waiting Guest' }, { csrf: false });
    expect(waiting.status, waiting.raw).toBe(202);
    const requestId = waiting.body.requestId as string;

    const revoked = await api(admin.jar, 'POST', `/api/orgs/${admin.orgId}/access-links/${link.linkId}/revoke`, {});
    expect(revoked.status, revoked.raw).toBe(200);
    expect(revoked.body).toEqual({ ok: true });

    const polled = await api(null, 'GET', `/api/access/${link.token}/status?requestId=${requestId}`);
    expect(polled.body).toMatchObject({ linkActive: false, status: 'rejected', requestId });
    const info = await api(null, 'GET', `/api/access/${link.token}/info`);
    expect(info.body.active).toBe(false);

    const redeem = await api(guest, 'POST', `/api/access/${link.token}/redeem`,
      { name: 'Waiting Guest', requestId }, { csrf: false });
    expect(redeem.status, redeem.raw).toBe(400);
    expect(redeem.body.error.code).toBe('INVALID_LINK');

    const queue = await api(admin.jar, 'GET', `/api/orgs/${admin.orgId}/access-links/guest-requests`);
    expect(queue.body.requests[0]).toMatchObject({ id: requestId, status: 'rejected' });
  });
});
