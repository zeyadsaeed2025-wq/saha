# Security model

This describes controls **implemented in the MVP** and a checklist of items that remain operator/roadmap responsibilities. See [api-contracts.md](api-contracts.md) for exact routes.

## Authentication and sessions

- Users authenticate with a normalized E.164 phone number and password. `normalizePhone()` keeps 8–15 digits; the local store enforces global phone uniqueness at registration/member creation.
- Passwords are hashed with Node `scrypt` and a random 16-byte salt: `scrypt$<salt>$<derived>`. Verification uses `timingSafeEqual`; malformed hashes fail closed.
- Login failures are generic (`401 Invalid credentials`) and do not disclose registration or organization membership.
- Successful login/register issues an 8-hour session. The raw token is sent only in the `saha_session` httpOnly cookie; `authSessions.tokenHash` stores its SHA-256 hash. Sessions have `expiresAt` and `revokedAt`; logout, per-session revoke and "sign out other devices" set `revokedAt`.
- Password reset is the **only** OTP flow: 6-digit code, hashed at rest alongside a phone hash, 10-minute expiry, max 5 attempts, consumed after success. With no SMS provider and `NODE_ENV != production`, the code is returned in the response as `devCode` with an explicit notice. In production, an SMS provider must be implemented and the dev branch must never be reachable.
- `SESSION_SECRET` **is read by the current code** as the HMAC key for phone-bound OTP digests (`otpCodeHash`); it must be at least 16 chars. It is **not** a cookie-signing/encryption secret. A short/missing value falls back to a warned-about deterministic dev-only secret.

## CSRF and WebSocket token

- `saha_csrf` is a readable cookie set alongside the session cookie. Its value is distinct from `saha_session`; state-changing requests must send that same cookie value in `x-csrf-token`, and `csrfGuard` rejects mismatches with `403 CSRF_FAILED`. Safe methods (GET/HEAD/OPTIONS) are exempt.
- Exempt POST paths: `/api/auth/login`, `/register`, `/forgot`, `/reset`, `/api/access/:token/redeem`. `/api/health` and `/api/demo/seed` are mounted before the guard; the demo route is gated by `ALLOW_DEMO_SEED` and must be disabled in production.
- The browser first calls `POST /api/auth/ws-ticket` and passes the returned 10-minute ticket as `?token=`; it falls back to `saha_csrf` only if the endpoint is unavailable. The server hashes the credential and checks for an active, unrevoked session. Origin validation is enforced; cross-origin WebSocket clients are rejected with `4002`.
- **Design note:** both the dedicated ticket and the fallback CSRF alias resolve as **world-only aliases** (SHA-256 hashed in `auth_sessions`) and cannot authenticate HTTP requests. They are not HMAC-signed tickets; `SESSION_SECRET` is used for OTP HMAC, not WS signing. Decide rotation/replay policy before high-value deployments (see [open decisions](../decisions/open-decisions-and-risks.md), ADR-004).

## RBAC and tenant isolation

- Roles: `super_admin`, `org_admin`, `mentor`, `student`, `guest`. Permissions are checked **on the server** via `requirePermission` using the matrix in `common/security.ts`. The web `can()` helper only hides UI and is not a security boundary.
- `requireOrg` resolves the org from `:orgId` (or `x-organization-id` when no route param exists), requires an active membership, verifies guest scoping, and attaches the effective role to the request. Cross-org reads/writes return `403`.
- Entity lookups use `findInOrg`/`inOrg` or explicit `organizationId` filters. Reports, attendance and schedules are all org-filtered before aggregation.
- Role escalation is guarded: a member cannot assign a role higher than their own, change their own admin role, or remove themselves. Mentors can manage schedules but cannot manage members or correct attendance.

## Audit trail

`logAudit` and direct audit writes record actor, optional org, action, target, metadata and timestamp. Covered actions include: `user.registered`, `organization.created/updated`, `workspace.created`, `room.updated`, `member.added/updated/removed`, `invitation.created/accepted/revoked`, `access_link.created/revoked`, `schedule.created/updated/generated`, `session.cancelled`, `session.revoked`, `attendance.joined/finalized/corrected`, and `demo.seeded`. Attendance corrections additionally append an immutable-style `attendanceChange` with before/after values and a required reason, plus a `manual_adjustment` event.

Audit logs are stored in the same local JSON store today; a production deployment should add retention, central shipping and tamper protection.

## Invitation and access-link tokens

- Raw tokens are random base64url values shown **once** in the creation response. Only SHA-256 hashes are stored.
- Invitations/links enforce expiry, `maxUses`/`uses`, and `revokedAt`. Redemption increments `uses` inside the serialized store mutation; a real SQL adapter must do this atomically in one transaction.
- Invitation phone targeting is enforced on acceptance (`PHONE_MISMATCH`) and the public info endpoint exposes only a masked phone hint.
- Passwordless member links are bound to a `subjectUserId`; public guest links create a separate, synthetic guest identity.

## Guest limits

- Guests receive a distinct session kind (`guest`) bound to one organization, workspace and optional room. `requireOrg` rejects a different org; the WebSocket rejects a different workspace.
- The guest role has only `world:connect`. Guests cannot read org data, member lists, schedules, attendance history or reports, and cannot use correction/management endpoints.
- World heartbeats from a guest do not create attendance records because there is no scheduled attendance session for the synthetic guest user. Presence and attendance remain separate.

## Deployment security checklist

- [ ] `NODE_ENV=production`, `COOKIE_SECURE=true`, HTTPS terminated at a trusted reverse proxy; proxy forwards `/ws` upgrade headers.
- [ ] `APP_URL`/CORS origin list limited to the real web origin(s); credentials enabled only for those origins.
- [ ] `ALLOW_DEMO_SEED=false`; remove or recreate any org with `settings.demo=true` before real use.
- [ ] Use `DATA_ADAPTER=postgres` only after staging verification: it is a real `pg` JSONB adapter (`saha_state`, `SELECT ... FOR UPDATE`) but is **Implemented but Not Runtime-Verified** here. The normalized Drizzle schema/migrations are added but **not applied** and not used by runtime code. Protect the local data file and keep it outside the web root.
- [ ] Never expose remote `POST /api/demo/seed` in production; it precedes auth/CSRF middleware.
- [ ] Add rate limiting for login, register, forgot/reset and token redemption at the proxy or in the app.
- [ ] Implement an SMS provider before relying on password reset; confirm no `devCode` is returned in production.
- [ ] Set a real content-security policy for the Vite build (Google Fonts, PixiJS assets) and keep `x-powered-by` disabled (already done).
- [ ] Run one world-server instance (ADR-002); use sticky routing only after a shared presence adapter exists.
- [ ] Back up the data store/audit logs, define retention, and restrict operator access with justification.
- [ ] Re-run lint, build, tests and a security smoke test after every deployment.
