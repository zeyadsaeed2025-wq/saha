# Architecture decision log

Source requirements: `D:\SRS &MASTAR.docx` and `D:\SRS &MASTAR.pdf` (extracted text at `C:\Users\HP\AppData\Local\Temp\opencode\srs_extract.txt`). Where the SRS suggested a different implementation, the user's explicit directive recorded below governs.

## ADR-001 — Clean-slate product, resolved stack conflicts — Accepted

- **Context:** The SRS describes a Gather-inspired office rebuilt from scratch and suggested a Laravel modular monolith (with NestJS mentioned as an Arabic-side alternative), PostgreSQL, a separate world/media service and Google Drive integration.
- **Decision:** Build from scratch, but implement the API as **Node.js + TypeScript + Express modular monolith**, the web as **React + TypeScript + Vite** with **PixiJS**, real-time over a **WebSocket world server**, and **PostgreSQL + Drizzle** as the intended persistence path. Do not adopt Laravel or NestJS.
- **Consequences:** The codebase matches the approved stack. A real `pg` JSONB adapter plus a target Drizzle schema/migrations now exist (see ADR-003 and [database.md](database.md)); the normalized tables are not applied or active. Media and Drive are deferred rather than partially integrated by the recorded user directive (ADR-008).

## ADR-002 — Single-instance world/presence model — Accepted (constraint)

- **Context:** Presence and movement broadcasts are held in `WorldRegistry` (an in-memory `Map`), and the local data adapter is process-local.
- **Decision:** MVP supports **one API/world process**. Presence is not persisted and is not shared between instances. A shared pub/sub + presence store (e.g., Redis) is required before horizontal scaling.
- **Consequences:** Deployment must pin a single instance for the world server. Multi-instance presence, sticky sessions and shared event deduplication are future work. This constraint is recorded in code comments in `modules/world/registry.ts` and `common/store.ts`.

## ADR-003 — Local JSON adapter for development/demo — Accepted (not production)

- **Context:** No local PostgreSQL, `psql`, or Docker was available during development. The domain logic still needed deterministic, transactional writes.
- **Decision:** Default `DATA_ADAPTER=local`; `createStore()` serializes mutations, clones state with `structuredClone`, and persists with temp-file + rename. Presence stays in memory.
- **Consequences:** Dev/demo works without a database, but this is explicitly **not PostgreSQL**. `DATA_ADAPTER=postgres` now selects a real transactional JSONB `Store` (`saha_state`), **Implemented but Not Runtime-Verified** here. The Drizzle schema/migrations are a target path, not applied and not used at runtime. No production migration was executed.

## ADR-004 — Session cookies, CSRF and WebSocket token — Accepted

- **Context:** Browser clients must call a state-changing REST API and open a WebSocket on the same origin (via Vite proxy in dev).
- **Decision:**
  - `saha_session`: httpOnly, SameSite=Lax, 8-hour session cookie; stores the raw random token in the client, SHA-256 hash in `authSessions`.
  - `saha_csrf`: readable double-submit cookie whose value must equal the `x-csrf-token` header for non-GET/HEAD/OPTIONS requests; it is distinct from `saha_session`.
  - `POST /api/auth/ws-ticket` issues a separate random 10-minute ticket. The web client uses it as the `?token=` value and falls back to `saha_csrf`; both resolve only through `findSessionByWorldCredential` as world-only aliases and cannot authenticate HTTP requests.
  - CSRF exemptions are limited to `/api/auth/login`, `/register`, `/forgot`, `/reset` and `/api/access/:token/redeem`; `/api/health` and `/api/demo/seed` are mounted before the middleware.
- **Consequences:** Session, CSRF and socket credentials are no longer interchangeable. The fallback CSRF alias is still not HMAC-signed; ticket rotation/replay policy remains an open decision (see [open decisions](decisions/open-decisions-and-risks.md) and [security.md](security.md)).

## ADR-005 — Self-service register and token-info endpoints — Accepted

- **Context:** The SRS describes members being registered into organizations. The MVP needs standalone onboarding and a pre-acceptance preview for invite/access links.
- **Decision:** Add `POST /api/auth/register`, `GET /api/orgs/token/:token` (invitation preview), and `GET /api/access/:token/info` beyond a literal reading of the SRS. Self-registration creates a user with no org; organization creation then assigns `org_admin`. Token-info endpoints return non-sensitive metadata only (org/workspace/room names, expiry, uses, masked phone hint).
- **Resolved path:** the web client uses the registered `/api/orgs/token/:token` preview and `/api/orgs/token/:token/accept` redemption paths; the earlier `/api/invitations/token/...` mismatch was fixed in both client code and tests.
- **Consequences:** Onboarding and redemption screens can render honest context without exposing raw tokens or requiring a session. Raw tokens are never returned from info endpoints.

## ADR-006 — Demo organization isolation — Accepted

- **Context:** Demo data must never be mistaken for real customer data.
- **Decision:** `seedDemo()` creates one organization with `settings.demo=true`, fixed demo accounts (`+201000000001` / `Demo1234!`), schedules, generated attendance events and one audited correction. Re-running reuses the existing demo org. Seeding is gated by `ALLOW_DEMO_SEED` (set `false` to disable) and the response carries an explicit notice. The UI shows a demo-data banner.
- **Consequences:** Demo data is tenant-scoped like any other org. Operators must disable seeding and remove/recreate demo data before real use.

## ADR-007 — Attendance is server evidence, not browser presence — Accepted

- **Context:** The SRS distinguishes presence from attendance and requires verifiable punctuality.
- **Decision:** All event timestamps originate on the server. `calculateAttendance()` is pure and handles grace, heartbeat timeouts, disconnect/reconnect segments, break overlap, duplicate event IDs, verification windows and minimum connected time. Manual corrections require a reason and write both an `attendanceChange` and an audit entry.
- **Consequences:** Connected time is evidence of connection, never of productive work. Presence in the office is explicitly labeled separately in the UI.

## ADR-008 — Deferred register instead of fake controls — Accepted

- **Context:** The SRS includes LiveKit media, proximity audio, meetings, recording, Google Drive, SMS billing-adjacent items and later-scope features.
- **Decision:** Keep a single authoritative [deferred register](deferred-register.md). UI surfaces show badges/notes (`Not in MVP`, `Planned for a later release`, media deferred note) and no enabled buttons that pretend to work. Environment variables for deferred integrations are placeholders only.
- **Consequences:** Users are not misled; future work is explicit. External calendar integration is deferred even though a local read-only month view of generated sessions exists.

## ADR-009 — Server-authoritative tenancy and RBAC — Accepted

- **Context:** Multi-tenant SaaS requires strict isolation and role checks that cannot rely on UI hiding.
- **Decision:** `requireOrg` resolves the org from the route (or `x-organization-id`), verifies active membership (with a super-admin seed exception and guest scoping) and attaches the role. `requirePermission` checks the server-side permission matrix. All entity lookups are filtered by `organizationId`. The web `can()` helper is UI-only.
- **Consequences:** Hiding a button is never the security boundary. Role changes and suspended memberships take effect on the next request.
