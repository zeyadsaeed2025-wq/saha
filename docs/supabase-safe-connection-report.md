# Supabase PostgreSQL — safe connection and migration report

Generated: 2026-11-24  
Repository: `https://github.com/zeyadsaeed2025-wq/saha.git`  
Base commit preserved: `57a694e13d20718e3289b314a028fc359cfa4fcf`  
Recovery tag: `recovery-57a694e`  
Working branch: `supabase-safe-connection`  
Supabase project reference supplied by owner: `wyjnopgbdszzkehxside`

**Important:** This document contains no credential values. No database password, URL, service-role key, access token, or local data content was printed or committed. **PostgreSQL is not operational for this application yet.** No migration, data import, cutover, or deploy was performed.

Status labels used here are limited to: `Completed and Verified`, `Partially Implemented`, `Implemented but Not Verified`, `Not Implemented`, `Blocked by External Dependency`, `Requires Owner Approval`.

## Status summary

| Area | Status | Evidence / limit |
| --- | --- | --- |
| Recovery point and isolated branch | Completed and Verified | `HEAD=57a694e`, clean tree before edits; tag `recovery-57a694e` pushed; branch `supabase-safe-connection` created. |
| Secret and local-data exclusions | Completed and Verified | `.env`, `.env.*`, `!.env.example`, `*.pem`, `*.key`, `data/store.json`, `*.log`, `coverage/`, `dist/`, `node_modules/` ignored; tracked forbidden files = 0 except intended `.env.example`. |
| Local environment presence check | Completed and Verified | All relevant variables reported only as `SET`/`MISSING`; all were `MISSING` in Process/User/Machine scopes. Values were never read or printed. |
| Network/DNS/API reachability diagnosis | Partially Implemented | DNS, TCP and HTTPS results below; TLS handshake, pooler endpoint and credentials not evaluated. |
| Exact database identity and environment | Blocked by External Dependency | `DATABASE_URL` absent; no SQL query executed. |
| Static schema/migration compatibility | Partially Implemented | All schema/migration artifacts reviewed as text; actual instance not inspected. |
| Local JSON data compatibility checks | Partially Implemented | Ignored local `data/store.json` parsed without printing content; counts and invariants below. |
| Additive migration on disposable DB | Blocked by External Dependency | No disposable DB, `DATABASE_URL`, `psql`, `pg_isready`, `openssl`, or Docker available. |
| Rollback/restore drill | Blocked by External Dependency | No database snapshot/restore was possible. |
| RLS and production fail-closed hardening | Not Implemented | RLS is design-only; production can still default to local JSON if `DATA_ADAPTER` is unset. |
| PostgreSQL runtime cutover | Requires Owner Approval | No `DATA_ADAPTER=postgres` startup, workflow verification, or deploy was performed. |

---

## 1. Connection test results

No database connection was attempted with application credentials because `DATABASE_URL` is not present in the local environment. No password was requested, printed, stored, or passed to any command.

| Check | Result | Interpretation |
| --- | --- | --- |
| Env variable presence (Process/User/Machine) | `DATABASE_URL`, `PGSSLMODE`, `PG_POOL_MAX`, `SUPABASE_URL`, `SUPABASE_DB_PASSWORD`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ACCESS_TOKEN`, `CREDENTIAL_MASTER_KEY` = `MISSING` | There is no local connection string to validate. This is not evidence that credentials are invalid. |
| DNS `db.wyjnopgbdszzkehxside.supabase.co` A | Empty | Current resolver returned no IPv4 address for the direct DB hostname. |
| DNS `db.wyjnopgbdszzkehxside.supabase.co` AAAA | `2a05:d018:ea6:fe00:2d75:3459:17d9:5878` | Current resolver returned IPv6 only for the direct DB hostname. |
| TCP `db.wyjnopgbdszzkehxside.supabase.co:5432` | False | Direct PostgreSQL port is unreachable from this shell. Cause is not isolated; could be egress, firewall, IPv6 routing, allowlist, or project network config. |
| TCP `db.wyjnopgbdszzkehxside.supabase.co:6543` | False | Port 6543 on the direct DB hostname is unreachable here. This is **not** a definitive pooler test: the real pooler hostname/mode is unknown until `DATABASE_URL` is supplied. |
| DNS `wyjnopgbdszzkehxside.supabase.co` A | `172.64.149.246,104.18.38.10` | API hostname resolves. |
| TCP `wyjnopgbdszzkehxside.supabase.co:443` | True | HTTPS egress to the Supabase API host works. |
| `GET https://wyjnopgbdszzkehxside.supabase.co/rest/v1/` | HTTP `401 Unauthorized` | The API responds; 401 is expected without an API key. It proves neither database access nor credential validity. |
| Local DB tools | `psql`, `pg_isready`, `openssl`, `docker` = `MISSING` | No direct SQL, TLS-handshake, or containerized migration/rollback tooling is available in this shell. |
| Actual SQL query against Supabase | Not run | Cannot run without `DATABASE_URL`; intentionally not inferred from the API 401 or TCP timeout. |

### Separate diagnoses

- **Network/DNS:** IPv6-only direct DB DNS and failed TCP on 5432/6543 indicate a connectivity blocker from this host. Do not classify this as a credential failure.
- **TLS:** Not verified. The current adapter sets `rejectUnauthorized: false` for every `PGSSLMODE` value other than `disable`; see Security findings.
- **Pooler:** Not evaluated. The pooler hostname, port, region, and mode can only be determined from the owner-supplied `DATABASE_URL`.
- **Credentials:** Not evaluated. No credential was available and none was requested.

### Read-only probe to run once `DATABASE_URL` is set locally

Do **not** start the app with `DATA_ADAPTER=postgres` for this probe. `createPostgresStore()` runs `CREATE TABLE IF NOT EXISTS saha_state` and `INSERT ... ON CONFLICT DO NOTHING`, so startup is not read-only.

```sql
BEGIN READ ONLY;
SELECT current_database(), current_user, version(),
       inet_server_addr(), current_setting('server_version_num');
SELECT to_regclass('public.saha_state') IS NOT NULL AS has_saha_state;
COMMIT;
```

Follow with read-only object/data counts only after identity and environment are confirmed.

---

## 2. Database identity and environment

| Item | Result |
| --- | --- |
| Supabase project reference | `wyjnopgbdszzkehxside` (owner-supplied; not independently verified) |
| Exact database name | Unknown — `current_database()` not queried |
| Database role | Unknown — `current_user` not queried |
| PostgreSQL version | Unknown — `version()` not queried |
| Region / pooler endpoint | Unknown — not present in local env |
| Environment classification | Unknown — not confirmed disposable/staging |
| Existing data | Unknown on Supabase; no read-only query run |
| Destructive/schema-changing operation | None performed |
| Migration applied | None performed |

A Supabase project reference is **not** proof of the exact target database. Before any write, the owner must confirm that the `DATABASE_URL` points to a disposable test database or a separately provisioned staging database, and that it contains no production data that would be affected.

---

## 3. Migration compatibility report

### Artifacts reviewed

- `apps/api/src/db/schema.ts`
- `apps/api/migrations/0000_initial_schema.sql`
- `apps/api/migrations/README.md`
- `drizzle.config.ts`
- `apps/api/src/common/postgres-store.ts`
- `apps/api/src/common/store.ts`
- `apps/api/src/domain/types.ts`
- `docs/database.md`

### Static comparison results

| Check | Result |
| --- | --- |
| Drizzle table definitions | 21 |
| Baseline SQL `CREATE TABLE IF NOT EXISTS` statements | 21 |
| Table name sets match | Yes |
| Drizzle named indexes/unique indexes | 58 |
| Baseline SQL named indexes | 58 |
| Index name sets match | Yes |
| `DROP` statements in baseline | 0 |
| `ALTER` statements in baseline | 0 |
| Active `ENABLE ROW LEVEL SECURITY` statements | 0 (design comment only) |
| `gen_random_uuid()` requirement | PostgreSQL 13+ or `pgcrypto`; actual server version unknown |

The baseline is additive as written. However, `IF NOT EXISTS` can silently skip a pre-existing but incompatible table or index, so text-level compatibility is **not** proof of compatibility with the real instance. Live introspection is still required.

### Runtime vs target-schema gap

- Active runtime uses one JSONB compatibility row, `saha_state.id = 'saha-main'`, through `createPostgresStore()`.
- The 21 normalized Drizzle tables are target artifacts only; no runtime repository reads or writes them.
- `presence` remains in memory per ADR-002 and is intentionally absent from SQL.
- Because `saha_state` is a single encrypted-by-application JSON document, per-table RLS cannot protect tenant boundaries inside it. Tenant checks remain in application code (`requireOrg` / `findInOrg`).

### Local JSON state compatibility checks

The ignored local file `data/store.json` was parsed without printing record contents.

| Check | Result |
| --- | --- |
| Top-level `DbState` arrays | 36 |
| SHA-256 of local file | `e046aa0ee15c55632aec56c691521b3925cf5e943e6b824d6c99cf0897fe8899` |
| Users / organizations / memberships / auth sessions | 11 / 3 / 10 / 269 |
| Schedules / scheduled sessions / attendance sessions / attendance events / job runs | 7 / 52 / 47 / 892 / 100 |
| Job-run statuses | 100 `succeeded`, 0 `running` |
| Duplicate user phones / org slugs / membership org+user pairs | 0 / 0 / 0 |
| Duplicate invitation, access-link, session token hashes | 0 / 0 / 0 |
| Duplicate schedule rule+start / attendance session+user keys | 0 / 0 |
| Referential orphans checked across memberships, sessions, workspaces, rooms, schedules, attendance | 0 |
| Records carrying `tenantId` | 0 |
| Non-E.164 user phones | 1 of 11 |
| User IDs not conforming to UUID form | 1 of 11 |
| Auth-session IDs not conforming to UUID form | 9 of 269 |

### Compatibility findings requiring a decision

1. **Normalized `tenant_id` cannot be imported as-is.** The runtime records contain `organizationId` but no `tenantId`; three organizations also have no `tenantId`. The normalized schema declares `tenant_id NOT NULL UNIQUE` on organizations and `NOT NULL` on many tables. A derivation rule (for example `tenant_id = organizationId`, and `tenant_id = id` for organizations) must be reviewed and approved before any normalized import.
2. **19 `DbState` arrays have no normalized table:** `guestRequests`, `meetings`, `meetingParticipants`, `recordings`, `driveConnections`, `plans`, `subscriptions`, `invoices`, `paymentEvents`, `channels`, `messages`, `notificationLogs`, `aiInsights`, `integrations`, `avatarConfigs`, `workspaceTemplates`, `usageRecords`, `credentials`, `jobRuns`. A direct normalized-only migration would lose these records unless the schema is extended or these collections are explicitly retained in `saha_state`.
3. **Non-UUID legacy IDs exist.** One user ID and nine session IDs are not UUID-shaped. The normalized schema uses UUID primary keys. These records need an explicit mapping or classification (for example synthetic guest identities) rather than silent dropping.
4. **Credentials must remain sealed.** `credentials` is empty in this local snapshot, but the schema must preserve ciphertext and key-version metadata; no master key or plaintext should be exported.

Overall: the text-level schema pair is internally consistent, but compatibility with the actual instance and a lossless normalized import are **Partially Implemented** and remain unverified.

---

## 4. Data migration plan

No step below has been executed against Supabase. This is the proposed safe sequence.

### Phase A — Preflight

1. Owner sets `DATABASE_URL` locally only; no value is pasted into chat, docs, source, or CI logs.
2. Run the read-only identity probe in Section 1.
3. Confirm the exact database name, role, server version, and that the database is disposable/staging with no production data at risk.
4. Inspect existing objects read-only: `to_regclass(...)`, table names, index definitions, and row counts. Do not call Drizzle `push`, `migrate`, reset, drop, or truncate.
5. Confirm network path to the real direct or pooler endpoint from the host that will run the migration.

### Phase B — Local source snapshot

1. Copy `data/store.json` to a timestamped location outside the repository.
2. Record its SHA-256 and all 36 array counts.
3. Verify the invariants listed in Section 3 again on the snapshot.
4. Freeze application writers during cutover. Do not use `store.reset()`.

### Phase C — Disposable rehearsal

1. Take a database backup/snapshot before applying anything.
2. Apply `apps/api/migrations/0000_initial_schema.sql` only after owner approval and only to the disposable/staging database.
3. Re-run the static table/index checks against live catalogs; confirm no name collision silently skipped an incompatible object.
4. Import the local state into `saha_state` in one transaction. If a `saha-main` row already exists, **abort** rather than overwrite it:

```sql
BEGIN;
SELECT id FROM saha_state WHERE id = 'saha-main' FOR UPDATE;
-- Only when no row exists:
-- INSERT INTO saha_state (id, state) VALUES ('saha-main', $1::jsonb);
COMMIT;
```

5. Verify byte-for-byte JSON equality between the source snapshot and `saha_state.state` by canonical JSON comparison, plus per-array counts.
6. Test constraints and isolation read-only/transactionally: phone uniqueness, org slug uniqueness, membership pair uniqueness, token-hash uniqueness, schedule materialization key, attendance-session key, and `organizationId` filter behavior. Roll the test transaction back.
7. Snapshot again and rehearse restore/rollback. Do not proceed to cutover if any check fails.

### Phase D — Approved cutover

1. Use a single API/world process pair per ADR-002; multi-process presence would fragment.
2. Set `DATA_ADAPTER=postgres` explicitly in the host environment.
3. Add a fail-closed production guard so an unset `DATA_ADAPTER` or missing `DATABASE_URL` cannot fall back to local JSON.
4. Start the app once against the verified database. Treat `/api/health` as configuration status only, not database proof.
5. Verify login, revocable sessions, org switching, RBAC, invitations/access, schedules, attendance events, reports, plans, credentials, and durable job records against the real database.
6. Document actual results before any deploy.

### Phase E — Normalized projection (separate approval)

Do not attempt this during initial cutover. First extend the Drizzle schema for the 19 unmapped arrays, define the `tenant_id` derivation rule, map non-UUID legacy IDs, and add tenant-isolation tests. Then design an additive projection from `saha_state` into normalized tables with dual-read verification before switching repositories.

### Rollback and recovery

- Stop writers.
- Restore the pre-cutover database snapshot, or switch `DATA_ADAPTER=local` back to the untouched source snapshot.
- Never call `reset()`, `TRUNCATE`, `DELETE`, or a destructive Drizzle migration as rollback.
- Keep both snapshots until the owner signs off.

---

## 5. Security findings

| Finding | Severity | Status / required action |
| --- | --- | --- |
| `.env.local` and `.env.production` were not ignored at `57a694e` | Medium | Fixed on this branch by `.env.*` with `!.env.example`; no secret file was committed. |
| No credential value was requested, printed, or committed | Completed and Verified | All env checks reported presence state only; reports use placeholders only. |
| TLS certificate verification disabled | High | `postgres-store.ts` uses `rejectUnauthorized: false` for all non-`disable` modes. Setting `PGSSLMODE=verify-full` alone would not fix this; an approved code change is required before production. |
| Production can silently use local JSON | High | `store.ts` selects local JSON whenever `DATA_ADAPTER !== 'postgres'`. Add an explicit production fail-closed guard; no silent fallback. |
| RLS not implemented | High | Tenant isolation is application-level only; `saha_state` cannot use per-table RLS. Keep normalized RLS design deferred until a normalized repository exists. |
| `drizzle.config.ts` contains a localhost placeholder | Low | Safe for offline generation only; must never be used to connect to a real database. |
| REST API 401 was interpreted carefully | Completed and Verified | Treated as HTTPS reachability only, not invalid credentials. |
| No deploy or public URL | Completed and Verified | GitHub repository is source only; no Vercel/Render login, deploy, or credential overwrite occurred. |
| Credential vault master key absent | Medium | `CREDENTIAL_MASTER_KEY` must be set in the host environment only if encrypted credentials are used; never in the repository. |

No destructive operation, database reset, credential overwrite, or schema change was performed.

---

## 6. Tests performed

### Executed in this safe-connection phase

| Test | Result |
| --- | --- |
| `git rev-parse HEAD`, branch/status, remote check | `HEAD=57a694e`, clean pre-edit tree, correct remote. |
| Recovery tag and isolated branch | `recovery-57a694e` pushed; `supabase-safe-connection` active. |
| Ignore rules and tracked-file scan | Forbidden tracked files = 0 except intended `.env.example`; all secret/data patterns ignored after the branch edit. |
| Env presence check without values | All relevant variables `MISSING`. |
| DNS A/AAAA for direct DB and API hosts | Results recorded in Section 1. |
| TCP 5432 / 6543 / 443 | Results recorded in Section 1. |
| HTTPS REST status | `401`, interpreted as unauthenticated API response. |
| Local DB/TLS tooling check | `psql`, `pg_isready`, `openssl`, `docker` missing. |
| Static schema/migration artifact comparison | 21/21 table names, 58/58 index names, no DROP/ALTER, no active RLS. |
| Local JSON parse/invariant check | 36 arrays, counts, duplicate checks, UUID/E.164 checks, orphan checks; no values printed. |
| `npm.cmd run lint` | Exit `0`. |
| `npm.cmd run test` | Exit `0`; **28 test files / 135 tests passed**. |
| `npm.cmd run build` | Exit `0`. |

Evidence logs: `C:\Users\HP\AppData\Local\Temp\opencode\saha-safe-branch-tests.log` and `C:\Users\HP\AppData\Local\Temp\opencode\saha-safe-branch-gates.log`. Earlier authoritative gate evidence for the pushed commit: `C:\Users\HP\AppData\Local\Temp\opencode\saha-test-final3.log`.

### Not performed and not claimed

- No Supabase SQL query, TLS handshake, or authenticated DB round-trip.
- No migration application, constraint test, tenant-isolation test, or data import on Supabase.
- No rollback/restore drill against a real database.
- No application startup with `DATA_ADAPTER=postgres`.
- No PostgreSQL authentication, session, permission, or critical-workflow verification.
- No production deploy, public URL, or provisioner login.

---

## 7. Exact remaining owner actions

1. Set `DATABASE_URL` in the **local environment of the machine that will run the checks**. Do not paste it into chat, a file, a ticket, or CI output. I only need confirmation that it is set.
2. Confirm whether that URL points to a **disposable test database** or a separately provisioned staging database, and confirm it contains no production data at risk.
3. Confirm the database name, region, and intended direct/pooler endpoint from the Supabase dashboard or the URL's host. If the pooler is required, confirm that the host can reach it.
4. Ensure this shell/host has network egress to the chosen DB port, or provide an approved host/tool where `psql`, `pg_isready`, `openssl`, or Docker is available. The current IPv6-only DNS and failed TCP checks are network blockers, not credential proof.
5. Approve the additive baseline migration **only for the disposable/staging database** after the read-only identity check passes.
6. Approve the local-JSON snapshot import plan, including the 36-array preservation requirement and the `saha_state` no-overwrite rule.
7. Decide and approve:
   - the `tenant_id` derivation rule for normalized tables;
   - mapping for 1 non-UUID legacy user ID and 9 non-UUID legacy session IDs;
   - whether the 19 unmapped `DbState` arrays stay in `saha_state` now or require schema extensions later.
8. Approve the TLS verification fix and the production fail-closed guard before any PostgreSQL runtime is used.
9. Approve the cutover sequence and single-instance constraint for ADR-002.
10. After real-database workflow verification passes, approve any production deploy separately. No deploy is authorized by this report.
11. If encrypted credentials will be used, set `CREDENTIAL_MASTER_KEY` in the deployment host environment only; never commit it.

**Until steps 1–10 relevant to the chosen phase are completed and actually verified, the correct status remains: local JSON runtime verified; PostgreSQL connection, migration, and runtime integration not verified.**
