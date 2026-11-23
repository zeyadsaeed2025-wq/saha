import { createHash, createHmac, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import type { AuthSession, DbState, Permission, Role } from '../domain/types.js';

export const sha256 = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');

let warnedAboutDevSecret = false;

/** Secret used for OTP HMACs. A deterministic fallback is dev-only and always warned about. */
export function sessionSecret(): string {
  const configured = process.env.SESSION_SECRET;
  if (configured && configured.length >= 16) return configured;
  if (!warnedAboutDevSecret) {
    warnedAboutDevSecret = true;
    console.warn('[security] INSECURE: SESSION_SECRET is missing or too short; using deterministic dev-only secret. Set SESSION_SECRET before any real deployment.');
  }
  return 'saha-dev-only-insecure-otp-secret-v1';
}

/** Constant-time comparison for equal-length hex digests. */
export function safeEqualHex(a: string, b: string): boolean {
  if (!/^[0-9a-f]+$/i.test(a) || !/^[0-9a-f]+$/i.test(b)) return false;
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

/** HMAC-bound OTP digest: a code issued for one phone cannot be replayed for another. */
export const otpCodeHash = (code: string, phoneHash: string): string =>
  createHmac('sha256', sessionSecret()).update(`${phoneHash}:${code}`).digest('hex');

/** CSPRNG 6-digit code, including leading zero values. */
export const generateOtpCode = (): string => randomInt(0, 1_000_000).toString().padStart(6, '0');

/**
 * Resolves a session from a credential presented to the world socket. The socket
 * hashes the `token` query parameter and looks up `tokenHash`; this helper exposes
 * the same rule so the socket can be switched over without changing behaviour.
 * Session cookies, CSRF-cookie aliases and short-lived WS tickets all resolve here,
 * while only real sessions are accepted by `attachUser`.
 */
export function findSessionByWorldCredential(state: DbState, credential: string): AuthSession | null {
  if (!credential) return null;
  const hash = sha256(credential);
  return state.authSessions.find(
    (session) => session.tokenHash === hash
      && !session.revokedAt
      && new Date(session.expiresAt) > new Date(),
  ) ?? null;
}

/**
 * World-only credential aliases are stored as `authSessions` because the current
 * socket implementation resolves `sha256(token)` against that collection. They are
 * tracked here so `attachUser` never treats them as HTTP sessions.
 */
const worldOnlySessions = new Map<string, number>();
const worldAliasesByParent = new Map<string, Set<string>>();

export function registerWorldCredential(parentSessionId: string, alias: { id: string; expiresAt: string }): void {
  const expiresAtMs = Date.parse(alias.expiresAt);
  worldOnlySessions.set(alias.id, expiresAtMs);
  const aliases = worldAliasesByParent.get(parentSessionId) ?? new Set<string>();
  aliases.add(alias.id);
  worldAliasesByParent.set(parentSessionId, aliases);
  const now = Date.now();
  for (const [id, expiry] of worldOnlySessions) if (expiry <= now) worldOnlySessions.delete(id);
}

/**
 * World aliases carry a persisted runtime marker (domain types are owned by
 * another worker) in addition to the in-memory index, so they stay world-only
 * after a process restart or when a Postgres snapshot is reloaded.
 */
type WorldAliasSession = AuthSession & { worldOnly?: boolean };

export function isWorldOnlyCredential(session: AuthSession): boolean {
  return (session as WorldAliasSession).worldOnly === true || isWorldOnlySession(session.id);
}

/** True for credentials that may open a socket but must never authenticate HTTP requests. */
export function isWorldOnlySession(sessionId: string): boolean {
  const expiry = worldOnlySessions.get(sessionId);
  if (expiry === undefined) return false;
  if (expiry <= Date.now()) {
    worldOnlySessions.delete(sessionId);
    return false;
  }
  return true;
}

/** Revokes all world credentials derived from a parent session inside an existing mutation. */
export function revokeWorldCredentials(draft: DbState, parentSessionId: string, at = new Date().toISOString()): number {
  const aliases = worldAliasesByParent.get(parentSessionId);
  if (!aliases) return 0;
  let revoked = 0;
  for (const session of draft.authSessions) {
    if (aliases.has(session.id) && !session.revokedAt) {
      session.revokedAt = at;
      revoked += 1;
    }
  }
  worldAliasesByParent.delete(parentSessionId);
  for (const id of aliases) worldOnlySessions.delete(id);
  return revoked;
}

export const hashPassword = (password: string): string => {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
};

export const verifyPassword = (password: string, stored: string): boolean => {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const expected = Buffer.from(parts[2], 'hex');
  const actual = scryptSync(password, parts[1], expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};

export const normalizePhone = (phone: string): string => {
  const trimmed = phone.trim();
  const plus = trimmed.startsWith('+') ? '+' : '+';
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) throw new Error('INVALID_PHONE');
  return `${plus}${digits}`;
};

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  super_admin: [
    'org:read', 'org:update', 'member:read', 'member:manage',
    'workspace:read', 'workspace:manage', 'schedule:read', 'schedule:manage',
    'attendance:read', 'attendance:correct', 'report:read', 'report:export',
    'invitation:manage', 'link:manage', 'team:read', 'team:manage', 'guest:manage',
    'meeting:read', 'meeting:manage', 'recording:read', 'recording:manage',
    'message:read', 'message:send', 'notification:read', 'billing:read', 'billing:manage',
    'plan:manage', 'admin:access', 'audit:read', 'integration:manage', 'customization:manage',
    'world:connect',
  ],
  org_admin: [
    'org:read', 'org:update', 'member:read', 'member:manage',
    'workspace:read', 'workspace:manage', 'schedule:read', 'schedule:manage',
    'attendance:read', 'attendance:correct', 'report:read', 'report:export',
    'invitation:manage', 'link:manage', 'team:read', 'team:manage', 'guest:manage',
    'meeting:read', 'meeting:manage', 'recording:read', 'recording:manage',
    'message:read', 'message:send', 'notification:read', 'billing:read', 'billing:manage',
    'integration:manage', 'customization:manage', 'audit:read', 'world:connect',
  ],
  mentor: [
    'org:read', 'member:read', 'workspace:read', 'schedule:read',
    'schedule:manage', 'attendance:read', 'report:read', 'team:read',
    'meeting:read', 'message:read', 'message:send', 'notification:read', 'world:connect',
  ],
  student: [
    'org:read', 'workspace:read', 'schedule:read', 'attendance:read',
    'report:read', 'meeting:read', 'message:read', 'message:send',
    'notification:read', 'world:connect',
  ],
  guest: ['world:connect'],
};

export const hasPermission = (role: Role, permission: Permission): boolean =>
  ROLE_PERMISSIONS[role]?.includes(permission) ?? false;

export const roleRank: Record<Role, number> = {
  guest: 0, student: 1, mentor: 2, org_admin: 3, super_admin: 4,
};

/** Validates IANA timezone names, preferring the runtime's canonical list. */
export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone || timeZone.length > 64) return false;
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };
  if (typeof intl.supportedValuesOf === 'function') {
    try {
      // Some runtimes omit aliases such as "UTC" from the canonical list, so a
      // list miss still falls through to the constructor validation below.
      if (intl.supportedValuesOf('timeZone').includes(timeZone)) return true;
    } catch {
      // Fall through to the constructor check.
    }
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * CSV cell quoting plus spreadsheet-formula neutralization. Values beginning
 * with a formula trigger are prefixed with an apostrophe so spreadsheet apps
 * treat them as text, while quotes are doubled for valid CSV escaping.
 */
export function csvCell(value: string | number): string {
  const raw = typeof value === 'number' ? String(value) : String(value ?? '');
  const safe = /^[\s]*[=+\-@\t\r]/.test(raw) || /^[\s]*[\u0000-\u001F]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}
