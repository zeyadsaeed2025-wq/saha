import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { rmSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Encrypted credential vault: real AES-GCM operations plus real HTTP routes on
// the local JSON adapter. No external provider is contacted and no plaintext
// secret is ever returned by an API response in these tests.
const dataFile = join(tmpdir(), `saha-vault-tests-${process.pid}.json`);
process.env.LOCAL_DATA_FILE = dataFile;
delete process.env.DATA_ADAPTER;
process.env.COOKIE_SECURE = 'false';
process.env.APP_URL = 'http://localhost:5173';

const KEY_A = 'a'.repeat(64);
const KEY_B = 'b'.repeat(64);
const PASSWORD = 'Passw0rd!';
process.env.CREDENTIAL_MASTER_KEY = KEY_A;
process.env.CREDENTIAL_KEY_VERSION = '1';
delete process.env.CREDENTIAL_MASTER_KEY_PREVIOUS;

const { store } = await import('../common/store.js');
const { hashPassword } = await import('../common/security.js');
const {
  maskSecret, openSecret, sealSecret, secretsEqual,
} = await import('../common/secrets.js');
const {
  createCredential, credentialStatus, publicCredential, resolveCredential,
} = await import('../modules/credentials/service.js');
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
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  server.closeAllConnections();
  rmSync(dataFile, { force: true });
  delete process.env.CREDENTIAL_MASTER_KEY;
  delete process.env.CREDENTIAL_KEY_VERSION;
  delete process.env.CREDENTIAL_MASTER_KEY_PREVIOUS;
});

beforeEach(() => {
  store.reset();
  process.env.CREDENTIAL_MASTER_KEY = KEY_A;
  process.env.CREDENTIAL_KEY_VERSION = '1';
  delete process.env.CREDENTIAL_MASTER_KEY_PREVIOUS;
});

afterEach(() => {
  process.env.CREDENTIAL_MASTER_KEY = KEY_A;
  process.env.CREDENTIAL_KEY_VERSION = '1';
  delete process.env.CREDENTIAL_MASTER_KEY_PREVIOUS;
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

async function registerAndLogin(name: string, phone: string): Promise<Jar> {
  const jar = new Jar();
  const registered = await api(null, 'POST', '/api/auth/register', { name, phone, password: PASSWORD });
  expect(registered.status, registered.raw).toBe(201);
  const signedIn = await api(jar, 'POST', '/api/auth/login', { phone, password: PASSWORD });
  expect(signedIn.status, signedIn.raw).toBe(200);
  return jar;
}

async function createOwner(name: string, phone: string) {
  const jar = await registerAndLogin(name, phone);
  const created = await api(jar, 'POST', '/api/orgs', { name: `${name} Org`, timezone: 'UTC' });
  expect(created.status, created.raw).toBe(201);
  return { jar, orgId: created.body.organization.id as string };
}

async function createSuperAdmin(): Promise<Jar> {
  await store.mutate((draft) => {
    draft.users.push({
      id: 'super-admin-seed', phone: '+10000000009', name: 'Platform Admin',
      passwordHash: hashPassword(PASSWORD), status: 'active',
      verifiedAt: new Date().toISOString(), createdAt: new Date().toISOString(),
    });
  });
  const jar = new Jar();
  const signedIn = await api(jar, 'POST', '/api/auth/login', { phone: '+10000000009', password: PASSWORD });
  expect(signedIn.status, signedIn.raw).toBe(200);
  return jar;
}

const SECRET = 'sk_live_SUPER_SECRET_VALUE_12345';

function newCredential(overrides: Partial<Parameters<typeof createCredential>[0]> = {}) {
  return createCredential({
    organizationId: 'org-1', kind: 'organization_integration', provider: 'google_drive',
    name: 'Drive integration', value: SECRET, scopes: ['drive.read'], expiresAt: null,
    ...overrides,
  }, 'user-1');
}

describe('credential vault crypto', () => {
  it('round-trips a secret with a unique IV and stamped key version', () => {
    const first = sealSecret(SECRET);
    const second = sealSecret(SECRET);
    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(first.iv).not.toBe(second.iv);
    expect(first.keyVersion).toBe(1);
    expect(openSecret(first)).toBe(SECRET);
    expect(first.ciphertext).not.toContain(SECRET);
  });

  it('rejects tampered ciphertext, IV and auth tag instead of leaking plaintext', () => {
    const sealed = sealSecret(SECRET);
    const flip = (value: string) => {
      const chars = value.split('');
      chars[0] = chars[0] === 'A' ? 'B' : 'A';
      return chars.join('');
    };
    expect(openSecret({ ...sealed, ciphertext: flip(sealed.ciphertext) })).toBeNull();
    expect(openSecret({ ...sealed, iv: flip(sealed.iv) })).toBeNull();
    expect(openSecret({ ...sealed, authTag: flip(sealed.authTag) })).toBeNull();
  });

  it('supports previous-key decryption only while a previous key is configured', () => {
    const sealed = sealSecret(SECRET);
    process.env.CREDENTIAL_MASTER_KEY = KEY_B;
    expect(openSecret(sealed)).toBeNull();
    process.env.CREDENTIAL_MASTER_KEY_PREVIOUS = KEY_A;
    expect(openSecret(sealed)).toBe(SECRET);
  });

  it('masks values without exposing the middle and compares secrets in constant time', () => {
    const masked = maskSecret(SECRET);
    expect(masked).toContain('sk_');
    expect(masked).not.toContain('SUPER_SECRET_VALUE');
    expect(maskSecret('short')).toBe('••••••••');
    expect(secretsEqual(SECRET, SECRET)).toBe(true);
    expect(secretsEqual(SECRET, `${SECRET}x`)).toBe(false);
  });
});

describe('credential vault service', () => {
  it('never includes sealed material in the public projection', () => {
    const record = newCredential();
    const view = publicCredential(record);
    const json = JSON.stringify(view);
    expect(record.ciphertext).not.toContain(SECRET);
    for (const field of ['ciphertext', 'iv', 'authTag'] as const) {
      expect(json).not.toContain(`"${field}"`);
      expect(json).not.toContain(record[field]);
    }
    expect(json).not.toContain('"value"');
    expect(view.status).toBe('active');
  });

  it('enforces organization, provider, kind, scopes, expiry and revocation on resolve', () => {
    const record = newCredential();
    const records = [record];
    expect(resolveCredential(records, {
      organizationId: 'org-1', provider: 'google_drive', kind: 'organization_integration',
      requiredScope: 'drive.read',
    })?.value).toBe(SECRET);

    expect(resolveCredential(records, {
      organizationId: 'org-2', provider: 'google_drive', kind: 'organization_integration',
    })).toBeNull();
    expect(resolveCredential(records, {
      organizationId: 'org-1', provider: 'google_drive', kind: 'provider_secret',
    })).toBeNull();
    expect(resolveCredential(records, {
      organizationId: 'org-1', provider: 'google_drive', kind: 'organization_integration',
      requiredScope: 'drive.write',
    })).toBeNull();

    const expired = { ...record, expiresAt: new Date(Date.now() - 1000).toISOString() };
    expect(credentialStatus(expired)).toBe('expired');
    expect(resolveCredential([expired], {
      organizationId: 'org-1', provider: 'google_drive', kind: 'organization_integration',
    })).toBeNull();

    const revoked = { ...record, revokedAt: new Date().toISOString() };
    expect(credentialStatus(revoked)).toBe('revoked');
    expect(resolveCredential([revoked], {
      organizationId: 'org-1', provider: 'google_drive', kind: 'organization_integration',
    })).toBeNull();
  });

  it('resolves the newest matching credential', () => {
    const older = { ...newCredential({ name: 'Old' }), createdAt: '2026-01-01T00:00:00.000Z' };
    const newer = { ...newCredential({ name: 'New', value: 'newest-secret-value' }),
      createdAt: '2026-06-01T00:00:00.000Z' };
    const resolved = resolveCredential([older, newer], {
      organizationId: 'org-1', provider: 'google_drive', kind: 'organization_integration',
    });
    expect(resolved?.value).toBe('newest-secret-value');
  });
});

describe('credential vault HTTP routes', () => {
  const payload = {
    kind: 'organization_integration', provider: 'google_drive', name: 'Drive integration',
    value: SECRET, scopes: ['drive.read'], expiresAt: null,
  };

  it('creates, lists, rotates and revokes an org credential without leaking the secret', async () => {
    const owner = await createOwner('Vault Owner', '+14155559001');
    const base = `/api/orgs/${owner.orgId}/credentials`;

    const created = await api(owner.jar, 'POST', base, payload);
    expect(created.status, created.raw).toBe(201);
    const id = created.body.credential.id as string;
    expect(created.body.credential.status).toBe('active');
    expect(created.body.preview).toContain('sk_');
    expect(created.raw).not.toContain(SECRET);
    expect(created.raw).not.toContain('ciphertext');
    expect(created.raw).not.toContain('authTag');

    const listed = await api(owner.jar, 'GET', base);
    expect(listed.status, listed.raw).toBe(200);
    expect(listed.body.credentials).toHaveLength(1);
    expect(listed.raw).not.toContain(SECRET);

    const rotated = await api(owner.jar, 'POST', `${base}/${id}/rotate`, { value: 'rotated-secret-value' });
    expect(rotated.status, rotated.raw).toBe(200);
    expect(rotated.raw).not.toContain('rotated-secret-value');
    expect(rotated.raw).not.toContain(SECRET);

    const revoked = await api(owner.jar, 'POST', `${base}/${id}/revoke`);
    expect(revoked.status, revoked.raw).toBe(200);
    expect(revoked.body.credential.status).toBe('revoked');

    const stored = store.read((state) => state.credentials.find((item) => item.id === id)!);
    expect(stored.ciphertext).not.toContain('rotated-secret-value');
    expect(openSecret(stored)).toBe('rotated-secret-value');

    const audits = store.read((state) => state.auditLogs
      .filter((log) => log.action.startsWith('credential.'))
      .map((log) => log.action));
    expect(audits).toEqual(expect.arrayContaining([
      'credential.create', 'credential.rotate', 'credential.revoke',
    ]));
    expect(JSON.stringify(store.read((state) => state.auditLogs))).not.toContain(SECRET);
    expect(JSON.stringify(store.read((state) => state.auditLogs))).not.toContain('rotated-secret-value');
  });

  it('denies non-admins and cross-organization access', async () => {
    const a = await createOwner('Vault Org A', '+14155559002');
    const b = await createOwner('Vault Org B', '+14155559003');
    const created = await api(a.jar, 'POST', `/api/orgs/${a.orgId}/credentials`, payload);
    expect(created.status, created.raw).toBe(201);
    const id = created.body.credential.id as string;

    const crossList = await api(b.jar, 'GET', `/api/orgs/${a.orgId}/credentials`);
    expect(crossList.status).toBe(403);
    const ownList = await api(b.jar, 'GET', `/api/orgs/${b.orgId}/credentials`);
    expect(ownList.status, ownList.raw).toBe(200);
    expect(ownList.body.credentials).toEqual([]);

    const student = await registerAndLogin('Vault Student', '+14155559004');
    await store.mutate((draft) => {
      draft.memberships.push({
        id: 'vault-student-membership-2', organizationId: a.orgId,
        userId: draft.users.find((u) => u.phone === '+14155559004')!.id,
        role: 'student', team: 'Students', status: 'active', joinedAt: new Date().toISOString(),
      });
    });
    const denied = await api(student, 'GET', `/api/orgs/${a.orgId}/credentials`);
    expect(denied.status).toBe(403);

    const crossRotate = await api(b.jar, 'POST', `/api/orgs/${a.orgId}/credentials/${id}/rotate`,
      { value: 'another-secret-value' });
    expect(crossRotate.status).toBe(403);
    expect(JSON.stringify(store.read((state) => state.credentials))).not.toContain('another-secret-value');
  });

  it('isolates platform credentials and requires a super admin', async () => {
    const owner = await createOwner('Vault Platform Owner', '+14155559005');
    const denied = await api(owner.jar, 'GET', '/api/admin/credentials');
    expect(denied.status).toBe(403);

    const admin = await createSuperAdmin();
    const created = await api(admin, 'POST', '/api/admin/credentials', {
      ...payload, kind: 'provider_secret', provider: 'livekit', name: 'LiveKit server secret',
    });
    expect(created.status, created.raw).toBe(201);
    const id = created.body.credential.id as string;
    expect(created.body.credential.organizationId).toBeNull();
    expect(created.raw).not.toContain(SECRET);

    const platformList = await api(admin, 'GET', '/api/admin/credentials');
    expect(platformList.body.credentials).toHaveLength(1);
    const orgList = await api(owner.jar, 'GET', `/api/orgs/${owner.orgId}/credentials`);
    expect(orgList.body.credentials).toEqual([]);

    const revoked = await api(admin, 'POST', `/api/admin/credentials/${id}/revoke`);
    expect(revoked.status, revoked.raw).toBe(200);
    expect(revoked.body.credential.status).toBe('revoked');
  });

  it('fails closed on key rotation without the previous key, then re-seals all records', async () => {
    const owner = await createOwner('Vault Rotation Owner', '+14155559006');
    const created = await api(owner.jar, 'POST', `/api/orgs/${owner.orgId}/credentials`, payload);
    expect(created.status, created.raw).toBe(201);
    const id = created.body.credential.id as string;
    const admin = await createSuperAdmin();

    process.env.CREDENTIAL_MASTER_KEY = KEY_B;
    process.env.CREDENTIAL_KEY_VERSION = '2';
    const blocked = await api(admin, 'POST', '/api/admin/credentials/rotate-key', { requestId: 'rotate-1' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('KEY_ROTATION_INCOMPLETE');
    let stored = store.read((state) => state.credentials.find((item) => item.id === id)!);
    expect(stored.keyVersion).toBe(1);

    process.env.CREDENTIAL_MASTER_KEY_PREVIOUS = KEY_A;
    const rotated = await api(admin, 'POST', '/api/admin/credentials/rotate-key', { requestId: 'rotate-1' });
    expect(rotated.status, rotated.raw).toBe(200);
    expect(rotated.body).toMatchObject({ rotated: 1, unreadable: 0 });
    stored = store.read((state) => state.credentials.find((item) => item.id === id)!);
    expect(stored.keyVersion).toBe(2);
    expect(openSecret(stored)).toBe(SECRET);

    delete process.env.CREDENTIAL_MASTER_KEY_PREVIOUS;
    expect(openSecret(stored)).toBe(SECRET);
    const applied = await api(owner.jar, 'GET', `/api/orgs/${owner.orgId}/credentials`);
    expect(applied.status, applied.raw).toBe(200);
    expect(applied.raw).not.toContain(SECRET);

    const rotations = store.read((state) => state.auditLogs
      .filter((log) => log.action === 'credential.key_rotation'));
    expect(rotations).toHaveLength(2);
    expect(rotations[0].metadata).toMatchObject({ requestId: 'rotate-1', rotated: 0, unreadable: 1 });
    expect(rotations[1].metadata).toMatchObject({ requestId: 'rotate-1', rotated: 1, unreadable: 0 });
  });
});
