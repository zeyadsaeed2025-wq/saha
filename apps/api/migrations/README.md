# Versioned SQL migrations

- `0000_initial_schema.sql` is a **hand-authored baseline** matching
  `apps/api/src/db/schema.ts`. It is **not applied** to any database.
- It only uses `CREATE TABLE IF NOT EXISTS` and `CREATE [UNIQUE] INDEX IF NOT EXISTS`;
  there are no DROPs or data rewrites.
- `saha_state` is included because the active `DATA_ADAPTER=postgres` Store uses
  that single JSONB compatibility row. The normalized tables are the **target
  migration path**, not active runtime code.
- Presence is intentionally absent (ADR-002: in-memory `WorldRegistry`).
- `npm.cmd run db:generate` uses `drizzle.config.ts` and writes **new** generated
  migrations plus `meta/` snapshots. It does **not** apply anything. An offline
  generation check was run into a temp folder only; no generated files were
  added here and no database was contacted.
- Applying these files requires an operator-reviewed staging database. See
  [docs/database.md](../../docs/database.md) and
  [docs/operations/runbook.md](../../docs/operations/runbook.md).
