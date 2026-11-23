import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { store } from '../../common/store.js';
import {
  asyncRoute, getAuth, logAudit, requireAuth, requireOrg, requirePermission, setAuth,
} from '../../common/middleware.js';
import { AppError, badRequest, notFound } from '../../common/errors.js';
import type { DbState } from '../../domain/types.js';
import {
  createCredential, credentialPreview, publicCredential, rewrapCredential, rotateCredentialValue,
} from './service.js';

export const credentialsRouter = Router({ mergeParams: true });
export const platformCredentialsRouter = Router();

const kindSchema = z.enum(['internal_api_key', 'organization_integration', 'provider_secret', 'oauth_token']);

const createSchema = z.object({
  kind: kindSchema,
  provider: z.string().min(1).max(80),
  name: z.string().min(2).max(120),
  value: z.string().min(8).max(8192),
  scopes: z.array(z.string().min(1).max(80)).max(40).default([]),
  expiresAt: z.string().datetime().nullable().default(null),
});

const rotateSchema = z.object({ value: z.string().min(8).max(8192) });

function requireSuperAdmin(req: Parameters<typeof getAuth>[0], _res: unknown, next: () => void): void {
  const auth = getAuth(req);
  if (!auth) return next();
  const isSuper = auth.user.id === 'super-admin-seed' || store.read((state) =>
    state.memberships.some((membership) => membership.userId === auth.user.id
      && membership.status === 'active' && membership.role === 'super_admin'));
  if (isSuper && auth.role !== 'super_admin') setAuth(req, { ...auth, role: 'super_admin' });
  next();
}

function findOwned(state: DbState, organizationId: string | null, id: string) {
  return state.credentials.find((item) => item.id === id && item.organizationId === organizationId);
}

credentialsRouter.use(requireOrg);
credentialsRouter.use(requirePermission('integration:manage'));

credentialsRouter.get('/', (req, res) => {
  const orgId = (req.params as { orgId: string }).orgId;
  const credentials = store.read((state) => state.credentials
    .filter((item) => item.organizationId === orgId)
    .map(publicCredential));
  res.json({ credentials });
});

credentialsRouter.post('/', asyncRoute(async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest('Invalid credential payload');
  const auth = getAuth(req)!;
  const orgId = (req.params as { orgId: string }).orgId;
  const input = parsed.data;
  const record = createCredential({ ...input, organizationId: orgId }, auth.user.id);
  await store.mutate((draft) => {
    draft.credentials.push(record);
    logAudit(draft, auth, 'credential.create', orgId, {
      credentialId: record.id, kind: record.kind, provider: record.provider, scopes: record.scopes,
    });
  });
  // Full plaintext is never returned; this one-time preview is the only hint.
  res.status(201).json({ credential: publicCredential(record), preview: credentialPreview(input.value) });
}));

credentialsRouter.post('/:id/rotate', asyncRoute(async (req, res) => {
  const parsed = rotateSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest('A new secret value is required');
  const auth = getAuth(req)!;
  const orgId = (req.params as { orgId: string }).orgId;
  const id = req.params.id as string;
  let preview = '';
  let result: ReturnType<typeof publicCredential> | null = null;
  await store.mutate((draft) => {
    const current = findOwned(draft, orgId, id);
    if (!current) throw notFound('Credential not found');
    const rotated = rotateCredentialValue(current, parsed.data.value);
    Object.assign(current, rotated);
    preview = credentialPreview(parsed.data.value);
    result = publicCredential(current);
    logAudit(draft, auth, 'credential.rotate', orgId, { credentialId: id });
  });
  res.json({ credential: result, preview });
}));

credentialsRouter.post('/:id/revoke', asyncRoute(async (req, res) => {
  const auth = getAuth(req)!;
  const orgId = (req.params as { orgId: string }).orgId;
  const id = req.params.id as string;
  let result: ReturnType<typeof publicCredential> | null = null;
  await store.mutate((draft) => {
    const record = findOwned(draft, orgId, id);
    if (!record) throw notFound('Credential not found');
    record.revokedAt = new Date().toISOString();
    record.updatedAt = record.revokedAt;
    result = publicCredential(record);
    logAudit(draft, auth, 'credential.revoke', orgId, { credentialId: id });
  });
  res.json({ credential: result });
}));

platformCredentialsRouter.use(requireAuth);
platformCredentialsRouter.use(requireSuperAdmin);
platformCredentialsRouter.use(requirePermission('admin:access'));

platformCredentialsRouter.get('/', (_req, res) => {
  const credentials = store.read((state) => state.credentials
    .filter((item) => item.organizationId === null)
    .map(publicCredential));
  res.json({ credentials });
});

platformCredentialsRouter.post('/', asyncRoute(async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest('Invalid credential payload');
  const auth = getAuth(req)!;
  const record = createCredential({ ...parsed.data, organizationId: null }, auth.user.id);
  await store.mutate((draft) => {
    draft.credentials.push(record);
    logAudit(draft, auth, 'credential.create', 'platform', {
      credentialId: record.id, kind: record.kind, provider: record.provider, scope: 'platform',
    });
  });
  res.status(201).json({ credential: publicCredential(record), preview: credentialPreview(parsed.data.value) });
}));

platformCredentialsRouter.post('/:id/revoke', asyncRoute(async (req, res) => {
  const auth = getAuth(req)!;
  const id = req.params.id as string;
  let result: ReturnType<typeof publicCredential> | null = null;
  await store.mutate((draft) => {
    const record = findOwned(draft, null, id);
    if (!record) throw notFound('Credential not found');
    record.revokedAt = new Date().toISOString();
    record.updatedAt = record.revokedAt;
    result = publicCredential(record);
    logAudit(draft, auth, 'credential.revoke', 'platform', { credentialId: id, scope: 'platform' });
  });
  res.json({ credential: result });
}));

/**
 * Re-seals every credential with the current master key. CREDENTIAL_MASTER_KEY_PREVIOUS
 * must be set when the master key itself changed; otherwise unreadable records are
 * reported explicitly instead of being silently overwritten.
 */
platformCredentialsRouter.post('/rotate-key', asyncRoute(async (req, res) => {
  const auth = getAuth(req)!;
  const requestId = req.body && typeof req.body === 'object' && 'requestId' in req.body
    ? String((req.body as { requestId: unknown }).requestId) : randomUUID();
  const result = await store.mutate((draft) => {
    let rotated = 0;
    let unreadable = 0;
    for (const record of draft.credentials) {
      const next = rewrapCredential(record);
      if (!next) { unreadable += 1; continue; }
      Object.assign(record, next);
      rotated += 1;
    }
    logAudit(draft, auth, 'credential.key_rotation', 'platform', { requestId, rotated, unreadable });
    return { rotated, unreadable };
  });
  if (result.unreadable > 0) {
    throw new AppError(409, 'KEY_ROTATION_INCOMPLETE',
      `${result.unreadable} credential(s) could not be opened with the current or previous key. Set CREDENTIAL_MASTER_KEY_PREVIOUS and retry.`);
  }
  res.json({ ...result, message: 'All credentials re-sealed with the current key.' });
}));
