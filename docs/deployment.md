# Deployment layout (prepared, not yet deployed)

Status: **Partially Implemented** — Vercel config and cross-origin settings are prepared locally. Nothing has been published, no Vercel project exists yet, and no Node host or managed database has been provisioned.

## Target architecture

| Layer | Host | Runtime note |
| --- | --- | --- |
| Web (`apps/web`) | Vercel static site | `vercel.json` builds `npm run build:web` and serves `dist/web` with an SPA rewrite. |
| API + WebSocket (`apps/api`) | Single Node host (e.g. Railway/Render/Fly.io) | Long-lived `ws` server, in-memory presence (`WorldRegistry`) and in-memory rate limiters require **one** instance (ADR-002). |
| State | Managed PostgreSQL | `DATA_ADAPTER=postgres` uses one `saha_state` JSONB row with `SELECT ... FOR UPDATE`. Runtime-unverified; must be exercised on a disposable staging database first. |

Vercel Serverless alone cannot run the current API: it has no persistent filesystem, no long-lived WebSocket, and would split the in-memory presence/rate-limit state across invocations.

## Required environment variables

On Vercel (build-time for Vite):

- `VITE_API_URL` — API origin, e.g. `https://saha-api.up.railway.app` (no trailing slash). Empty keeps same-origin relative paths for local dev.
- `VITE_WS_URL` — WS origin, e.g. `wss://saha-api.up.railway.app`. Empty derives it from `location.host`.

On the Node host:

- `PORT` — default `4000`.
- `APP_URL` — comma-separated browser origins; must include the exact Vercel domain. Drives CORS `Access-Control-Allow-Origin` with credentials.
- `COOKIE_SAMESITE=none` and `COOKIE_SECURE=true` — required because the Vercel domain and API domain are different sites. Browsers reject `SameSite=None` without `Secure`. Local development keeps the defaults `lax` / `false`.
- `DATA_ADAPTER=postgres` and `DATABASE_URL` — managed Postgres connection string. `PGSSLMODE` and `PG_POOL_MAX` are optional.
- `CREDENTIAL_MASTER_KEY` — **required in production**. A 64-character hex key or a long passphrase used to derive an AES-256-GCM key for the credential vault. Without it, any vault operation fails closed; development uses a loudly warned deterministic fallback only.
- `CREDENTIAL_KEY_VERSION` — integer version stamped on every sealed record (default `1`).
- `CREDENTIAL_MASTER_KEY_PREVIOUS` — set only while re-sealing records after a key change with `POST /api/admin/credentials/rotate-key`; unset it afterwards.

The three credential cookies remain split: `saha_session` (HttpOnly), `saha_csrf` (readable by the client for double-submit), and the short-lived WebSocket ticket. Only their transport attributes change; no secret is exposed to JavaScript.

## Steps before publishing

1. Run `npm.cmd run lint`, `npm.cmd test`, `npm.cmd run build` after any environment change.
2. Provision a **disposable staging** Postgres database. Apply `apps/api/migrations/0000_initial_schema.sql` (additive only) with an approved tool, then run the API with `DATA_ADAPTER=postgres` and verify health, auth, tenant isolation and concurrency against it. No migration or restore drill has been executed yet.
3. Provision the single Node instance, set the API variables above, and confirm `/api/health` reports `dataAdapter: postgres`.
4. Log in with `npx vercel login`, then create a new project and set the two `VITE_*` variables before the first build.
5. Deploy the web app with `npx vercel --prod` from the repository root once the API URL is reachable over HTTPS/WSS.

## Not covered by this preparation

- LiveKit, Google OAuth/Drive, SMS, payment provider credentials and real media capture remain external blockers.
- The owner supplied the GitHub destination `https://github.com/zeyadsaeed2025-wq/saha.git` and Supabase project `wyjnopgbdszzkehxside`. The Supabase dashboard URL is not a connection string: `DATABASE_URL` with the database password and network access to the project's Postgres port are still required. No Vercel project, Render/Node host, database round-trip or deployment was executed.
- In-memory rate limiting and presence are correct only while the API runs as a single instance.
- This document does **not** authorize provisioning or activating paid services; those require explicit owner approval.

## GitHub Pages (static UI only)

`.github/workflows/deploy-pages.yml` builds `apps/web` with `--base=/<repo-name>/` and publishes `dist/web` to GitHub Pages on every push to `supabase-safe-connection`. It also copies `index.html` to `404.html` so React Router deep links resolve.

GitHub Pages serves static files only. It **cannot** run the Express API, the WebSocket world server, the local JSON store, or PostgreSQL. With no `VITE_API_URL` / `VITE_WS_URL`, the published UI calls `/api/...` and `/ws/...` on the Pages origin and those requests fail. Login, organizations, attendance, reports and the 2D office remain unavailable until a separate Node host is deployed and those two build-time variables point to it.

To activate: in repository **Settings → Pages**, set **Source** to **GitHub Actions**. The workflow needs no secrets. Publishing the static UI is not a production cutover and does not authorize database migration or adapter activation.
