import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { store, findInOrg } from './store.js';
import { hasPermission, isWorldOnlyCredential, sha256 } from './security.js';
import { AppError, forbidden, unauthorized } from './errors.js';
import { hasFeature, type FeatureKey } from '../modules/billing/entitlements.js';
import type { AuthSession, Membership, Permission, Role, User } from '../domain/types.js';

export const SESSION_COOKIE = 'saha_session';
export const CSRF_COOKIE = 'saha_csrf';

export interface AuthContext {
  user: User;
  session: AuthSession;
  role: Role;
  orgId: string;
  membership: Membership | null;
  isGuest: boolean;
}

export const getAuth = (req: Request): AuthContext | null =>
  ((req as unknown as { auth?: AuthContext }).auth ?? null);

export const setAuth = (req: Request, value: AuthContext | null): void => {
  (req as unknown as { auth?: AuthContext }).auth = value ?? undefined;
};

export const asyncRoute =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res)).catch(next);
  };

export function attachUser(req: Request, _res: Response, next: NextFunction): void {
  const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
  if (!token) return next();
  const tokenHash = sha256(token);
  const result = store.read((state) => {
    // CSRF cookies and WS tickets are deliberately world-only aliases: they can
    // open a socket but cannot authenticate an HTTP session.
    const session = state.authSessions.find(
      (s) => s.tokenHash === tokenHash && !s.revokedAt && !isWorldOnlyCredential(s)
        && new Date(s.expiresAt) > new Date(),
    );
    if (!session) return null;
    const user = state.users.find((u) => u.id === session.userId && u.status === 'active');
    if (!user) return null;
    return { session, user };
  });
  if (result) {
    setAuth(req, {
      user: result.user,
      session: result.session,
      role: result.session.kind === 'guest' ? 'guest'
        : result.user.id === 'super-admin-seed' ? 'super_admin' : 'student',
      orgId: result.session.activeOrgId ?? result.session.guestOrgId ?? '',
      membership: null,
      isGuest: result.session.kind === 'guest',
    });
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!getAuth(req)) return next(unauthorized());
  next();
}

/** Resolves and verifies the organization scope for every protected request. */
export function requireOrg(req: Request, _res: Response, next: NextFunction): void {
  const auth = getAuth(req);
  if (!auth) return next(unauthorized());
  const orgId = (req.params.orgId ?? req.header('x-organization-id')) as string | undefined;
  if (!orgId) return next(forbidden('Organization context is required'));
  if (auth.isGuest && auth.session.guestOrgId !== orgId) return next(forbidden());

  const membership = store.read((state) =>
    state.memberships.find((m) => m.organizationId === orgId && m.userId === auth.user.id && m.status === 'active') ?? null,
  );
  const isSuper = auth.user.id === 'super-admin-seed';
  if (!membership && !isSuper && !auth.isGuest) return next(forbidden('Not a member of this organization'));
  if (!membership && !isSuper && auth.isGuest && auth.session.guestOrgId !== orgId) return next(forbidden());

  setAuth(req, {
    ...auth,
    orgId,
    role: auth.isGuest ? 'guest' : isSuper ? 'super_admin' : membership?.role ?? 'student',
    membership,
  });
  next();
}

export function requirePermission(permission: Permission) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const auth = getAuth(req);
    if (!auth) return next(unauthorized());
    if (!hasPermission(auth.role, permission)) return next(forbidden());
    next();
  };
}

/** Server-side plan capability gate. Intended to run after `requireOrg`. */
export function requireFeature(feature: FeatureKey) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const auth = getAuth(req);
    if (!auth) return next(unauthorized());
    const orgId = (req.params.orgId ?? req.header('x-organization-id')) as string | undefined;
    if (!orgId) return next(forbidden('Organization context is required'));
    if (!store.read((state) => hasFeature(state, orgId, feature))) {
      return next(new AppError(403, 'FEATURE_NOT_ENABLED',
        `The current plan does not include the ${feature} feature`, { feature }));
    }
    next();
  };
}

/**
 * Visibility scope for sensitive attendance/report data. `null` means the whole
 * organization; otherwise only the listed user ids may be returned. Mentors see
 * themselves plus active members of their own team until explicit mentor→mentee
 * links exist in the domain model.
 */
export function scopedUserIds(auth: AuthContext, orgId: string): Set<string> | null {
  if (auth.role === 'org_admin' || auth.role === 'super_admin') return null;
  if (auth.isGuest) return new Set<string>();
  if (auth.role === 'mentor') {
    return store.read((state) => {
      const own = state.memberships.find(
        (m) => m.organizationId === orgId && m.userId === auth.user.id && m.status === 'active',
      );
      const ids = new Set<string>([auth.user.id]);
      if (own) {
        for (const member of state.memberships) {
          if (member.organizationId === orgId && member.status === 'active' && member.team === own.team) {
            ids.add(member.userId);
          }
        }
      }
      return ids;
    });
  }
  return new Set<string>([auth.user.id]);
}

/** Double-submit CSRF cookie for state-changing requests. */
export function csrfGuard(req: Request, _res: Response, next: NextFunction): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const cookie = req.cookies?.[CSRF_COOKIE] as string | undefined;
  const header = req.header('x-csrf-token');
  if (!cookie || !header || cookie !== header) {
    return next(new AppError(403, 'CSRF_FAILED', 'CSRF token mismatch'));
  }
  next();
}

export function logAudit(
  draft: Parameters<Parameters<typeof store.mutate>[0]>[0],
  auth: AuthContext | null,
  action: string,
  target: string,
  metadata: Record<string, unknown> = {},
): void {
  draft.auditLogs.push({
    id: randomUUID(),
    organizationId: auth?.orgId ?? null,
    actorId: auth?.user.id ?? null,
    action,
    target,
    metadata,
    at: new Date().toISOString(),
  });
}

export const orgEntity = <T extends { organizationId: string; id: string }>(items: T[], orgId: string, id: string) =>
  findInOrg(items, orgId, id);
