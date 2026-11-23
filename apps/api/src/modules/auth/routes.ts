import { randomUUID } from 'node:crypto';
import { Router, type Response } from 'express';
import { z } from 'zod';
import { store } from '../../common/store.js';
import {
  generateOtpCode, hashPassword, isWorldOnlyCredential, normalizePhone, otpCodeHash,
  randomToken, revokeWorldCredentials, safeEqualHex, registerWorldCredential, sha256, verifyPassword,
} from '../../common/security.js';
import {
  asyncRoute, CSRF_COOKIE, getAuth, requireAuth, SESSION_COOKIE,
} from '../../common/middleware.js';
import { badRequest, conflict, forbidden, notFound, unauthorized } from '../../common/errors.js';
import { logAudit } from '../../common/middleware.js';

export const authRouter = Router();

const OTP_COOLDOWN_MS = 60_000;
const OTP_RATE_WINDOW_MS = 60 * 60 * 1000;
const OTP_RATE_LIMIT = 5;
const OTP_MAX_ATTEMPTS = 5;
/** Single-instance in-memory throttles; a distributed deployment needs a shared store. */
const otpRateLimits = new Map<string, { lastSentAt: number; windowStart: number; sent: number }>();

type CookieSameSite = 'lax' | 'none' | 'strict';

function configuredSameSite(): CookieSameSite {
  const value = process.env.COOKIE_SAMESITE;
  return value === 'none' || value === 'strict' ? value : 'lax';
}

const cookieOptions = (res: Response) => ({
  httpOnly: true,
  // 'none' is required when the web app and API sit on different sites
  // (e.g. Vercel + a separate Node host); browsers mandate Secure with it.
  sameSite: configuredSameSite(),
  secure: process.env.COOKIE_SECURE === 'true' || configuredSameSite() === 'none',
  path: '/',
  maxAge: 8 * 60 * 60 * 1000,
});

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const WS_TICKET_TTL_MS = 10 * 60 * 1000;

export interface IssuedCredentials {
  token: string;
  csrfToken: string;
  webSocketToken: string;
  sessionId: string;
}

/** Creates a world-only alias that the existing socket can resolve by `sha256(token)`. */
function worldAlias(userId: string, activeOrgId: string | null, kind: 'member' | 'guest',
  guest: { orgId?: string; workspaceId?: string; roomId?: string }, credential: string, expiresAt: string,
  guestLinkId?: string) {
  return {
    id: randomUUID(),
    tokenHash: sha256(credential),
    userId,
    activeOrgId,
    guestOrgId: guest.orgId ?? null,
    guestWorkspaceId: guest.workspaceId ?? null,
    guestRoomId: guest.roomId ?? null,
    kind,
    expiresAt,
    revokedAt: null,
    createdAt: new Date().toISOString(),
    worldOnly: true,
    guestLinkId,
  };
}

function issueSession(res: Response, userId: string, activeOrgId: string | null, kind: 'member' | 'guest' = 'member',
  guest: { orgId?: string; workspaceId?: string; roomId?: string } = {}, guestLinkId?: string): Promise<IssuedCredentials> {
  const token = randomToken();
  // Session, CSRF and WS credentials are independent values. The CSRF cookie is
  // readable by JS, so it is registered as a world-only alias to keep the current
  // web client's socket URL working; it is never accepted as an HTTP session.
  const csrfToken = randomToken();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const session = {
    id: randomUUID(),
    tokenHash: sha256(token),
    userId,
    activeOrgId,
    guestOrgId: guest.orgId ?? null,
    guestWorkspaceId: guest.workspaceId ?? null,
    guestRoomId: guest.roomId ?? null,
    kind,
    expiresAt,
    revokedAt: null,
    createdAt: now,
    guestLinkId,
  };
  const csrfAlias = worldAlias(userId, activeOrgId, kind, guest, csrfToken, expiresAt, guestLinkId);
  return store.mutate((draft) => {
    draft.authSessions.push(session, csrfAlias);
    return { token, csrfToken, sessionId: session.id };
  }).then((issued) => {
    registerWorldCredential(issued.sessionId, { id: csrfAlias.id, expiresAt });
    res.cookie(SESSION_COOKIE, token, cookieOptions(res));
    res.cookie(CSRF_COOKIE, csrfToken, { ...cookieOptions(res), httpOnly: false });
    return { ...issued, webSocketToken: csrfToken };
  });
}

const loginSchema = z.object({ phone: z.string().min(8), password: z.string().min(8) });
const registerSchema = z.object({
  name: z.string().min(2).max(80),
  phone: z.string().min(8),
  password: z.string().min(8).max(200),
});

authRouter.post('/register', asyncRoute(async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest('Name, phone and a password of at least 8 characters are required');
  const phone = normalizePhone(parsed.data.phone);
  const result = await store.mutate((draft) => {
    if (draft.users.some((u) => u.phone === phone)) {
      throw conflict('This phone number is already registered', 'DUPLICATE_PHONE');
    }
    const user = {
      id: randomUUID(), phone, name: parsed.data.name,
      passwordHash: hashPassword(parsed.data.password), status: 'active' as const,
      verifiedAt: null, createdAt: new Date().toISOString(),
    };
    draft.users.push(user);
    logAudit(draft, null, 'user.registered', user.id, { phone });
    return user;
  });
  await issueSession(res, result.id, null);
  res.status(201).json({ user: { id: result.id, phone: result.phone, name: result.name }, activeOrgId: null });
}));

authRouter.post('/login', asyncRoute(async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest('Phone and password are required');
  const phone = normalizePhone(parsed.data.phone);
  const user = store.read((state) => state.users.find((u) => u.phone === phone));
  const generic = 'Invalid credentials';
  if (!user || user.status !== 'active' || !verifyPassword(parsed.data.password, user.passwordHash)) {
    throw unauthorized(generic);
  }
  const org = store.read((state) =>
    state.memberships.find((m) => m.userId === user.id && m.status === 'active')?.organizationId ?? null);
  await issueSession(res, user.id, org);
  res.json({ user: { id: user.id, phone: user.phone, name: user.name }, activeOrgId: org });
}));

authRouter.post('/logout', requireAuth, asyncRoute(async (req, res) => {
  const auth = getAuth(req)!;
  await store.mutate((draft) => {
    const session = draft.authSessions.find((s) => s.id === auth.session.id);
    if (session) session.revokedAt = new Date().toISOString();
    revokeWorldCredentials(draft, auth.session.id);
  });
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.clearCookie(CSRF_COOKIE, { path: '/' });
  res.json({ ok: true });
}));

authRouter.get('/me', (req, res) => {
  const auth = getAuth(req);
  if (!auth) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Not signed in' } });
  const org = store.read((state) => state.organizations.find((o) => o.id === auth.orgId) ?? null);
  const memberships = store.read((state) => state.memberships
    .filter((m) => m.userId === auth.user.id && m.status === 'active')
    .map((m) => ({ organizationId: m.organizationId, role: m.role, team: m.team,
      organizationName: state.organizations.find((o) => o.id === m.organizationId)?.name ?? '' })));
  const role = auth.role === 'super_admin' ? 'super_admin' : store.read((state) => state.memberships.find(
    (m) => m.userId === auth.user.id && m.organizationId === auth.orgId)?.role ?? (auth.isGuest ? 'guest' : 'student'));
  res.json({
    user: { id: auth.user.id, phone: auth.user.phone, name: auth.user.name },
    activeOrgId: auth.orgId,
    // Guests receive only the minimum context needed to render the shell;
    // organization settings (heartbeat, verification window, demo flags) are
    // configuration for members and are not exposed to link guests.
    organization: org && (auth.isGuest
      ? { id: org.id, name: org.name, timezone: org.timezone }
      : { id: org.id, name: org.name, timezone: org.timezone, settings: org.settings }),
    memberships,
    role,
    isGuest: auth.isGuest,
  });
});

authRouter.post('/forgot', asyncRoute(async (req, res) => {
  const parsed = z.object({ phone: z.string().min(8) }).safeParse(req.body);
  if (!parsed.success) throw badRequest('A phone number is required');
  const phone = normalizePhone(parsed.data.phone);
  const phoneHash = sha256(phone);
  const user = store.read((state) => state.users.find((u) => u.phone === phone));
  // Always return the same response: never reveal registration state.
  let devCode: string | null = null;
  if (user) {
    const now = Date.now();
    let throttle = otpRateLimits.get(phoneHash);
    if (!throttle || now - throttle.windowStart >= OTP_RATE_WINDOW_MS) {
      throttle = { lastSentAt: 0, windowStart: now, sent: 0 };
    }
    const allowed = now - throttle.lastSentAt >= OTP_COOLDOWN_MS && throttle.sent < OTP_RATE_LIMIT;
    if (allowed) {
      const code = generateOtpCode();
      const sentAt = new Date(now).toISOString();
      await store.mutate((draft) => {
        let invalidated = 0;
        for (const prior of draft.otps) {
          if (prior.phoneHash === phoneHash && !prior.consumedAt) {
            prior.consumedAt = sentAt; // consume doubles as invalidation for superseded codes
            invalidated += 1;
          }
        }
        draft.otps.push({
          id: randomUUID(),
          phoneHash,
          codeHash: otpCodeHash(code, phoneHash),
          attempts: 0,
          consumedAt: null,
          expiresAt: new Date(now + 10 * 60 * 1000).toISOString(),
          createdAt: sentAt,
        });
        draft.auditLogs.push({
          id: randomUUID(), organizationId: null, actorId: null, action: 'otp.issued',
          target: phoneHash, metadata: { invalidatedPreviousCodes: invalidated }, at: sentAt,
        });
      });
      throttle.lastSentAt = now;
      throttle.sent += 1;
      otpRateLimits.set(phoneHash, throttle);
      // Production never exposes a code. Dev exposure is opt-out via SMS_PROVIDER.
      if (process.env.NODE_ENV !== 'production' && !process.env.SMS_PROVIDER) devCode = code;
    }
  }
  res.json({ ok: true, message: 'If the number is registered, a code has been sent.',
    ...(devCode && { devCode, devNotice: 'Local development only — SMS provider is not configured.' }) });
}));

authRouter.post('/reset', asyncRoute(async (req, res) => {
  const parsed = z.object({
    phone: z.string().min(8), code: z.string().regex(/^\d{6}$/), newPassword: z.string().min(8).max(200),
  }).safeParse(req.body);
  if (!parsed.success) throw badRequest('Invalid reset request');
  const phone = normalizePhone(parsed.data.phone);
  const phoneHash = sha256(phone);
  const nowIso = new Date().toISOString();
  const outcome = await store.mutate((draft) => {
    const otp = [...draft.otps].reverse().find((o) => o.phoneHash === phoneHash && !o.consumedAt
      && new Date(o.expiresAt) > new Date() && o.attempts < OTP_MAX_ATTEMPTS);
    if (!otp) return { ok: false as const, reason: 'INVALID_CODE' };
    otp.attempts += 1;
    // The plain SHA-256 fallback only accepts legacy OTPs issued before HMAC hashing.
    const matches = safeEqualHex(otpCodeHash(parsed.data.code, phoneHash), otp.codeHash)
      || safeEqualHex(sha256(parsed.data.code), otp.codeHash);
    if (!matches) return { ok: false as const, reason: 'INVALID_CODE' };
    otp.consumedAt = nowIso;
    const user = draft.users.find((u) => u.phone === phone);
    if (!user) return { ok: false as const, reason: 'INVALID_CODE' };
    user.passwordHash = hashPassword(parsed.data.newPassword);
    user.verifiedAt = user.verifiedAt ?? nowIso;
    let revokedSessions = 0;
    for (const session of draft.authSessions) {
      if (isWorldOnlyCredential(session)) continue;
      revokeWorldCredentials(draft, session.id, nowIso);
      if (session.userId === user.id && !session.revokedAt) {
        session.revokedAt = nowIso;
        revokedSessions += 1;
      }
    }
    draft.auditLogs.push({
      id: randomUUID(), organizationId: null, actorId: user.id, action: 'session.revoked_after_reset',
      target: user.id, metadata: { reason: 'password_reset', sessions: revokedSessions }, at: nowIso,
    });
    return { ok: true as const, revokedSessions };
  });
  if (!outcome.ok) throw badRequest('Invalid or expired code', 'INVALID_CODE');
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.clearCookie(CSRF_COOKIE, { path: '/' });
  res.json({ ok: true });
}));

authRouter.post('/session/org', requireAuth, asyncRoute(async (req, res) => {
  const parsed = z.object({ organizationId: z.string().uuid() }).safeParse(req.body);
  if (!parsed.success) throw badRequest('A valid organizationId is required');
  const orgId = parsed.data.organizationId;
  const auth = getAuth(req)!;
  if (auth.isGuest) throw forbidden('Guests cannot switch organization context');
  const allowed = store.read((state) => {
    const org = state.organizations.find((o) => o.id === orgId && o.status === 'active');
    const membership = state.memberships.find(
      (m) => m.userId === auth.user.id && m.organizationId === orgId && m.status === 'active');
    return Boolean(org && (membership || auth.user.id === 'super-admin-seed'));
  });
  if (!allowed) throw forbidden('Not an active member of this organization');
  await store.mutate((draft) => {
    const session = draft.authSessions.find((s) => s.id === auth.session.id);
    if (session) session.activeOrgId = orgId;
  });
  res.json({ ok: true, activeOrgId: orgId });
}));

/**
 * Short-lived, single-purpose socket credential. It is a separate random token
 * registered as a world-only session alias so the existing /ws/world handshake
 * accepts it via its `token` query parameter.
 */
authRouter.post('/ws-ticket', requireAuth, asyncRoute(async (req, res) => {
  const auth = getAuth(req)!;
  const ticket = randomToken();
  const expiresAt = new Date(Date.now() + WS_TICKET_TTL_MS).toISOString();
  const alias = worldAlias(
    auth.user.id,
    auth.isGuest ? null : auth.session.activeOrgId ?? null,
    auth.isGuest ? 'guest' : 'member',
    {
      orgId: auth.isGuest ? auth.session.guestOrgId ?? undefined : undefined,
      workspaceId: auth.isGuest ? auth.session.guestWorkspaceId ?? undefined : undefined,
      roomId: auth.isGuest ? auth.session.guestRoomId ?? undefined : undefined,
    },
    ticket,
    expiresAt,
    (auth.session as typeof auth.session & { guestLinkId?: string }).guestLinkId,
  );
  await store.mutate((draft) => {
    draft.authSessions.push(alias);
    logAudit(draft, auth, 'world.ticket_issued', auth.session.id, { expiresAt });
  });
  registerWorldCredential(auth.session.id, { id: alias.id, expiresAt });
  res.json({ ticket, expiresAt });
}));

authRouter.get('/sessions', requireAuth, (req, res) => {
  const auth = getAuth(req)!;
  const sessions = store.read((state) => state.authSessions
    .filter((s) => s.userId === auth.user.id && !s.revokedAt && !isWorldOnlyCredential(s))
    .map((s) => ({ id: s.id, createdAt: s.createdAt, expiresAt: s.expiresAt, current: s.id === auth.session.id })));
  res.json({ sessions });
});

authRouter.delete('/sessions/:id', requireAuth, asyncRoute(async (req, res) => {
  await store.mutate((draft) => {
    const session = draft.authSessions.find((s) => s.id === req.params.id && s.userId === getAuth(req)!.user.id);
    if (session) session.revokedAt = new Date().toISOString();
    revokeWorldCredentials(draft, req.params.id);
  });
  await logAuditAndRespond(req, res);
}));

async function logAuditAndRespond(req: Parameters<typeof getAuth>[0], res: Response) {
  await store.mutate((draft) => logAudit(draft, getAuth(req), 'session.revoked', req.params.id ?? ''));
  res.json({ ok: true });
}

export { issueSession };
