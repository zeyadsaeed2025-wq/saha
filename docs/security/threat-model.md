# Security threat model (MVP truth)

**Status:** controls below are **Implemented and Verified** only where the existing local test suite covers them; deployment, Postgres, RLS and object-storage controls are **Implemented but Not Runtime-Verified**, **Not Implemented** or **Explicitly Deferred** as labeled. This is a design review, not a penetration test.

## Assets and trust boundaries

| Asset | Boundary / current storage |
| --- | --- |
| Credentials | Phone/password; scrypt hashes in `DbState`; session tokens hashed with SHA-256; OTP codes stored as phone-bound HMAC using `SESSION_SECRET`. |
| Tenant data | One JSON file (`LOCAL_DATA_FILE`) or one `saha_state` JSONB row. Tenant checks are in application code (`requireOrg`, `findInOrg`). |
| Attendance evidence | Server-generated events in the same state; manual corrections append `attendanceChanges` + audit log. |
| Presence | In-memory `WorldRegistry` only (ADR-002), never persisted. |
| Tokens | Invitation/access-link raw tokens shown once; only SHA-256 hashes stored. |
| Audit logs | Mutable entries in the same state; no separate retention or tamper protection. |

Trust boundaries: browser ↔ reverse proxy (TLS), proxy ↔ Express (`/api`, `/ws/world`), app ↔ Store adapter, app ↔ Postgres (when selected), app ↔ future object storage (Explicitly Deferred).

## STRIDE review

| Category | Threat | Mitigation status | Gap / action |
| --- | --- | --- | --- |
| Spoofing | Stolen session cookie used against HTTP | Implemented: random token in httpOnly cookie, SHA-256 hash in store, revocation and expiry. | No rate limiting on login/OTP/token redemption; `SESSION_SECRET` has a deterministic dev fallback when short/missing — require ≥16 chars in production. |
| Spoofing | Stolen readable `saha_csrf` used for WebSocket | Partially Implemented: the client prefers a separate 10-minute `/auth/ws-ticket`; both ticket and fallback alias are world-only and cannot authenticate HTTP. | The fallback credential is still cookie-derived and neither is HMAC-signed; `SESSION_SECRET` HMAC protects OTPs, not WS. Decide ticket rotation/replay rules. |
| Tampering | Cross-tenant read/write via guessed IDs | Implemented: `requireOrg`, active membership/guest scoping, server-side permission matrix, `organizationId` filters. | RLS and DB constraints are Not Implemented; every new SQL query must keep tenant filters. |
| Tampering | CSRF on state-changing API | Implemented: double-submit `saha_csrf` + `x-csrf-token`; limited exemptions. | `/api/demo/seed` and `/api/health` are mounted before the guard; disable seeding and block the route at the proxy. |
| Tampering | Corrupt local state file | Implemented: temp-file + atomic rename, fail-closed on unreadable JSON. | No checksum/signature; file permissions and backups are operator responsibility. |
| Repudiation | Actor denies an action | Implemented: audit log + attendance-change reason/before/after. | Logs are mutable and co-located with data; append-only DB table and central shipping are Not Implemented. |
| Information disclosure | Raw tokens / OTP codes leak | Implemented: hashes at rest, one-time display, masked phone hint, generic auth errors. | `devCode` is returned when no SMS provider and non-production; health endpoint discloses adapter/configuration; console error logs may contain stack details. |
| Information disclosure | Plaintext data file or JSONB row read by an operator | Partially Implemented: store is `saha_state`/local file, no field-level encryption. | Restrict file/DB roles, encrypt volumes, never commit `DATABASE_URL`. |
| DoS | Large payloads, WS floods, expensive reports | Partially Implemented: 256kb JSON body limit, single-instance queue. | No rate limits, connection caps, query timeouts or worker isolation; normalized indexes are not applied. |
| Elevation of privilege | Student escalates role or joins another org | Implemented: role-rank guard, cannot change own admin role/remove self, permission matrix. | Hardcoded `super-admin-seed` exception and world role fallback deserve review before production. |
| Elevation of privilege | SQL injection after normalized migration | Not Implemented risk area | Use parameterized repositories; never concatenate tenant IDs. Enable RLS with `app.tenant_id` before raw SQL access. |
| Supply chain | Malicious dependency / build script | Partially Implemented: lockfile present; esbuild install scripts may be blocked by the environment. | Review `npm approve-scripts`, pin versions, run `npm audit` and CI checks. |

## Production prerequisites

- [ ] `SESSION_SECRET` ≥16 random chars; `COOKIE_SECURE=true`; HTTPS at proxy; `/ws` upgrade forwarded.
- [ ] `ALLOW_DEMO_SEED=false` and proxy blocks `/api/demo/seed`; demo orgs removed.
- [ ] `CORS_ORIGINS` / `APP_URL` limited to real origins (note: current code reads `APP_URL` for CORS).
- [ ] Rate limiting and monitoring/alerts in place; no `devCode` in production.
- [ ] One world instance per ADR-002, protected local data file or reviewed Postgres adapter.
- [ ] Backups, restore drill, log shipping and incident contacts documented in [operations/runbook.md](../operations/runbook.md).
- [ ] User ratification of the Explicitly Deferred P0 media/Drive scope.
