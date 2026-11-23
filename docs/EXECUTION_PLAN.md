# Master execution plan — Workstream 0 baseline

Version 1.0 — 2026-11-23. Status vocabulary is restricted to the six labels in `docs/FINAL_COMPLETION_MATRIX.md`: Completed and Verified; Partially Implemented; Implemented but Not Verified; Not Implemented; Blocked by External Dependency; Requires Owner Approval.

## Binding references and conflict handling

- SRS v1.0, Master Blueprint v1.0, ADR-001…ADR-009 (all Accepted), previous directives, `docs/FINAL_ARABIC_REPORT.md`, `docs/FINAL_COMPLETION_MATRIX.md`.
- No `DEC-*` identifiers exist in the repository; the recorded owner decisions are listed at `MATRIX:11`.
- Latest owner instruction prefers **Supabase PostgreSQL + Supabase Storage**. The immediately preceding owner choice was **Render** as the Node host. These are compatible: Render runs the single Node/WS process, Supabase provides Postgres and Storage. No architecture change is implied.
- ADR-002 (single-instance world/presence) and ADR-003 (local JSON is dev-only) remain binding. ADR-004 credential split, ADR-005 canonical invitation routes, ADR-006 demo isolation, ADR-007 server-side attendance evidence, ADR-008 explicit deferral over fake controls, ADR-009 server-side tenancy/RBAC are preserved.

## Verified baseline

| Item | Evidence |
| --- | --- |
| 136 tracked requirements | `docs/FINAL_COMPLETION_MATRIX.md` |
| 80 Completed and Verified / 25 Partially Implemented / 6 Implemented but Not Verified / 1 Not Implemented / 18 Blocked by External Dependency / 6 Requires Owner Approval | Parsed from all 136 final-status cells |
| 28 test files / 135 passing tests | `npm.cmd test` re-executed after the final UI changes (log: `saha-test-final3.log`) |
| lint and production build pass | `npm.cmd run lint`, `npm.cmd run build` re-executed this session |
| API/WS modules mounted | `apps/api/src/app.ts:69-101` |
| Web routes mounted | `apps/web/src/App.tsx:63-89` |
| No real PostgreSQL / psql / Docker / migration applied | `docs/database.md`, environment probe |
| Git repository initialized with GitHub origin, no CI config, no permanent browser E2E suite | `git remote -v`; WebSocket runtime tests exist, browser E2E does not |
| No deployment performed | `docs/deployment.md` |

## Workstream plan

| WS | Requirement IDs (representative) | Existing implementation | Exact missing work | Files / modules | Dependencies | Required tests | Acceptance criteria | Current status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | all 136 | Final matrix, reports, source, tests, reconciled counts and log | No remaining contradiction in the authoritative matrix; Retest evidence is recorded | `docs/EXECUTION_PLAN.md`, matrix, reports | none | re-run lint/test/build | baseline reproducible, no silent status inflation | Completed and Verified |
| 1 | S1-FND-03…11, S1-FIX-25…29 | Local JSON adapter, unverified `pg` JSONB adapter, additive SQL, local persisted `jobRuns` with stale recovery | Real Supabase connection string; apply migration; rollback drill; RLS; DB round-trip health; PostgreSQL-backed durable job table; connection lifecycle; env validation; separate dev/staging/prod config | `apps/api/src/common/store.ts`, `postgres-store.ts`, `apps/api/src/db/*`, `apps/api/migrations/*`, `app.ts`, `main.ts` | Supabase project ref supplied, but `DATABASE_URL` with password and reachable Postgres port are still required | connection, migration, rollback, isolation, concurrency, rollback-on-error, unique constraints, session persistence/revocation, job restart, backup/restore | all database acceptance tests in §4.1 actually ran against PostgreSQL | Blocked by External Dependency |
| 2 | S1-AUTH-*, S1-ORG-*, S1-RBAC-* | Phone+password, scrypt, sessions, CSRF, WS tickets, OTP reset dev code, orgs/members/teams/guests | Distinct Owner entity from `org_admin`, last-admin/transfer safety, global revocation on suspension, real SMS OTP, holiday/one-off leave entities | `modules/auth`, `organizations`, `members`, `invitations`, `common/middleware.ts` | SMS provider for real OTP | RBAC matrix tests, transfer/last-admin tests, cross-tenant denial, session revocation | owner/admin distinction verified server-side; OTP atomic and expired correctly | Partially Implemented |
| 3 | S1-SCH-* | Rules, generation, sessions, calendar view, exception sync | Holiday management UI, one-off/leave entity, conflict/concurrency edge cases, external calendar sync where approved | `modules/schedules`, `features/schedules` | optional Google Calendar access | overlapping-session and concurrent-modification tests | schedule ↔ attendance sync verified on real DB | Partially Implemented |
| 4 | S1-ATT-* | Separate shift/mentor calculation, finalization after 15 min, 60 s poller, corrections/audit, local persisted `jobRuns` with stale-run recovery and idempotent re-execution | Reconcile all active sessions per event, full session key policy, PostgreSQL-backed durability/monitoring, combined/report separation | `modules/attendance`, `jobs.ts`, `features/attendance` | durable queue from WS1 | concurrency, duplicate check-in, idempotency, exception tests, `attendance-jobs.test.ts` | 15-minute rule never replaced by poll interval; both systems independent | Partially Implemented |
| 5 | S1-RPT-* | Real local-data reports, CSV, filters | Separate shift/mentor tabs, PDF where required, permission-scoped visibility, pagination/search on real DB | `modules/reports`, `features/reports` | real DB for final evidence | report calculation tests on seeded DB | every report uses real stored data | Partially Implemented |
| 6 | S1-VO-*, S3-AVA-01, S1-FIX-22/23 | Server-authoritative world, PixiJS renderer, movement/presence/proximity, responsive/touch, **stored avatar config consumed in renderer** and delivered in `welcome` | Full furniture/layout builder, capacity test, accessibility audit, two-client browser E2E | `world/registry.ts`, `world/socket.ts`, `features/office/VirtualOffice.tsx`, `customization` | none for renderer gap | unit tests + two independent browser sessions | saved character/outfitColor/accessory visibly rendered | Partially Implemented |
| 7 | S1-FND-02, WS7 credential requirements | Env placeholders, redacted integration readiness, AES-256-GCM vault with org/platform routes, masking, scope/expiry/revocation, tenant isolation, key re-seal, audit, production fail-closed | Production KMS/secret store, operator-controlled key lifecycle and a credentials management UI | `common/secrets.ts`, `modules/credentials`, `common/middleware.ts` | `CREDENTIAL_MASTER_KEY` / KMS choice | `vault.test.ts`: 11 tests for round-trip, tamper/wrong-key, masking, no leakage, scope, expiry, revocation, cross-org denial, platform isolation, rotation | no plaintext secrets in source/logs/frontend/DB ordinary fields | Completed and Verified |
| 8-11 | S2-AUD-*, S2-MED-*, S2-SHR-*, S2-REC-* | Signed JWT helper, local meeting/recording state machines, explicit `PROVIDER_NOT_CONFIGURED` | LiveKit project, real tracks, device handling, proximity audio, moderator controls, Egress recording, playback/download, retention | `modules/media`, `modules/recordings`, `features/meetings`, `VirtualOffice.tsx` | LiveKit URL/key/secret + egress config | real multi-client browser media tests | real audio/video/share/recording verified | Blocked by External Dependency |
| 12 | S2-GDR-* | OAuth prepare/callback/status/upload adapter with honest errors | Google Cloud OAuth client, per-org consent, token refresh, folder selection, real upload, retry/dedupe, audit | `modules/drive`, `features/recordings` | Google OAuth credentials + Drive API + real recording bytes | real uploaded-file verification in connected Drive | one org's recordings only in its own Drive | Blocked by External Dependency |
| 13 | S2-* end-to-end | Individual local workflows | Integrated 12-step workflow, multi-user/org, failure/reconnect scenarios | cross-module | all Stage 2 credentials | E2E suite | all gate items demonstrated | Blocked by External Dependency |
| 14-16 | S3-SUB-*, S3-BIL-*, S3-QTA-*, X-ACC-01/02/07 | Plan catalog, local trial, HMAC webhooks, quota metrics, admin assignment, annual intervals, super-admin plan CRUD/archive/reactivate, server-side feature gates, **world connect entitlement gate** and concurrent quota checks | Full payment state machine, immutable history, invoice numbering/PDF, sandbox provider activation and provider-backed capability verification | `modules/billing`, `billing/entitlements.ts`, `world/socket.ts`, `features/billing`, `features/admin` | payment sandbox credentials; local work needs none | state-transition, webhook idempotency, quota boundary tests, `billing-admin.test.ts`, `world-connect-entitlement.test.ts` | entitlements block real backend operations, not just UI | Partially Implemented |
| 17-18 | S3-CUS-*, S3-ANA-* | Branding/avatar/template state, local analytics | Consume branding colors in renderer, full white-label, historical/export analytics on real DB | `modules/customization`, `modules/analytics`, renderer | real DB for final evidence | renderer + analytics tests | no fabricated statistics | Partially Implemented |
| 19-20 | S3-MSG-*, S3-AI-* | DM/channels with cursor paging/read receipts, local deterministic summary | WS push for messages, AI provider config, transcript capture, privacy/cost controls | `modules/messaging`, `modules/ai`, world socket | AI provider credentials | persistence/realtime and provider tests | messages survive restart; AI status honest | Partially Implemented |
| 21 | S3-EXT-* | 7-provider registry, HMAC webhook logging, placeholder OAuth URL | Real OAuth for Calendar/Outlook/M365/Slack/Teams, token refresh, delivery logs, idempotency, public API keys/docs | `modules/integrations` | provider credentials + owner approval | per-provider success/failure tests | real connection/disconnect/status per provider | Requires Owner Approval |
| 22 | S3-NOT-* | In-app notifications, delivery log with `skipped` | Email/SMS providers, preferences, templates, retry/failure logs, reminders | `modules/notifications` | email/SMS credentials | delivery tests with sandbox | no real messages without approval | Blocked by External Dependency |
| 23 | S1-FIX-29, S3-OPS-01 | Audit log, health endpoint, rate limiters | Structured logging, metrics, alerting, backup automation, restore drill, security review | `common/`, `app.ts`, runbook | real DB/hosting | operational drills | evidence of monitoring and restore | Partially Implemented |
| 24 | S1-FND-06, S3-OPS-02 | Vercel web config, deployment doc | CI, staging/prod config, migration checks, rollback, changelog, release checks, owner-controlled production deploy | `.github/workflows`, `docs/`, `vercel.json` | Vercel login, Render account, Supabase, DNS, owner approval | CI dry-run, staging smoke tests | no public production deploy without explicit approval | Requires Owner Approval |

## Immediate local execution queue (no credentials required)

1. Completed and Verified: avatar → world renderer pipeline (WS6 / S3-AVA-01) with regression tests.
2. Completed and Verified: `world:connect` plan/concurrent-user entitlement gate (WS16 / X-ACC-01) with real WebSocket quota tests.
3. Completed and Verified: matrix row corrections and stale-count/log reconciliation (WS0).
4. Completed and Verified locally: durable job persistence and restart recovery on the local adapter; PostgreSQL status remains Blocked by External Dependency.
5. Completed and Verified: encrypted credential vault (WS7) with no third-party dependency.

## Evidence rules for this execution

- A row becomes Completed and Verified only after implementation, integration, persistence (where applicable), permissions, passing tests and recorded runtime evidence.
- Temporary scripts do not count as permanent evidence; verification scripts and results must be committed under `docs/evidence/` or `tests/`.
- Mocks are permitted only in isolated automated tests and must be labelled as such.
- No external service is claimed connected without real credentials and a verified round-trip.
