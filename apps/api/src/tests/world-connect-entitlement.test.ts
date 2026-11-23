import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';

// Permanent runtime evidence for X-ACC-01: two real WebSocket clients against
// a real Express + ws server on the local JSON adapter. No database or media.
const dataFile = join(tmpdir(), `saha-world-entitlement-${process.pid}.json`);
process.env.LOCAL_DATA_FILE = dataFile;
process.env.APP_URL = 'http://localhost:5173';
process.env.COOKIE_SECURE = 'false';
process.env.ALLOW_DEMO_SEED = 'true';
delete process.env.DATA_ADAPTER;

const { store } = await import('../common/store.js');
const { createApp } = await import('../app.js');
const { attachWorldServer } = await import('../modules/world/socket.js');
const { DEFAULT_LIMITS } = await import('../modules/billing/entitlements.js');

let server: Server;
let baseUrl = '';
let wsUrl = '';

interface Jar { cookies: Map<string, string>; csrf: string }

function jar(): Jar { return { cookies: new Map(), csrf: '' }; }

async function call(state: Jar, method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Cookie: [...state.cookies].map(([key, value]) => `${key}=${value}`).join('; '),
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (body !== undefined && state.csrf) headers['x-csrf-token'] = state.csrf;
  const response = await fetch(`${baseUrl}${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  for (const raw of response.headers.getSetCookie()) {
    const [pair] = raw.split(';');
    const at = pair!.indexOf('=');
    if (at < 0) continue;
    const name = pair!.slice(0, at).trim();
    const value = pair!.slice(at + 1).trim();
    if (!value || /expires=Thu, 01 Jan 1970/i.test(raw)) state.cookies.delete(name);
    else state.cookies.set(name, value);
  }
  state.csrf = state.cookies.get('saha_csrf') ?? state.csrf;
  const text = await response.text();
  let json: any = text;
  try { json = JSON.parse(text); } catch { /* non-JSON response */ }
  return { status: response.status, json };
}

async function login(phone: string): Promise<{ state: Jar; orgId: string; workspaceId: string; ticket: string }> {
  const state = jar();
  const logged = await call(state, 'POST', '/api/auth/login', { phone, password: 'Demo1234!' },);
  expect(logged.status).toBe(200);
  const me = await call(state, 'GET', '/api/auth/me');
  const orgId = me.json.activeOrgId as string;
  const workspaces = await call(state, 'GET', `/api/orgs/${orgId}/workspaces`);
  const ticketResponse = await call(state, 'POST', '/api/auth/ws-ticket', {});
  expect(ticketResponse.status).toBe(200);
  return {
    state, orgId,
    workspaceId: workspaces.json.workspaces[0].id as string,
    ticket: ticketResponse.json.ticket as string,
  };
}

function connect(user: { orgId: string; workspaceId: string; ticket: string }) {
  const url = `${wsUrl}?token=${encodeURIComponent(user.ticket)}&orgId=${encodeURIComponent(user.orgId)}&workspaceId=${encodeURIComponent(user.workspaceId)}`;
  const socket = new WebSocket(url, { origin: 'http://localhost:5173' });
  return socket;
}

function waitForWelcome(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('welcome timeout')), 5000);
    socket.on('message', function onMessage(raw: Buffer) {
      const message = JSON.parse(raw.toString()) as { type: string };
      if (message.type === 'welcome') {
        clearTimeout(timer);
        socket.off('message', onMessage);
        resolve();
      }
    });
    socket.once('error', (error) => { clearTimeout(timer); reject(error); });
  });
}

function waitForClose(socket: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('close timeout')), 5000);
    socket.once('close', (code, reason) => {
      clearTimeout(timer);
      resolve({ code, reason: reason.toString() });
    });
    socket.once('error', (error) => { clearTimeout(timer); reject(error); });
  });
}

beforeAll(async () => {
  store.reset();
  server = createServer(createApp());
  attachWorldServer(server);
  server.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
  wsUrl = `ws://127.0.0.1:${port}/ws/world`;
  const bootstrap = jar();
  const seeded = await call(bootstrap, 'POST', '/api/demo/seed', {});
  expect(seeded.status).toBe(200);

  // Give the demo organization a one-seat plan; everything else stays generous.
  await store.mutate((draft) => {
    const org = draft.organizations[0]!;
    draft.plans.push({
      id: 'plan-one-seat', name: 'One seat', description: 'runtime test plan',
      interval: 'monthly', priceCents: 0, currency: 'EGP', features: [],
      limits: { ...DEFAULT_LIMITS, concurrentUsers: 1 },
      status: 'active', createdAt: '2026-11-23T00:00:00.000Z',
    });
    draft.subscriptions.push({
      id: 'sub-one-seat', organizationId: org.id, planId: 'plan-one-seat', status: 'active',
      trialEndsAt: null, currentPeriodStart: '2026-11-01T00:00:00.000Z',
      currentPeriodEnd: '2026-12-01T00:00:00.000Z', cancelAtPeriodEnd: false,
      graceUntil: null, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z',
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  server.closeAllConnections();
  rmSync(dataFile, { force: true });
});

describe('X-ACC-01 live world entitlement gate (real WebSocket)', () => {
  it('denies the second concurrent user and admits another after disconnect', async () => {
    const first = await login('+201000000001');
    const second = await login('+201000000002');
    const socketA = connect(first);
    await waitForWelcome(socketA);

    const socketB = connect(second);
    const closed = await waitForClose(socketB);
    expect(closed.code).toBe(4029);
    expect(closed.reason).toBe('QUOTA_EXCEEDED');

    socketA.close();
    await waitForClose(socketA);

    const socketC = connect(second);
    await waitForWelcome(socketC);
    socketC.close();
    await waitForClose(socketC);
  }, 20_000);
});
