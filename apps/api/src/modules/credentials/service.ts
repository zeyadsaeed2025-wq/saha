import { randomUUID } from 'node:crypto';
import { maskSecret, openSecret, sealSecret } from '../../common/secrets.js';
import type { CredentialRecord } from '../../domain/types.js';

export type CredentialKind = CredentialRecord['kind'];

export interface CreateCredentialInput {
  organizationId: string | null;
  kind: CredentialKind;
  provider: string;
  name: string;
  value: string;
  scopes: string[];
  expiresAt: string | null;
}

export function createCredential(input: CreateCredentialInput, createdBy: string): CredentialRecord {
  const sealed = sealSecret(input.value);
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    organizationId: input.organizationId,
    kind: input.kind,
    provider: input.provider,
    name: input.name,
    ...sealed,
    scopes: [...new Set(input.scopes)],
    expiresAt: input.expiresAt,
    revokedAt: null,
    lastUsedAt: null,
    createdBy,
    createdAt: now,
    updatedAt: now,
  };
}

export function rotateCredentialValue(record: CredentialRecord, value: string): CredentialRecord {
  const sealed = sealSecret(value);
  return { ...record, ...sealed, updatedAt: new Date().toISOString() };
}

/** Re-seals with the current master key; returns null when neither current nor previous key can open it. */
export function rewrapCredential(record: CredentialRecord): CredentialRecord | null {
  const plaintext = openSecret(record);
  if (plaintext === null) return null;
  return { ...record, ...sealSecret(plaintext), updatedAt: new Date().toISOString() };
}

export function credentialStatus(record: CredentialRecord, now = Date.now()): 'active' | 'expired' | 'revoked' {
  if (record.revokedAt) return 'revoked';
  if (record.expiresAt && Date.parse(record.expiresAt) <= now) return 'expired';
  return 'active';
}

export interface PublicCredential {
  id: string;
  organizationId: string | null;
  kind: CredentialKind;
  provider: string;
  name: string;
  scopes: string[];
  status: 'active' | 'expired' | 'revoked';
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  keyVersion: number;
  createdAt: string;
  updatedAt: string;
}

/** Deliberately omits ciphertext, IV, auth tag and any plaintext. */
export function publicCredential(record: CredentialRecord): PublicCredential {
  return {
    id: record.id,
    organizationId: record.organizationId,
    kind: record.kind,
    provider: record.provider,
    name: record.name,
    scopes: [...record.scopes],
    status: credentialStatus(record),
    expiresAt: record.expiresAt,
    revokedAt: record.revokedAt,
    lastUsedAt: record.lastUsedAt,
    keyVersion: record.keyVersion,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** One-time masked preview, only in the create/rotate response. */
export function credentialPreview(value: string): string {
  return maskSecret(value);
}

export interface ResolveOptions {
  organizationId: string | null;
  provider: string;
  kind: CredentialKind;
  requiredScope?: string;
}

/**
 * Server-side only. Never expose the returned plaintext through an HTTP
 * response, log, audit record or frontend payload.
 */
export function resolveCredential(
  records: CredentialRecord[],
  options: ResolveOptions,
): { record: CredentialRecord; value: string } | null {
  const now = Date.now();
  let match: { record: CredentialRecord; value: string } | null = null;
  for (const record of records) {
    if (record.organizationId !== options.organizationId) continue;
    if (record.provider !== options.provider || record.kind !== options.kind) continue;
    if (credentialStatus(record, now) !== 'active') continue;
    if (options.requiredScope && !record.scopes.includes(options.requiredScope)) continue;
    const value = openSecret(record);
    if (value === null) continue;
    if (!match || Date.parse(record.createdAt) > Date.parse(match.record.createdAt)) {
      match = { record, value };
    }
  }
  return match;
}
