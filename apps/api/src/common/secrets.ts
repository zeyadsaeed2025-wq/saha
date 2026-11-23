import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

let warnedAboutDevKey = false;

/**
 * Master key for the credential vault. Production requires an explicit key;
 * development uses a deterministic, clearly-warned fallback so local tests and
 * demos work without secrets. The master key is never stored in the database.
 */
export function credentialMasterKey(): Buffer {
  const configured = process.env.CREDENTIAL_MASTER_KEY?.trim();
  if (configured) {
    if (/^[0-9a-fA-F]{64}$/.test(configured)) return Buffer.from(configured, 'hex');
    return createHash('sha256').update(configured).digest();
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('CREDENTIAL_MASTER_KEY is required in production');
  }
  if (!warnedAboutDevKey) {
    warnedAboutDevKey = true;
    console.warn('[secrets] INSECURE: CREDENTIAL_MASTER_KEY is missing; using deterministic dev-only key. Do not use for real secrets.');
  }
  return createHash('sha256').update('saha-dev-only-insecure-credential-key-v1').digest();
}

export function credentialKeyVersion(): number {
  const value = Number(process.env.CREDENTIAL_KEY_VERSION ?? '1');
  return Number.isInteger(value) && value > 0 ? value : 1;
}

/** Previous master key, used only while re-sealing records after a rotation. */
export function previousCredentialMasterKey(): Buffer | null {
  const configured = process.env.CREDENTIAL_MASTER_KEY_PREVIOUS?.trim();
  if (!configured) return null;
  return /^[0-9a-fA-F]{64}$/.test(configured)
    ? Buffer.from(configured, 'hex')
    : createHash('sha256').update(configured).digest();
}

export interface SealedSecret {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: number;
}

/** AES-256-GCM. The IV is unique per write; authentication prevents tampering. */
export function sealSecret(plaintext: string): SealedSecret {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new Error('Secret value must be a non-empty string');
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', credentialMasterKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    keyVersion: credentialKeyVersion(),
  };
}

function openWithKey(sealed: SealedSecret, key: Buffer): string | null {
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(sealed.authTag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(sealed.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}

/** Returns null for tampered ciphertext or a wrong key instead of leaking data. */
export function openSecret(sealed: SealedSecret): string | null {
  const current = openWithKey(sealed, credentialMasterKey());
  if (current !== null) return current;
  const previous = previousCredentialMasterKey();
  return previous ? openWithKey(sealed, previous) : null;
}

/** Masked preview only; never call this with a plaintext value in a response. */
export function maskSecret(plaintext: string): string {
  const value = plaintext.trim();
  if (value.length <= 8) return '••••••••';
  return `${value.slice(0, 3)}••••••••${value.slice(-2)}`;
}

/** Constant-time check used by internal API key verification. */
export function secretsEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
