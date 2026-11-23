# Implementation status

Final status as of **2026-11-23**. Scope: the existing MVP was repaired and completed in place; no rebuild was performed.

Labels used in the authoritative [final completion matrix](FINAL_COMPLETION_MATRIX.md): **Completed and Verified**, **Implemented but Not Verified**, **Partially Implemented**, **Not Implemented**, **Blocked by External Dependency**, **Requires Owner Approval**. “Completed and Verified” means a command, automated test, browser session, CDP measurement, or WebSocket runtime check actually ran in this environment. It does **not** mean production PostgreSQL, a deployment, a real SMS provider, or human visual sign-off was exercised.

## Verification actually performed

- `npm.cmd run lint` — passed (`tsc -p tsconfig.api.json --noEmit` and `tsc -p tsconfig.web.json --noEmit`).
- `npm.cmd test` — passed: **28 test files / 135 tests** against the local JSON adapter and in-memory paths (log: `saha-test-final3.log`).
- `npm.cmd run build` — passed: API TypeScript build plus Vite web build (`dist/web`, 2783 modules transformed).
- Browser runtime: demo login (`+201000000001` / `Demo1234!`), office canvas render, EN/AR RTL, room shortcut click-to-route, keyboard movement, and presence/proximity were observed in the running app. Reconnect was verified by the WebSocket script below.
- WebSocket runtime: a temporary Node script completed 9 assertions — admin and student authentication, proximity on join, presence join broadcast, authoritative ack at `x=204`, movement broadcast, `ROOM_FORBIDDEN`, disconnect cleanup, and reconnect presence. The script was deleted after the run; the behavior is not yet a permanent automated test.
- Responsive/CDP runtime: 1440×900, 768×1024, 390×844 and 390×844 RTL all rendered the PixiJS canvas and 8 room buttons with `documentOverflowX: 0`. Mobile D-pad moved the confirmed avatar `x` from `180` to `247.8395`. Screenshots are in [docs/evidence](evidence/). The temporary CDP scripts were deleted after capture.
- Drizzle offline generation was checked into a temporary folder only. No migration was applied to any database.

## Final status matrix

| Area | Status | What is actually present / verified |
| --- | --- | --- |
| Phone + password authentication | Implemented and Verified | Normalized globally unique E.164 phones, scrypt hashes with random salt, generic login failures, 8-hour revocable sessions, `/me`, session revoke, and `/auth/ws-ticket`. Covered by API/security tests and browser demo login. |
| Password reset OTP | Implemented and Verified (dev-only delivery) | CSPRNG code, phone-bound HMAC using `SESSION_SECRET`, 10-minute expiry, 5-attempt cap, single use, other-session revocation, issue throttling. No SMS provider exists; `devCode` is returned only in non-production. |
| Tenant isolation and RBAC | Implemented and Verified | `requireOrg` + `requirePermission`, server-side permission matrix and role ranks, guest scoping, cross-org denial, report/attendance privacy and CSV neutralization. UI `can()` is helper-only, never the boundary. |
| Invitations and access links | Implemented and Verified | Canonical `/api/orgs/token/:token` and `/api/orgs/token/:token/accept`; hashed one-time tokens, expiry/use/revocation, phone targeting, passwordless member links (4h/1 use) and public guest links (24h/10 uses). |
| Guest access | Implemented and Verified | Scoped synthetic guest session with only `world:connect`; no org settings, reports, attendance history, member management or org reads. Scope persists in `sessionStorage` key `saha_office_scope`. Guest sessions are revoked with their link. |
| Schedules, attendance and reports | Implemented and Verified | Recurring rules/UTC materialization, server-generated events, grace/heartbeat/reconnect/break logic, manual corrections with reason/before-after + audit, absences finalization on explicit action, and CSV export. |
| Virtual office / real-time world | Implemented and Verified (single instance) | Deterministic server-owned 8-room 1400×900 layout, procedural PixiJS decor, avatars, WASD/arrows/click-to-route/touch D-pad, obstacle/collision and portal rules, `allowedRoles`, proximity indicators, fit/zoom/pan/follow camera, minimap, reconnect/backoff, and server ack/rejected reconciliation. A dev-only `window.__sahaOfficeDebug` hook is retained behind `import.meta.env.DEV`. |
| Credential separation | Implemented and Verified | `saha_session`, `saha_csrf` and the WS ticket are separate random values. The client requests `/api/auth/ws-ticket` (10-minute TTL) first and falls back to `saha_csrf`; both resolve only as world-only aliases and cannot authenticate HTTP requests. Tested in `security-hardening.test.ts` and the WS runtime script. |
| Local JSON persistence | Implemented and Verified | Default `DATA_ADAPTER=local`: serialized `Store.mutate()` queue, `structuredClone` draft, atomic temp-file rename, fail-closed on corrupt JSON. Safe for one process only. |
| `pg` transactional JSONB store | Implemented but Not Runtime-Verified | `DATA_ADAPTER=postgres` creates a real `pg` Pool from `DATABASE_URL`, ensures one `saha_state` row, and locks it with `SELECT ... FOR UPDATE` inside a transaction. No PostgreSQL instance, credentials, `psql`, or Docker was available, so this path was never executed. |
| Normalized Drizzle schema and baseline SQL | Implemented but Not Runtime-Verified | `apps/api/src/db/schema.ts`, `apps/api/migrations/0000_initial_schema.sql`, `drizzle.config.ts` and the `db:generate` script exist and were checked against offline generation. They are additive target artifacts, not applied and not used by runtime queries. |
| Normalized repository layer, RLS, live DB constraints, object storage | Not Implemented | No repository reads normalized tables; no RLS policies, DB-enforced tenant checks, signed-URL storage, migration application or restore drill exists. Design intent is documented only. |
| LiveKit media, proximity audio, meetings, screen sharing, recording, Google Drive, SMS, DMs, billing, custom avatars/furniture, external calendar, AI summaries | Explicitly Deferred | Listed in [deferred-register.md](deferred-register.md); UI shows notes/badges and no fake enabled controls. Deferred by the recorded user directive. |
| CI/CD and production deployment | Not Implemented | No pipeline, staging/provisioning, production rollout, backup restore, or real provider credential was created. [deployment.md](deployment.md) is an operator checklist, not a deployment record. |

## Known limitations and honest caveats

- **Single instance only (ADR-002).** Presence is a process-local `Map`. Multiple API/world processes fragment presence; sticky sessions alone do not solve it.
- **No production database evidence.** PostgreSQL is not runtime-verified, migrations were not applied, and normalized repositories/RLS are absent. Do not claim production persistence from this build.
- **No background worker.** Attendance finalization remains an explicit API/UI action.
- **Residual WS risk.** The CSRF-cookie fallback alias remains for compatibility. A dedicated 10-minute ticket is now preferred; signed-ticket rotation/replay policy is still an open risk.
- **Operational prerequisites remain.** Set a real `SESSION_SECRET`, disable `ALLOW_DEMO_SEED`, configure HTTPS/secure cookies/CORS, add general rate limiting, and remove demo data before real use. OTP attempts are capped, but login/register/token-redemption rate limits are not implemented.
- **Audit logs are mutable** entries in the current state; no retention, append-only table, or central shipping exists.
- **Visual review limitation.** Screenshots and DOM/CDP metrics were captured, but this model could not perform subjective visual design review. The screenshots are provided for human inspection.
- **Other environment limits.** No image-generation credits, no Git repository initialized at `D:\`, and pre-existing/transitive npm audit findings were reported but not fixed with breaking dependency changes.

See [acceptance-report.md](acceptance-report.md) for the mandatory scenario-by-scenario classification and exact evidence.
