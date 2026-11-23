# Operations runbook

**Status:** this is operator guidance, **not** a record of a deployment. No PostgreSQL instance, migration application, restore drill or production rollout was performed. The local adapter is the runtime-tested path; the Postgres JSONB adapter and normalized schema are **Implemented but Not Runtime-Verified**.

## Health and smoke checks

```powershell
curl http://localhost:4000/api/health
# { "status": "ok", "service": "saha-api", "time": "...", "dataAdapter": "local-json", "databaseUrlConfigured": false }
```

- `dataAdapter` is `local-json`, `memory` or `postgres` from `Store.kind`; `databaseUrlConfigured` only reports that the env var is set.
- A `postgres` value does **not** prove a database round-trip. Startup calls `initializeStore()` before listening; check logs for `[saha] data adapter: postgres` and add a real `SELECT 1` probe (**Not Implemented**).
- Sign-in, org selection, one schedule generation and one attendance event are the minimal functional smoke test.

## Local development

```powershell
cd D:\virtual-office-saas
npm.cmd install
npm.cmd approve-scripts --allow-scripts-pending   # only if esbuild scripts were blocked
Copy-Item .env.example .env                       # never commit .env
npm.cmd run lint
npm.cmd test
npm.cmd run dev                                   # API 4000, Vite 5173
```

- Keep `DATA_ADAPTER=local`, `ALLOW_DEMO_SEED=false` unless isolating demo data.
- Never point `LOCAL_DATA_FILE` at a production path; `store.reset()` is only for tests/local use.
- Run **one** API/world process (ADR-002). Presence is in memory and is not restored.
- Offline Drizzle check: `npm.cmd run db:generate` (generates SQL/snapshots only; **do not** point it at a real DB or run `migrate` in this phase).

## Staging / production separation

| Concern | Requirement |
| --- | --- |
| Secrets | Separate secret store per environment; inject `DATABASE_URL`, `SESSION_SECRET` at runtime. No credentials in `.env.example`, repo or logs. |
| Data | Separate databases and data files. Never copy production data into dev; never seed demo data in prod. |
| Config | `NODE_ENV=production`, `COOKIE_SECURE=true`, `APP_URL`/`CORS_ORIGINS` limited to real origins (current code still reads `APP_URL` for CORS), `ALLOW_DEMO_SEED=false`, `PGSSLMODE` reviewed for trusted CA. |
| Network | HTTPS terminated at proxy; forward `/api` and `/ws` upgrade headers; block `/api/demo/seed` at the proxy. |
| Scale | One world process; scale vertically until a shared presence adapter exists. |
| Changes | Apply reviewed migrations in staging first; record approver, version, timestamp and backup ID. |

## Backups

**Local JSON:** stop or quiesce writes, then copy `LOCAL_DATA_FILE` plus the schema/config version.

```powershell
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
Copy-Item .\[data]\store.json ".\backups\store-$stamp.json"
Get-Content ".\backups\store-$stamp.json" | ConvertFrom-Json | Out-Null  # syntax check
```

**Postgres (when the adapter is used):** back up the whole cluster/database, including `saha_state`, `audit_logs` and any normalized tables that have been applied. Do not inline credentials.

```powershell
# DATABASE_URL comes from the environment/secret store, never from source control.
pg_dump --format=custom --file=".\backups\saha-$stamp.dump" "$env:DATABASE_URL"
```

- Schedule daily backups, retain at least 30 days, encrypt at rest and keep an offsite copy.
- Include object storage separately when implemented (**Explicitly Deferred**).
- Verify backups are non-empty and record the checksum; an untested backup is not a recovery plan.

## Restore drill (disposable target only)

Local: stop the process, move the current file aside, restore the snapshot, validate JSON, restart, then smoke test. Postgres: use a fresh disposable database, `pg_restore --dbname="$env:DATABASE_URL" ".\backups\saha-$stamp.dump"`, then run integrity queries. Never restore over a live database without written approval and a fresh pre-restore backup.

No restore was executed in this repository phase (**Implemented but Not Runtime-Verified** as guidance only).

## Monitoring hooks (Not Implemented unless wired externally)

- HTTP `/api/health` status, latency and `dataAdapter`; alert on non-200 or unexpected adapter.
- Process uptime/restarts, one-instance invariant, memory and disk free space.
- Postgres: connection pool usage, lock waits on `saha_state`, `updated_at` freshness, replication lag, backup success.
- Domain: attendance event ingestion rate/lag, finalize backlog, audit-log write failures, token redemption failures, WS connect/reject counts.
- Log warnings such as `INSECURE: SESSION_SECRET is missing or too short` must page an operator.
- Central log shipping, metrics exporters and alert routing are **Not Implemented**.

## Incident response

1. **Classify:** severity, affected tenants, start time, possible data exposure.
2. **Contain:** set `ALLOW_DEMO_SEED=false`, block offending route/IP at proxy, revoke sessions if credential compromise is suspected, stop writes if state is inconsistent. Keep the instance count at one.
3. **Preserve:** copy the local data file or `pg_dump` the database, capture logs and the deployed version; do not overwrite evidence.
4. **Diagnose:** correlate audit logs, attendance changes and HTTP/WS logs; check backups and recent config changes.
5. **Recover:** restore into a disposable target first, verify, then apply an approved recovery to production. Prefer point-in-time restore over hand-editing `saha_state`.
6. **Communicate:** notify affected tenants per policy; record tenant IDs, actions and approvers.
7. **Learn:** postmortem with timeline, root cause, detection gap and follow-up owner.

## CI checklist

- [ ] `npm.cmd run lint` — clean.
- [ ] `npm.cmd test` — clean; note local-adapter coverage only.
- [ ] `npm.cmd run build` — clean.
- [ ] No source under `apps/api/src/**` or `apps/web/src/**` was changed by an ops-only change.
- [ ] SQL reviewed for `IF NOT EXISTS`, no DROPs/rewrites, indexes and FKs match `schema.ts`.
- [ ] `npm.cmd run db:generate` is **not** run against a real DB; generated artifacts are reviewed, not auto-applied.
- [ ] No real credentials, tokens, tenant data or `devCode` output in logs/artifacts.
- [ ] Docs status labels match reality; no claim of a migration, deployment or runtime verification that did not occur.
