import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rmSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dataFile = join(tmpdir(), `saha-rate-limit-tests-${process.pid}.json`);
process.env.LOCAL_DATA_FILE = dataFile;
delete process.env.DATA_ADAPTER;
process.env.COOKIE_SECURE = 'false';
process.env.APP_URL = 'http://localhost:5173';
process.env.API_RATE_LIMIT_MAX = '2';
process.env.AUTH_RATE_LIMIT_MAX = '2';
process.env.LINK_RATE_LIMIT_MAX = '2';

const { createApp } = await import('../app.js');
const { store } = await import('../common/store.js');

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

async function get(path: string): Promise<{ status: number; code?: string }> {
  const response = await fetch(`${baseUrl}${path}`, { headers: { Accept: 'application/json' } });
  const body = await response.json().catch(() => ({})) as { error?: { code?: string } };
  return { status: response.status, code: body.error?.code };
}

async function failedLogin(): Promise<number> {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ phone: '+14155559999', password: 'WrongPassw0rd!' }),
  });
  return response.status;
}

describe('mounted rate limiters (single-instance, in-process)', () => {
  it('throttles the third request to the general API path', async () => {
    expect((await get('/api/health')).status).toBe(200);
    expect((await get('/api/health')).status).toBe(200);
    const third = await get('/api/health');
    expect(third.status, JSON.stringify(third)).toBe(429);
    expect(third.code).toBe('RATE_LIMITED');
  });

  it('throttles repeated authentication attempts', async () => {
    expect(await failedLogin()).toBe(401);
    expect(await failedLogin()).toBe(401);
    expect(await failedLogin()).toBe(429);
  });

  it('throttles repeated link redemption-status polls', async () => {
    expect((await get('/api/access/missing/status')).status).toBe(404);
    expect((await get('/api/access/missing/status')).status).toBe(404);
    expect((await get('/api/access/missing/status')).status).toBe(429);
  });

  it('keeps the local store usable after throttling', () => {
    expect(store.kind).toBe('local-json');
  });
});
