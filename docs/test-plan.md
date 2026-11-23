# Test plan

## Layers

| Layer | What is exercised | Where |
| --- | --- | --- |
| Pure domain/unit | Attendance calculation (grace, lateness, heartbeat timeout, reconnect, breaks, absence, duplicate IDs), phone normalization, scrypt hashing, RBAC matrix/role ranks, world movement validation and connection authorization. | `apps/api/src/tests/{attendance,security,world}.test.ts` |
| Adapter unit | Local store rollback on thrown mutation, serialization of concurrent mutations, `reset()`; uses `createStore(null)` (in-memory). | `apps/api/src/tests/store.test.ts` |
| API integration | Real Express app (`createApp()`), real HTTP on an ephemeral localhost port, a minimal cookie jar, temp JSON data file. Covers registration/login, cookies + CSRF, org creation, members/RBAC, cross-org denial, invitations, access links, guest redemption, schedules/attendance/reports as tests land. | `apps/api/src/tests/api.test.ts` |
| Web component | React components with Testing Library + jsdom (per-file `// @vitest-environment jsdom`), mocked auth/api providers, EN/AR and RTL behavior. | `apps/web/src/**/*.test.tsx` plus `apps/web/src/test-utils.tsx` |

Vitest is configured with `globals: true`, default environment `node`, and includes `apps/**/*.test.ts` / `.test.tsx`; setup imports `@testing-library/jest-dom/vitest`. Component tests opt into jsdom with a file-level docblock.

## Local adapter vs PostgreSQL

- All current tests run against the **local JSON adapter or `createStore(null)`**. The integration suite sets `LOCAL_DATA_FILE` to a temp path, removes `DATA_ADAPTER`, and resets the store between tests. It does not connect to PostgreSQL.
- No test verifies Drizzle schemas, SQL migrations, row locking, database constraints or cross-process transactions. The schema/migrations now exist but are **Implemented but Not Runtime-Verified** and are not applied. See [database.md](database.md).
- Add integration tests for: tenant isolation at repository level, atomic token/link use counters, concurrent schedule generation, transaction rollback against `saha_state`, and parity of attendance recalculation after reload through the real Postgres adapter.

## Commands and environment

```powershell
cd D:\virtual-office-saas
npm.cmd install
npm.cmd approve-scripts --allow-scripts-pending   # only if esbuild scripts were blocked

npm.cmd test          # single Vitest run
npm.cmd run test:watch
npm.cmd run lint      # tsc --noEmit for API and web
npm.cmd run build     # tsc API build + Vite web build
```

Requirements: Node.js new enough for `structuredClone` and top-level await (Node 20+ recommended), npm modules installed. No PostgreSQL, `psql`, Docker or SMS provider is needed for the current suite. Use `npm.cmd` in PowerShell because `npm.ps1` may be blocked.

## Verification status

At the time of writing, `npm.cmd run lint`, `npm.cmd run build` and `npm.cmd test` all passed. The last `npm.cmd test` run reported **28 test files passed (28)** and **135 tests passed (135)** (log: `saha-test-final3.log`). The build completed without a Vite chunk-size warning. Web component tests emitted non-failing React Router v7 future-flag warnings. Browser/CDP runs and a temporary WebSocket runtime script also passed for office rendering, responsive/localization, room routing, movement, presence, permissions and reconnect; permanent runtime tests now exist in `apps/api/src/tests/world-connect-entitlement.test.ts`, plus `billing-admin.test.ts`, `attendance-jobs.test.ts`, `vault.test.ts` and the appearance tests. These results apply only to the local adapter/in-memory paths described above; no PostgreSQL, SMS provider or deployment was exercised.

## Coverage gaps / future work

- Permanent WebSocket entitlement/quota and appearance tests exist (`world-connect-entitlement.test.ts`, `world-entitlement.test.ts`, `avatar-appearance.test.ts`). Remaining gaps: full multi-client heartbeat→attendance E2E, load tests, and browser E2E registration → org → invitation → office flows.
- Browser E2E flows (register â†’ org â†’ invite â†’ office) and load testing of the world server.
- Reverse-proxy/cookie/HTTPS behavior, CSP and rate limiting.
- Postgres adapter/migration tests and operator rollback drills.
- Deferred integrations (SMS, LiveKit, Drive) have no tests because they are not implemented.
