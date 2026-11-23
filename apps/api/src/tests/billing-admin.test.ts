import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { rmSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Platform plan CRUD, monthly/annual periods and server-side feature gates over
// the real Express app. No payment provider is contacted; a subscription is a
// local trial/assignment and never implies a charge.
const dataFile = join(tmpdir(), `saha-billing-admin-tests-${process.pid}.json`);
process.env.LOCAL_DATA_FILE = dataFile;
delete process.env.DATA_ADAPTER;
process.env.COOKIE_SECURE = 'false';
process.env.APP_URL = 'http://localhost:5173';
delete process.env.CREDENTIAL_MASTER_KEY;

const { store } = await import('../common/store.js');
const { hashPassword } = await import('../common/security.js');
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

async function api(jar: Jar | null, method: string, path: string, body?: unknown): Promise<Result> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const cookies = jar?.header();
  if (cookies) headers.Cookie = cookies;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const csrf = jar?.get('saha_csrf');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && csrf) headers['x-csrf-token'] = csrf;
  const response = await fetch(`${baseUrl}${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  jar?.ingest(response);
  const raw = await response.text();
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { parsed = raw; }
  return { status: response.status, body: parsed, raw };
}

async function login(phone: string): Promise<Jar> {
  const jar = new Jar();
  const result = await api(jar, 'POST', '/api/auth/login', { phone, password: PASSWORD });
  expect(result.status, result.raw).toBe(200);
  return jar;
}

async function createOwner(phone: string) {
  const jar = new Jar();
  const registered = await api(jar, 'POST', '/api/auth/register',
    { name: `Plan Org ${phone.slice(-3)}`, phone, password: PASSWORD });
  expect(registered.status, registered.raw).toBe(201);
  const signedIn = await api(jar, 'POST', '/api/auth/login', { phone, password: PASSWORD });
  expect(signedIn.status, signedIn.raw).toBe(200);
  const created = await api(jar, 'POST', '/api/orgs', { name: `Plan Org ${phone.slice(-3)}`, timezone: 'UTC' });
  expect(created.status, created.raw).toBe(201);
  return { jar, orgId: created.body.organization.id as string };
}

async function createSuperAdmin(): Promise<Jar> {
  await store.mutate((draft) => {
    draft.users.push({
      id: 'super-admin-seed', phone: '+10000000019', name: 'Platform Admin',
      passwordHash: hashPassword(PASSWORD), status: 'active',
      verifiedAt: new Date().toISOString(), createdAt: new Date().toISOString(),
    });
  });
  return login('+10000000019');
}

const annualPlan = {
  name: 'Pro Annual',
  description: 'Annual plan with media only.',
  interval: 'annual',
  priceCents: 99_000,
  limits: { members: 5, concurrentUsers: 4 },
  featureKeys: ['media'],
};

describe('platform plan administration', () => {
  it('requires a super admin and supports full plan CRUD', async () => {
    const owner = await createOwner('+14155559101');
    const denied = await api(owner.jar, 'POST', '/api/admin/plans', annualPlan);
    expect(denied.status).toBe(403);

    const admin = await createSuperAdmin();
    const catalog = await api(admin, 'GET', '/api/admin/plans');
    expect(catalog.status, catalog.raw).toBe(200);
    expect(catalog.body.plans.length).toBeGreaterThanOrEqual(3);

    const created = await api(admin, 'POST', '/api/admin/plans', annualPlan);
    expect(created.status, created.raw).toBe(201);
    const id = created.body.plan.id as string;
    expect(created.body.plan).toMatchObject({
      interval: 'annual', priceCents: 99_000, status: 'active',
      featureKeys: ['media'], limits: { members: 5, concurrentUsers: 4 },
    });
    expect(created.body.plan.limits.rooms).toBeGreaterThan(0);

    const updated = await api(admin, 'PATCH', `/api/admin/plans/${id}`, {
      name: 'Pro Annual Plus', limits: { members: 8 },
    });
    expect(updated.status, updated.raw).toBe(200);
    expect(updated.body.plan).toMatchObject({ name: 'Pro Annual Plus', limits: { members: 8 } });
    expect(updated.body.plan.limits.concurrentUsers).toBe(4);

    const archived = await api(admin, 'POST', `/api/admin/plans/${id}/status`, { status: 'archived' });
    expect(archived.status, archived.raw).toBe(200);
    expect(archived.body.plan.status).toBe('archived');
    const visible = await api(owner.jar, 'GET', `/api/orgs/${owner.orgId}/billing/plans`);
    expect(visible.body.plans.some((plan: { id: string }) => plan.id === id)).toBe(false);
  });

  it('applies annual periods and plan features on assignment and self-service subscribe', async () => {
    const owner = await createOwner('+14155559102');
    const admin = await createSuperAdmin();
    const created = await api(admin, 'POST', '/api/admin/plans', annualPlan);
    const planId = created.body.plan.id as string;

    const assigned = await api(admin, 'POST', `/api/admin/organizations/${owner.orgId}/plan`, { planId });
    expect(assigned.status, assigned.raw).toBe(200);
    const days = (new Date(assigned.body.subscription.currentPeriodEnd).getTime()
      - new Date(assigned.body.subscription.currentPeriodStart).getTime()) / 86_400_000;
    expect(assigned.body.subscription).toMatchObject({ planId, interval: 'annual', status: 'active' });
    expect(days).toBe(365);

    const overview = await api(owner.jar, 'GET', `/api/orgs/${owner.orgId}/billing/overview`);
    expect(overview.body.entitlements).toMatchObject({
      planId, planName: 'Pro Annual', features: ['media'], limits: { members: 5 },
    });

    const subscribed = await api(owner.jar, 'POST', `/api/orgs/${owner.orgId}/billing/subscribe`,
      { planId, interval: 'annual' });
    expect(subscribed.status, subscribed.raw).toBe(200);
    const subscribedDays = (new Date(subscribed.body.subscription.currentPeriodEnd).getTime()
      - new Date(subscribed.body.subscription.currentPeriodStart).getTime()) / 86_400_000;
    expect(subscribed.body.subscription.interval).toBe('annual');
    expect(subscribedDays).toBe(365);
    expect(subscribed.raw).not.toContain('paymentCollected":true');
  });

  it('denies features omitted by the assigned plan and restores them on plan change', async () => {
    const owner = await createOwner('+14155559103');
    const admin = await createSuperAdmin();
    const restricted = await api(admin, 'POST', '/api/admin/plans', annualPlan);
    const restrictedId = restricted.body.plan.id as string;
    await api(admin, 'POST', `/api/admin/organizations/${owner.orgId}/plan`, { planId: restrictedId });

    const base = `/api/orgs/${owner.orgId}`;
    const allowed = await api(owner.jar, 'GET', `${base}/media/status`);
    expect(allowed.status, allowed.raw).toBe(200);
    for (const path of ['/ai/insights', '/recordings', '/integrations', '/customization/avatar', '/drive/status']) {
      const result = await api(owner.jar, 'GET', `${base}${path}`);
      expect(result.status, `${path}: ${result.raw}`).toBe(403);
      expect(result.body.error.code).toBe('FEATURE_NOT_ENABLED');
    }

    const inUse = await api(admin, 'POST', `/api/admin/plans/${restrictedId}/status`, { status: 'archived' });
    expect(inUse.status).toBe(409);
    expect(inUse.body.error.code).toBe('PLAN_IN_USE');

    await api(admin, 'POST', `/api/admin/organizations/${owner.orgId}/plan`, { planId: 'plan-free' });
    const restored = await api(owner.jar, 'GET', `${base}/ai/insights`);
    expect(restored.status, restored.raw).toBe(200);
    const archived = await api(admin, 'POST', `/api/admin/plans/${restrictedId}/status`, { status: 'archived' });
    expect(archived.status, archived.raw).toBe(200);
  });
});
