# Stage 2 and Stage 3 local completion record

Date: 2026-11-23. Adapter: local JSON (`DATA_ADAPTER` unset). This record describes what is actually present and executable in this repository. External-provider paths are prepared but are **not** claimed as live integrations.

## Mounted APIs

All routes are mounted in `apps/api/src/app.ts`. Provider webhook POSTs are CSRF-exempt and authenticated by HMAC. `/api/webhooks/billing` is mounted before `/api/webhooks/:provider`.

| Area | Base path | What is implemented locally |
| --- | --- | --- |
| Media/meetings | `/api/orgs/:orgId/media` | Provider status, scoped short-lived LiveKit JWT issuance when configured, meeting CRUD/lifecycle, join/leave, participant list, mic/camera/screen-share controls with single-sharer exclusivity, quota check on meeting creation. |
| Recordings | `/api/orgs/:orgId/recordings` | Recording state machine, owner/organization/meeting links, stop/retry, metered minutes, permission-protected history. Local adapter explicitly reports that it cannot capture media. |
| Google Drive | `/api/orgs/:orgId/drive` | Per-organization OAuth prepare/callback, state validation, folder selection, disconnect, and real multipart upload only when a token and a real recording byte source exist. Tokens are redacted from responses and audit logs. |
| Integration registry | `/api/orgs/:orgId/integrations` | Seven-provider registry, credential readiness, secret-redacted listing, OAuth prepare/disconnect, public-API readiness. |
| Webhooks | `/api/webhooks/:provider`, `/api/webhooks/billing` | HMAC verification, event-id idempotency, signed billing events, invoice/subscription state updates. Missing secrets produce `503 PROVIDER_NOT_CONFIGURED`. |
| Billing | `/api/orgs/:orgId/billing` | Plan catalog, trial/subscription state, cancel-at-period-end, invoices, org-scoped JSON export, usage/entitlement overview. No payment is collected locally. |
| Platform admin | `/api/admin` | Super-admin-only organization list/detail/status/plan assignment, cross-org audit log, read-only support view. Impersonation is explicitly unavailable pending owner approval. |
| Analytics | `/api/orgs/:orgId/analytics` | Workspace/room utilization, meeting minutes and daily counts, period comparisons, usage against entitlements. |
| Messaging | `/api/orgs/:orgId/messaging` | Organization/team/room channels with visibility rules, direct messages, cursor paging, per-user read receipts, audit logging. |
| Notifications | `/api/orgs/:orgId/notifications` | In-app notifications, per-recipient read receipts, unread count, delivery logs with honest `skipped` state when email/SMS providers are absent. |
| AI insights | `/api/orgs/:orgId/ai` | Deterministic local extractive summaries with phone-number redaction and tabular-row filtering; no external model or personal data leaves the instance. |
| Customization | `/api/orgs/:orgId/customization` | Per-user avatar config, validated workspace templates, template application with room quota enforcement, derived branding. |
| Teams | `/api/orgs/:orgId/teams` | Team CRUD, lead assignment, member transfer, org-scoped reads and audit logging. |

## Guest waiting room

`POST /api/access/:token/redeem` returns `202` with a `requestId` when the link requires approval. Poll `GET /api/access/:token/status?requestId=...`; approve or reject with `POST /api/orgs/:orgId/access-links/guest-requests/:id/approve|reject`. Revoking a link rejects its pending requests. Error codes include `GUEST_PENDING` and `GUEST_REJECTED`.

## Required credentials for live use

| Variable | Enables |
| --- | --- |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | Real meeting tokens, media transport, recording capture. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | Real per-organization Drive OAuth consent and upload. |
| `RECORDING_FILE_SOURCE_URL` | Supplies real recording bytes to the Drive upload adapter. |
| `INTEGRATION_WEBHOOK_SECRET`, `BILLING_WEBHOOK_SECRET`, `PUBLIC_API_SECRET` | Live signed webhook/public-api readiness. |
| `DATABASE_URL` | PostgreSQL adapter. No instance or migration was available locally. |
| SMS provider credentials | Real OTP delivery; current `devCode` is a local development aid only. |

## Verification actually executed

- `npm.cmd run lint` — passed.
- `npm.cmd test` — 28 files / 135 tests passed, including Stage 2/3, guest-room, quota and tenant-isolation tests plus team, rate-limit, finalization-guard, exception-sync, avatar, vault, plan-CRUD/annual/feature-gate and durable-attendance-job checks.
- `npm.cmd run build` — passed.
- Runtime HTTP/browser checks — landing, login, app shell, and all new pages rendered live API-backed or explicit empty/error states with no console errors after the final fixes.
- WebSocket runtime script — 10 assertions passed: ticket issuance, HTTP rejection of world-only aliases, handshake, welcome, layout/proximity groups, authoritative movement acknowledgement, occupancy and heartbeat.

## Honest limits

No LiveKit, Google Drive, payment provider, SMS provider, PostgreSQL/Supabase, staging or production credentials were available. Real audio/video/screen-share, real media capture, real Drive upload, real payments, real OTP delivery, database migrations/RLS/restore and deployment remain blocked or require owner approval. The local adapters never fabricate provider IDs or successful delivery states.
