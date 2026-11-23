# Database: adapters, target schema and migration path

Status labels used below: **Implemented and Verified**, **Implemented but Not Runtime-Verified**, **Partially Implemented**, **Not Implemented**, **Explicitly Deferred**. "Verified" means checks that actually ran in a repository phase; no PostgreSQL instance, credentials, docker or production deployment were available here.

## Status summary

| Area | Status | Limit / evidence |
| --- | --- | --- |
| Local JSON `Store` (default) | Implemented and Verified | Serialized in-process mutations with atomic temp-file rename; covered by the existing local test suite (not re-run in this phase). |
| `pg`-backed transactional JSONB `Store` | Implemented but Not Runtime-Verified | `apps/api/src/common/postgres-store.ts` uses `saha_state` and `SELECT ... FOR UPDATE`; no database was available to execute it. |
| Normalized Drizzle schema | Implemented but Not Runtime-Verified | `apps/api/src/db/schema.ts`; type-checks with installed `drizzle-orm` 0.44.x. No repository reads these tables. |
| Versioned baseline SQL | Implemented but Not Runtime-Verified | `apps/api/migrations/0000_initial_schema.sql`; additive only; **not applied**. |
| `drizzle.config.ts` + `db:generate` | Partially Implemented | Config/script exist; offline generation was validated into a **temp folder only** (no DB connection, no repo artifacts); no migration was pushed. |
| Normalized repository queries, per-row SQL transactions | Not Implemented | Runtime still uses the whole-state `Store` interface. |
| Row-level security policies | Not Implemented | Design only; no `ENABLE ROW LEVEL SECURITY` in the applied path. |
| Media bytes / Google Drive storage | Explicitly Deferred | `file_assets` stores metadata only; no provider integration. |

## Current runtime behavior

| Setting | Actual behavior |
| --- | --- |
| `DATA_ADAPTER=local` (default) | `LOCAL_DATA_FILE ?? './data/store.json'`: JSON-file persistence, serialized drafts, atomic rename. One Node process only. |
| `DATA_ADAPTER=postgres` | `initializeStore()` creates a real `pg` Pool from `DATABASE_URL`, ensures one `saha_state` JSONB row and runs each `mutate()` inside a transaction with `SELECT ... FOR UPDATE`. `read()` serves the last committed snapshot cached in this process. `reset()` is disabled; `close()` ends the pool. |

`PGSSLMODE=disable` disables TLS for local development; any other value currently enables TLS with `rejectUnauthorized: false` (review for production). `PG_POOL_MAX` defaults to 5. `DATABASE_URL` is required for `DATA_ADAPTER=postgres`.

Presence stays in **memory** per ADR-002 (`WorldRegistry`); it is not in either adapter or in the normalized schema. Multiple API/world instances would fragment presence even with Postgres.

## Target normalized schema (not active runtime code)

Defined in `apps/api/src/db/schema.ts` and mirrored by `apps/api/migrations/0000_initial_schema.sql`:

- **Identity / tenancy:** `organizations`, `users`, `teams`, `memberships`, `auth_sessions`, `otps`, `guest_admissions`.
- **Collaboration / tokens:** `workspaces`, `rooms`, `invitations`, `access_links`.
- **Scheduling:** `schedule_rules`, `scheduled_sessions`.
- **Attendance evidence:** `attendance_sessions`, `attendance_events`, `breaks`, `attendance_changes`.
- **Platform:** `audit_logs`, `notifications`, `file_assets`.
- **Compatibility:** `saha_state` (the row used by the active JSONB adapter).

Every tenant-scoped table has `tenant_id`; org-scoped rows also keep `organization_id` so existing `findInOrg` semantics remain expressible. Repositories must enforce `tenant_id = organization_id` (and filter by both) until a database-level RLS policy is enabled. Timestamps are `timestamptz`, JSON documents are `jsonb`, IDs are UUIDs except `saha_state.id` (TEXT), and the app continues to convert timestamps to ISO strings at its boundary.

Unique indexes protect phone numbers, org slugs, membership pairs, token hashes, schedule materialization (`schedule_rule_id, starts_at`) and attendance sessions (`scheduled_session_id, user_id`). Indexes cover the common tenant/date/actor lookups.

## Migration / operator path (not executed)

1. Provision a disposable staging PostgreSQL 13+ database. Supply `DATABASE_URL` from the environment — never commit it.
2. Review `apps/api/migrations/0000_initial_schema.sql`. It is additive: `CREATE TABLE IF NOT EXISTS` and `CREATE [UNIQUE] INDEX IF NOT EXISTS` only; no DROPs or data rewrites.
3. Apply with an approved tool (for example `psql "$DATABASE_URL" -f apps/api/migrations/0000_initial_schema.sql`). `npm.cmd run db:generate` creates **new** Drizzle-generated files; it does not apply this baseline.
4. Add transaction/tenant-isolation/concurrent-token tests before changing `DATA_ADAPTER` defaults or writing data through these tables.
5. Back up before and after; see [operations/runbook.md](operations/runbook.md).

**Steps 1–5 were not performed here.** An offline `drizzle-kit generate` check wrote only to a temp folder and made no database connection. The baseline is reviewed as text and type-checked through the schema, not runtime-verified.

## RLS design (Not Implemented)

Plan: enable row-level security on every `tenant_id`-bearing table, with a policy using a transaction-local setting:

```sql
-- DESIGN ONLY — not in the applied migration.
ALTER TABLE attendance_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON attendance_sessions
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
```

A future normalized repository must set `app.tenant_id` per request inside its SQL transaction (`SET LOCAL`) and fail closed when the setting is absent. The migration/backup role bypasses RLS or uses `FORCE ROW LEVEL SECURITY` where appropriate. The current JSONB compatibility row cannot be protected by per-table RLS; tenant checks remain in `requireOrg`/`findInOrg` until a normalized repository exists.

## Storage design (Explicitly Deferred)

`file_assets` holds **metadata only**: tenant, object key, provider, MIME type, size, checksum, status. Bytes belong in tenant-prefixed object storage (for example `tenants/<tenant_id>/...`), accessed through short-lived scoped URLs; never in Postgres JSONB or the local data file. No upload pipeline, Drive OAuth, media service or signed-URL implementation exists. See [deferred-register.md](deferred-register.md).

## Verification gaps

- No PostgreSQL connection, migration application, rollback drill or `pg_dump` restore was performed.
- No SQL integration tests for tenant isolation, concurrent invitation/link redemption or schedule materialization.
- `dataAdapter:'postgres'` in `/api/health` reflects configuration, not a proven database round-trip.
