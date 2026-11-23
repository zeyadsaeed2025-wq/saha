import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { rmSync } from 'node:fs';
import type { NextFunction, Request, Response as ExpressResponse } from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Stage 3 billing coverage over the real routers with the LOCAL JSON adapter.
// No card is charged and no payment provider is contacted: the webhook is signed
// locally with a test secret so its tenant scoping and dedupe can be verified.
const dataFile = join(tmpdir(), `saha-stage3-billing-tests-${process.pid}.json`);
process.env.LOCAL_DATA_FILE = dataFile;
delete process.env.DATA_ADAPTER;
process.env.COOKIE_SECURE = 'false';
process.env.APP_URL = 'http://localhost:5173';

const priorBillingSecret = process.env.BILLING_WEBHOOK_SECRET;
delete process.env.BILLING_WEBHOOK_SECRET;

const express = (await import('express')).default;
const { store } = await import('../common/store.js');
const { createApp } = await import('../app.js');
const { DEFAULT_LIMITS } = await import('../modules/billing/entitlements.js');
const { billingWebhooksRouter } = await import('../modules/billing/webhooks.js');
const { AppError } = await import('../common/errors.js');

const PASSWORD = 'Passw0rd!';
const WEBHOOK_SECRET = 'test-secret';
const DAY_MS = 86_400_000;
let server: Server;
let baseUrl = '';
let webhookServer: Server;
let webhookBaseUrl = '';

// NOTE: the main app currently mounts webhooksRouter at /api/webhooks before
// billingWebhooksRouter at /api/webhooks/billing, so /:provider shadows the
// billing router with a 400 BILLING_WEBHOOK response. To exercise the real
// billing webhook handler, this file mounts that same router directly on an
// isolated Express app (sharing the same store singleton). The shadowing bug is
// reported separately rather than worked around in application code.
beforeAll(async () => {
  server = createApp().listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const webhookApp = express();
  webhookApp.use(express.json());
  webhookApp.use('/api/webhooks/billing', billingWebhooksRouter);
  // Mirror createApp()'s AppError serializer so assertions can inspect error codes.
  webhookApp.use((error: unknown, _req: Request, res: ExpressResponse, _next: NextFunction) => {
    if (error instanceof AppError) {
      return res.status(error.status).json({
        error: { code: error.code, message: error.message, details: error.details },
      });
    }
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  });
  webhookServer = webhookApp.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    webhookServer.once('listening', resolve);
    webhookServer.once('error', reject);
  });
  webhookBaseUrl = `http://127.0.0.1:${(webhookServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await Promise.all([server, webhookServer].map((target) => new Promise<void>((resolve, reject) => {
    target.close((error) => (error ? reject(error) : resolve()));
  })));
  server.closeAllConnections();
  webhookServer.closeAllConnections();
  rmSync(dataFile, { force: true });
  if (priorBillingSecret === undefined) delete process.env.BILLING_WEBHOOK_SECRET;
  else process.env.BILLING_WEBHOOK_SECRET = priorBillingSecret;
});

beforeEach(() => {
  store.reset();
  delete process.env.BILLING_WEBHOOK_SECRET;
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
  options: { csrf?: boolean; headers?: Record<string, string>; base?: string } = {}): Promise<Result> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const cookies = jar?.header();
  if (cookies) headers.Cookie = cookies;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const csrf = jar?.get('saha_csrf');
  if ((options.csrf ?? true) && !['GET', 'HEAD', 'OPTIONS'].includes(method) && csrf) {
    headers['x-csrf-token'] = csrf;
  }
  Object.assign(headers, options.headers);
  const response = await fetch(`${options.base ?? baseUrl}${path}`, {
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
  return { jar, orgId: created.body.organization.id as string, userId: signedIn.body.user.id as string };
}

function sign(body: unknown): string {
  return createHmac('sha256', WEBHOOK_SECRET).update(JSON.stringify(body)).digest('hex');
}

describe('stage 3 billing: catalog, entitlements and subscription lifecycle', () => {
  it('lists three active plans idempotently and reports default entitlements', async () => {
    const owner = await createOwner('Billing Catalog Admin', '+14155558001');
    const base = `/api/orgs/${owner.orgId}/billing`;

    const first = await api(owner.jar, 'GET', `${base}/plans`);
    expect(first.status, first.raw).toBe(200);
    expect(first.body.plans).toHaveLength(3);
    expect(first.body.plans.map((p: { id: string }) => p.id)).toEqual(['plan-free', 'plan-pro', 'plan-school']);
    expect(first.body.plans.every((p: { status: string; limits: object }) =>
      p.status === 'active' && Object.keys(p.limits).length > 0)).toBe(true);

    const second = await api(owner.jar, 'GET', `${base}/plans`);
    expect(second.body.plans).toHaveLength(3);
    expect(second.body.plans.map((p: { id: string }) => p.id)).toEqual(
      first.body.plans.map((p: { id: string }) => p.id));

    const overview = await api(owner.jar, 'GET', `${base}/overview`);
    expect(overview.status, overview.raw).toBe(200);
    expect(overview.body.subscription).toBeNull();
    expect(overview.body.invoices).toEqual([]);
    expect(overview.body.entitlements).toMatchObject({
      planId: null, planName: 'Default plan', status: 'none', limits: DEFAULT_LIMITS,
    });
    expect(overview.body.entitlements.usage.members).toBe(1);
    expect(overview.body.entitlements.remaining.members).toBe(DEFAULT_LIMITS.members - 1);
  });

  it('starts a 14-day trial, reflects the plan, then schedules cancellation without revoking access', async () => {
    const owner = await createOwner('Trial Admin', '+14155558002');
    const base = `/api/orgs/${owner.orgId}/billing`;
    const before = Date.now();

    const subscribed = await api(owner.jar, 'POST', `${base}/subscribe`, { planId: 'plan-pro' });
    expect(subscribed.status, subscribed.raw).toBe(200);
    expect(subscribed.body.subscription).toMatchObject({
      organizationId: owner.orgId, planId: 'plan-pro', status: 'trialing', cancelAtPeriodEnd: false,
    });
    const trialMs = Date.parse(subscribed.body.subscription.trialEndsAt) - before;
    expect(trialMs).toBeGreaterThan(13.9 * DAY_MS);
    expect(trialMs).toBeLessThan(14.1 * DAY_MS);

    const overview = await api(owner.jar, 'GET', `${base}/overview`);
    expect(overview.body.entitlements).toMatchObject({ planId: 'plan-pro', planName: 'Pro', status: 'trialing' });
    expect(overview.body.entitlements.limits.members).toBe(250);
    expect(overview.body.subscription.id).toBe(subscribed.body.subscription.id);

    const cancelled = await api(owner.jar, 'POST', `${base}/cancel`, { atPeriodEnd: true });
    expect(cancelled.status, cancelled.raw).toBe(200);
    expect(cancelled.body.subscription).toMatchObject({ cancelAtPeriodEnd: true, status: 'trialing' });

    const afterCancel = await api(owner.jar, 'GET', `${base}/overview`);
    expect(afterCancel.body.entitlements.planId).toBe('plan-pro');
    expect(afterCancel.body.entitlements.status).toBe('trialing');

    const reversed = await api(owner.jar, 'POST', `${base}/cancel`, { atPeriodEnd: false });
    expect(reversed.body.subscription.cancelAtPeriodEnd).toBe(false);
  });

  it('exports only the requested organization’s members, workspaces, attendance and invoices', async () => {
    const a = await createOwner('Export Admin A', '+14155558003');
    const b = await createOwner('Export Admin B', '+14155558004');
    const added = await api(a.jar, 'POST', `/api/orgs/${a.orgId}/members`, {
      phone: '+14155558005', name: 'Export Student', role: 'student', team: 'Learners',
    });
    expect(added.status, added.raw).toBe(201);

    await store.mutate((draft) => {
      const makeInvoice = (orgId: string, id: string) => draft.invoices.push({
        id, organizationId: orgId, subscriptionId: `sub-${orgId}`, amountCents: 1234,
        currency: 'USD', status: 'open', periodStart: '2026-10-01T00:00:00.000Z',
        periodEnd: '2026-10-31T00:00:00.000Z', providerEventId: null,
        createdAt: '2026-10-01T00:00:00.000Z',
      });
      const makeAttendance = (orgId: string, userId: string, id: string) => {
        const scheduledId = `scheduled-${id}`;
        draft.scheduledSessions.push({
          id: scheduledId, organizationId: orgId, scheduleRuleId: `rule-${id}`, userId,
          kind: 'shift', title: `Private shift ${id}`, startsAt: '2026-10-02T09:00:00.000Z',
          endsAt: '2026-10-02T10:00:00.000Z', graceMinutes: 10, minimumMinutes: 60,
          status: 'scheduled', policySnapshot: {}, createdAt: '2026-10-01T00:00:00.000Z',
        });
        draft.attendanceSessions.push({
          id, organizationId: orgId, scheduledSessionId: scheduledId, userId,
          firstJoin: '2026-10-02T09:00:00.000Z', lastLeave: '2026-10-02T10:00:00.000Z',
          lastHeartbeat: '2026-10-02T10:00:00.000Z', status: 'on_time',
          rawLatenessSeconds: 0, countedLatenessSeconds: 0, confirmedConnectedSeconds: 3600,
          breakSeconds: 0, earlyLeaveSeconds: 0, finalizedAt: null, note: '',
          createdAt: '2026-10-02T09:00:00.000Z',
        });
      };
      makeInvoice(a.orgId, 'inv-org-a');
      makeInvoice(b.orgId, 'inv-org-b');
      makeAttendance(a.orgId, a.userId, 'attendance-org-a');
      makeAttendance(b.orgId, b.userId, 'attendance-org-b');
    });

    const exported = await api(a.jar, 'GET', `/api/orgs/${a.orgId}/billing/export`);
    expect(exported.status, exported.raw).toBe(200);
    expect(exported.body.organization.id).toBe(a.orgId);
    expect(exported.body.members.map((m: { userId: string }) => m.userId).sort()).toEqual(
      [a.userId, added.body.member.userId].sort());
    expect(exported.body.workspaces.every((w: { id: string }) => typeof w.id === 'string')).toBe(true);
    expect(exported.body.workspaces).toHaveLength(1); // the default workspace of A
    expect(exported.body.attendanceSessions.map((s: { id: string }) => s.id)).toEqual(['attendance-org-a']);
    expect(exported.body.attendanceSessions[0].title).toBe('Private shift attendance-org-a');
    expect(exported.body.invoices.map((i: { id: string }) => i.id)).toEqual(['inv-org-a']);
    expect(exported.raw).not.toContain(b.orgId);
    expect(exported.raw).not.toContain('inv-org-b');
    expect(exported.raw).not.toContain('attendance-org-b');
    expect(exported.raw).not.toContain('Private shift attendance-org-b');

    const reverse = await api(b.jar, 'GET', `/api/orgs/${b.orgId}/billing/export`);
    expect(reverse.body.invoices.map((i: { id: string }) => i.id)).toEqual(['inv-org-b']);
    expect(reverse.raw).not.toContain('inv-org-a');
  });
});

describe('stage 3 billing webhook: HMAC, dedupe and tenant resolution', () => {
  it('requires a configured secret and a valid signature', async () => {
    const owner = await createOwner('Webhook Billing Admin', '+14155558006');
    const body = { id: 'evt-b-unsigned', type: 'invoice.paid', data: { object: { id: 'inv-none' } } };
    const missing = await api(null, 'POST', '/api/webhooks/billing', body, { csrf: false, base: webhookBaseUrl });
    expect(missing.status, missing.raw).toBe(503);
    expect(missing.body.error.code).toBe('PROVIDER_NOT_CONFIGURED');

    process.env.BILLING_WEBHOOK_SECRET = WEBHOOK_SECRET;
    try {
      const bad = await api(null, 'POST', '/api/webhooks/billing', body, {
        csrf: false, base: webhookBaseUrl, headers: { 'x-webhook-signature': 'not-a-hash' },
      });
      expect(bad.status, bad.raw).toBe(400);
      expect(bad.body.error.code).toBe('INVALID_SIGNATURE');
      expect(store.read((state) => state.paymentEvents)).toHaveLength(0);
    } finally {
      delete process.env.BILLING_WEBHOOK_SECRET;
    }
    expect(owner.orgId).toBeTruthy();
  });

  it('marks the matching invoice paid once and ignores replays', async () => {
    const owner = await createOwner('Paid Invoice Admin', '+14155558007');
    await store.mutate((draft) => {
      draft.invoices.push({
        id: 'inv-b1', organizationId: owner.orgId, subscriptionId: 'sub-b1', amountCents: 100,
        currency: 'USD', status: 'open', periodStart: '2026-11-01T00:00:00.000Z',
        periodEnd: '2026-11-30T00:00:00.000Z', providerEventId: null,
        createdAt: '2026-11-01T00:00:00.000Z',
      });
    });
    const body = {
      id: 'evt-b1', type: 'invoice.paid',
      data: { object: { id: 'inv-b1', amount: 100, status: 'paid', metadata: { organizationId: owner.orgId } } },
    };
    process.env.BILLING_WEBHOOK_SECRET = WEBHOOK_SECRET;
    try {
      const first = await api(null, 'POST', '/api/webhooks/billing', body, {
        csrf: false, base: webhookBaseUrl, headers: { 'x-webhook-signature': sign(body) },
      });
      expect(first.status, first.raw).toBe(200);
      expect(first.body).toEqual({ received: true, duplicate: false });

      const state = store.read((draft) => draft);
      expect(state.paymentEvents).toHaveLength(1);
      expect(state.paymentEvents[0]).toMatchObject({
        organizationId: owner.orgId, invoiceId: 'inv-b1', eventId: 'evt-b1',
        type: 'invoice.paid', amountCents: 100,
      });
      expect(state.invoices.find((invoice) => invoice.id === 'inv-b1')).toMatchObject({
        organizationId: owner.orgId, status: 'paid', providerEventId: 'evt-b1',
      });

      const replay = await api(null, 'POST', '/api/webhooks/billing', body, {
        csrf: false, base: webhookBaseUrl, headers: { 'x-webhook-signature': sign(body) },
      });
      expect(replay.status, replay.raw).toBe(200);
      expect(replay.body).toEqual({ received: true, duplicate: true });
      const after = store.read((draft) => draft);
      expect(after.paymentEvents).toHaveLength(1);
      expect(after.auditLogs.filter((log) => log.action === 'billing.webhook')).toHaveLength(1);

      // A second, distinct event type resolves the same organization's subscription.
      const update = {
        id: 'evt-b2', type: 'customer.subscription.updated',
        data: { object: {
          status: 'active', metadata: { organizationId: owner.orgId, planId: 'plan-free' },
        } },
      };
      const subscribed = await api(owner.jar, 'POST', `/api/orgs/${owner.orgId}/billing/subscribe`, { planId: 'plan-pro' });
      expect(subscribed.status, subscribed.raw).toBe(200);
      const updated = await api(null, 'POST', '/api/webhooks/billing', update, {
        csrf: false, base: webhookBaseUrl, headers: { 'x-webhook-signature': sign(update) },
      });
      expect(updated.status, updated.raw).toBe(200);
      expect(updated.body.duplicate).toBe(false);
      const subscription = store.read((draft) =>
        draft.subscriptions.find((item) => item.organizationId === owner.orgId));
      expect(subscription).toMatchObject({ planId: 'plan-free', status: 'active', organizationId: owner.orgId });
    } finally {
      delete process.env.BILLING_WEBHOOK_SECRET;
    }
  });

  it('never applies an event that cannot resolve an organization', async () => {
    const owner = await createOwner('Unresolved Webhook Admin', '+14155558008');
    await api(owner.jar, 'POST', `/api/orgs/${owner.orgId}/billing/subscribe`, { planId: 'plan-pro' });
    const body = {
      id: 'evt-b3', type: 'customer.subscription.deleted',
      data: { object: { id: 'sub-unknown', status: 'canceled' } },
    };
    process.env.BILLING_WEBHOOK_SECRET = WEBHOOK_SECRET;
    try {
      const result = await api(null, 'POST', '/api/webhooks/billing', body, {
        csrf: false, base: webhookBaseUrl, headers: { 'x-webhook-signature': sign(body) },
      });
      expect(result.status, result.raw).toBe(200);
      const state = store.read((draft) => draft);
      expect(state.paymentEvents[0]).toMatchObject({ organizationId: '', status: 'ignored', invoiceId: null });
      expect(state.subscriptions.find((s) => s.organizationId === owner.orgId)).toMatchObject({
        planId: 'plan-pro', status: 'trialing',
      });
    } finally {
      delete process.env.BILLING_WEBHOOK_SECRET;
    }
  });
});
