# Supabase PostgreSQL — READ-ONLY audit report

Generated: 2026-11-24  
Branch: `supabase-safe-connection`  
Base commit: `15df3408bf5f4c74761c7bfb83a65c67292cda83`  
Intended Supabase project reference supplied by owner: `wyjnopgbdszzkehxside`  
Report status: **Blocked by External Dependency** — the intended database was **not reached**.

**Explicit write-operation statement:** No database write operation occurred. No `CREATE`, `ALTER`, `DROP`, `TRUNCATE`, `INSERT`, `UPDATE`, `DELETE`, `GRANT`, `REVOKE`, migration, seed, RLS change, permission change, adapter activation, or deploy was executed. No database connection was made at all. All work was local file/code inspection.

This report contains no credential values, no URL, no password, no token, and no private record contents. Only counts, field names, code paths, and static findings are recorded.

---

## 1. Connection verification result

| Check | Result | Non-sensitive detail |
| --- | --- | --- |
| `DATABASE_URL` in Process/User/Machine | **MISSING** | Presence-only check; no value was read or printed. |
| Other DB/Supabase env vars | **MISSING** | `PGSSLMODE`, `PG_POOL_MAX`, `SUPABASE_URL`, `SUPABASE_DB_PASSWORD`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ACCESS_TOKEN`, `CREDENTIAL_MASTER_KEY`. |
| Local secret file | Not present | Only tracked `.env.example` exists; no `.env` or `.env.local` to load. |
| Node PostgreSQL client | Available | `pg` 8.23.1 was found in repository `node_modules`; it was **not used** to connect. |
| `psql` / `pg_isready` / `openssl` / Docker | Missing | No native DB/TLS tooling available. |
| Strict read-only probe | Prepared, not executed | Syntax checked; aborted immediately with `DATABASE_URL_MISSING` (exit 2) before any connection. |
| Endpoint project verification | Not performed | Preflight logic exists but needs `DATABASE_URL`; only the intended project reference is reported here. |
| Connection attempt | **None** | No TCP connection, TLS handshake, login, or SQL statement was sent. |
| Read-only enforcement verified | **No** | Cannot be verified until a connection exists. |
| PostgreSQL operational for app | **No** | Still unverified. |

### Exact non-sensitive cause of stop

`DATABASE_URL` is not configured in the local process environment, and no approved local secret file exists. Per the directive, the audit stopped rather than inventing a successful connection.

### Strict read-only method established (not executed)

A probe was prepared outside the repository at an approved temporary path. Its safeguards are:

1. Reads `DATABASE_URL` from the local process environment only; never prints it.
2. Parses the URL and verifies that the host or user maps to `wyjnopgbdszzkehxside`, printing only booleans such as `PROJECT_ENDPOINT_MATCH` and `ENDPOINT_CLASS`.
3. Refuses URLs with `sslmode=disable`.
4. Forces TLS with certificate verification (`rejectUnauthorized: true`) and SNI; no weakened TLS is used to make a connection succeed.
5. Opens `BEGIN READ ONLY` and verifies `SHOW transaction_read_only = on` before any catalog query.
6. Allows only a fixed allowlist of `SELECT`/`SHOW` statements against safe catalogs/views; any write token or non-`SELECT` statement is rejected before being sent.
7. Uses `ROLLBACK`, never `COMMIT`.
8. Sanitizes the project reference, endpoint, and user from all output.

If read-only enforcement cannot be verified, the probe aborts. It did not reach that stage because the URL is missing.

---

## 2. Database identity, sanitized

| Item | Result |
| --- | --- |
| Intended project reference | `wyjnopgbdszzkehxside` (owner-supplied; not independently verified) |
| Endpoint class | Unknown — direct/pooler not inspected |
| Sanitized host/port/user | Not reported — no URL available |
| `current_database()` | Not queried |
| `current_user` | Not queried |
| `version()` / `server_version_num` | Not queried |
| Schema names | Not queried |
| Region | Not queried |
| Environment (disposable/staging/production) | Not confirmed |
| Existing data on target | Not inspected |
| Migration history on target | Not inspected |

The project reference is an identifier supplied by the owner, not proof of the exact target database. No claim is made that the intended Supabase database was reached.

---

## 3. Schema comparison

### 3.1 Expected vs actual tables

The "actual" column cannot be filled because no database query ran. The existing static claim of **21 tables / 58 indexes** is **not verified against the target database**.

| # | Expected table from `schema.ts` / `0000_initial_schema.sql` | Actual table | Status |
| --- | --- | --- | --- |
| 1 | `saha_state` | NOT INSPECTED | Blocked by External Dependency |
| 2 | `organizations` | NOT INSPECTED | Blocked by External Dependency |
| 3 | `users` | NOT INSPECTED | Blocked by External Dependency |
| 4 | `teams` | NOT INSPECTED | Blocked by External Dependency |
| 5 | `memberships` | NOT INSPECTED | Blocked by External Dependency |
| 6 | `workspaces` | NOT INSPECTED | Blocked by External Dependency |
| 7 | `rooms` | NOT INSPECTED | Blocked by External Dependency |
| 8 | `invitations` | NOT INSPECTED | Blocked by External Dependency |
| 9 | `access_links` | NOT INSPECTED | Blocked by External Dependency |
| 10 | `auth_sessions` | NOT INSPECTED | Blocked by External Dependency |
| 11 | `guest_admissions` | NOT INSPECTED | Blocked by External Dependency |
| 12 | `otps` | NOT INSPECTED | Blocked by External Dependency |
| 13 | `schedule_rules` | NOT INSPECTED | Blocked by External Dependency |
| 14 | `scheduled_sessions` | NOT INSPECTED | Blocked by External Dependency |
| 15 | `attendance_sessions` | NOT INSPECTED | Blocked by External Dependency |
| 16 | `attendance_events` | NOT INSPECTED | Blocked by External Dependency |
| 17 | `breaks` | NOT INSPECTED | Blocked by External Dependency |
| 18 | `attendance_changes` | NOT INSPECTED | Blocked by External Dependency |
| 19 | `audit_logs` | NOT INSPECTED | Blocked by External Dependency |
| 20 | `notifications` | NOT INSPECTED | Blocked by External Dependency |
| 21 | `file_assets` | NOT INSPECTED | Blocked by External Dependency |

- Missing tables: cannot determine.
- Unexpected tables: cannot determine.
- Existing indexes/constraints: cannot determine.
- Existing migration history: cannot determine.
- Static expectation: 58 named indexes/unique indexes; **not verified**.

The additive SQL uses `CREATE TABLE IF NOT EXISTS` and `CREATE [UNIQUE] INDEX IF NOT EXISTS`. If an object with the same name already exists but a different definition, the statement can silently skip it. Live catalog comparison is mandatory before any migration.

### 3.2 Static runtime-schema differences found without the database

These differences are in the application artifacts themselves and do **not** require a live DB to identify.

| Area | Finding |
| --- | --- |
| Tenant key | Runtime records use `organizationId`; normalized tables require `tenant_id` on many rows. No runtime record in the local snapshot carries `tenantId`. |
| `organizations` | Runtime interface has no `tenantId`; normalized table requires `tenant_id NOT NULL UNIQUE`. |
| `auth_sessions` | Runtime has `guestLinkId`, `worldOnly`, `csrfHash`, `wsTicketHash`, `wsTicketExpiresAt`; normalized `auth_sessions` has none of these. |
| `teams` | Runtime has `leadUserId`; normalized `teams` does not. |
| `access_links` | Runtime has optional `requiresApproval`; normalized table does not. |
| Timestamps | Several runtime records omit `createdAt`/`updatedAt` that normalized tables supply via defaults. |
| `saha_state` | Active runtime path; normalized tables are unused by repositories. |
| RLS | No active `ENABLE ROW LEVEL SECURITY` or policy in baseline SQL. |
| UUIDs | One privileged user ID is non-UUID; all session IDs themselves are UUIDs. |
| Foreign keys | Static baseline has FKs, but live FK compatibility and existing data orphans cannot be checked. |
| Extensions | `gen_random_uuid()` needs PostgreSQL 13+ or `pgcrypto`; server version unknown. |

---

## 4. Tenant ownership analysis

### 4.1 Ownership model established from code

- The application uses its own phone+password authentication with hashed bearer tokens in `auth_sessions`; it does **not** use Supabase Auth.
- Organization scope is passed as `orgId` from route params or `x-organization-id` and validated by `requireOrg` against active memberships, guest scope, or the hardcoded super-admin identity.
- Most tenant-owned collections use `organizationId`. Platform/global collections either have no organization owner or allow `organizationId = null`.
- No automatic `tenant_id` assignment is proposed. Mapping must be explicit and validated.

Detailed per-collection ownership, proposed `tenant_id` source, and design are in Section 6.

### 4.2 Cross-organization query and access-control risks

Static audit only; no runtime or database behavior is claimed.

**Ownership primitives found in code**

- `User` has no `organizationId`; membership is the only user↔organization relation (`domain/types.ts:17-25`, `42-50`).
- `AuthSession` carries `activeOrgId`, `guestOrgId`, `guestWorkspaceId`, `guestRoomId`, `guestLinkId`, `worldOnly`, etc.; it is contextual, not strictly tenant-owned (`domain/types.ts:52-69`).
- Most domain rows have `organizationId`; `auditLogs`, `credentials`, and `jobRuns` explicitly allow `null` (`domain/types.ts:228-236`, `459-481`, `508-518`).
- `inOrg` / `findInOrg` require `organizationId: string` and cannot cover nullable-org collections (`common/store.ts:82-88`).
- There is no SQL/RLS predicate in the active runtime path; all isolation is application-level inside `store.read` / `store.mutate` callbacks.

**R1 — High: platform-admin grant from any active `super_admin` membership on unscoped routers.**  
`modules/admin/routes.ts:18-30` and `modules/credentials/routes.ts:30-38,108-110` grant platform-admin authority if the hardcoded ID is present **or** any active membership anywhere has role `super_admin`; these routers are mounted without org scope (`app.ts:97,106-107`). This unlocks cross-org org listing/details/status changes, plan changes, global audit queries, and platform credentials. If such a membership exists, it is a cross-org privilege escalation path.

**R2 — Medium-High: guest sessions/world credentials not revoked on org suspension.**  
`modules/admin/routes.ts:228-237` revokes only sessions where `activeOrgId === orgId`, but guest sessions are issued with `guestOrgId` (`modules/invitations/routes.ts:378-386`, `modules/auth/routes.ts:72-105`). The socket handshake does not check `organization.status` (`modules/world/socket.ts:44-60`, `modules/world/logic.ts:104-115`). Guest scope is limited to `world:connect` (`common/security.ts:162`), which limits blast radius but does not close the control gap.

**R3 — Medium-High: bearer-token-only access-link redemption can issue a full member session.**  
`modules/invitations/routes.ts:308-371`, especially `391-392`, calls `issueSession(...)` for `subjectUserId` without authenticating the redeemer. Token holders also receive org/workspace/room metadata (`284-305`), and guest-request status accepts an arbitrary `requestId` when `request.linkId === link.id` (`266-282`).

**R4 — Medium: invitation acceptance has weak identity binding.**  
`modules/invitations/routes.ts:82-106` finds invitations by global `tokenHash`; phone is checked only if `invitation.phone` is set, and phone/email are nullable (`domain/types.ts:81-95`). The route uses `requireAuth` but not `requireOrg`; any signed-in user with the token can create membership in the invitation’s org. Org status is not checked.

**R5 — Medium: `requireFeature` trusts caller-supplied org id and middleware ordering.**  
`common/middleware.ts:102-115` reads `req.params.orgId ?? req.header('x-organization-id')` and calls `hasFeature` without its own membership check. Current callers mount `requireOrg` first, so this is defense-in-depth rather than a demonstrated bypass.

**R6 — Medium: global token/credential lookups without secondary org predicates.**  
Invitation and access-link lookups use only `tokenHash` (`modules/invitations/routes.ts:85-104`, `269-290`); workspace/room and guest-request follow-ups are by id/linkId without asserting their `organizationId` matches the token-bearing record (`289-290`, `271-273`, `325`). HTTP and socket session lookups are also global before org validation (`common/middleware.ts:38-49`, `common/security.ts:44-51`). High-entropy tokens reduce exploitability, but inconsistent migrated data would make these static cross-collection searches unsafe.

**R7 — Medium: presence registry keyed by `userId` only.**  
`modules/world/registry.ts:26-44,50-54`, `modules/world/socket.ts:103,199,228,235,258`. Since users are global and may belong to multiple orgs, concurrent sockets in two orgs overwrite the same presence entry; one disconnect can remove the other org’s presence. `concurrentUsers` quotas derive from this registry (`modules/billing/entitlements.ts:60-63`).

**R8 — Low/Medium: webhook idempotency keys are global, not tenant-qualified.**  
`modules/integrations/routes.ts:234-246` dedupes by provider+eventId; `modules/billing/webhooks.ts:84-107` dedupes by provider+eventId. Cross-org event-id collisions could suppress another org’s event. HMAC authentication limits exploitability.

**R9 — Low: nested room/workspace lookups often omit `room.organizationId`.**  
`modules/workspaces/routes.ts:17,25,59-60`, `modules/world/routes.ts:21,42`, `modules/world/socket.ts:51,66`. Parent workspaces are usually org-scoped, but a mismatched `room.workspaceId` could disclose a foreign room name/layout before movement validation (`modules/world/logic.ts:33-35`).

**R10 — Low: predictable synthetic guest identity.**  
`modules/invitations/routes.ts:350-355` creates `guest-${linkId.slice(0,8)}` and `+guest${prefix}`. Two links sharing an 8-character prefix would reuse one global user row, potentially rendering one org’s guest name in another (`modules/world/routes.ts:40`).

**R11 — Low: login selects first active membership by array order.**  
`modules/auth/routes.ts:144-146` sets `activeOrgId` from the first active membership, not an explicit user choice. `requireOrg` still validates requested org membership, so this is context confusion rather than a bypass.

**R12 — Low: unscoped-by-id session/link lookups rely on authenticated context or UUID uniqueness.**  
`modules/auth/routes.ts:153,295,341`, `modules/organizations/routes.ts:53`, `modules/invitations/routes.ts:100,203-223`. Link revocation by `guestLinkId`/`linkId` lacks an org predicate but relies on globally unique UUIDs.

**R13 — Intentional global/platform reads requiring classification, not vulnerabilities by themselves.**  
Plans catalog and admin plan management (`modules/billing/routes.ts:58-64`, `modules/admin/routes.ts:88-167`), global plan-in-use checks (`155-157`), platform credential rotation (`modules/credentials/routes.ts:153-174`), cross-org attendance finalization (`modules/attendance/jobs.ts:81-110`), global super-admin audit queries (`modules/admin/routes.ts:296-308`), and provider-driven payment ingest with possibly empty org (`modules/billing/webhooks.ts:71,97-107`). These must remain explicitly platform-scoped in any tenant mapping.

**Guest/world-only session notes**

- `worldOnly: true` is persisted on synthetic `authSessions` aliases and filtered from HTTP auth (`common/middleware.ts:41-43`, `common/security.ts:72-92`); the in-memory alias map is empty after restart, so the persisted marker is important.
- The socket accepts any unrevoked, unexpired `tokenHash`, then checks membership/guest role, workspace org, guest org/workspace/room, room role/capacity, and plan quota (`common/security.ts:44-51`, `modules/world/socket.ts:44-103`).
- Link revocation uses persisted `guestLinkId` (`modules/invitations/routes.ts:203-225,379-386`) as the durable path after restart.
- No invitation-accept or link-redeem route checks `organization.status === 'active'`.

### 4.3 Required validation before migration

1. **Ownership completeness:** assert every org-owned record has a non-null `organizationId` resolving to an existing organization. Allow `null` only for documented global collections: `users`, `authSessions` context, `otps`, `plans`, `auditLogs`, `credentials`, `jobRuns`, `paymentEvents`, and token-only redemption records.
2. **Parent-child org agreement:** verify `room.organizationId === workspace.organizationId`, scheduled-session/rule/workspace agreement, attendance-event/change agreement with attendance sessions, meeting-derived rows with meetings, guest requests with access links, channel scope inside the channel org, notification recipients with active membership, and usage records with the metered org.
3. **Session invariants:** member sessions must have `activeOrgId` null or an active org with active membership; guest sessions must have consistent `guestOrgId`, `guestWorkspaceId`, `guestRoomId`, and `guestLinkId`; `worldOnly` aliases must never pass HTTP auth; suspended orgs must have no live member or guest world sessions.
4. **Token secondary lookups:** assert global uniqueness of invitation/link token hashes and verify every token-derived workspace/room/guest-request row has the same `organizationId` as the token-bearing record.
5. **Guest identity uniqueness:** assert each `guest-${linkId.slice(0,8)}` id and `+guest${prefix}` phone maps to exactly one link/org; reject prefix collisions before identity normalization.
6. **Admin/platform authorization:** enumerate `super-admin-seed` and all `super_admin` memberships; explicitly decide whether membership-derived platform access (R1) is intended before preserving it in the tenant model.
7. **Feature-gate ordering:** sweep all callbacks calling `hasFeature`, `getEntitlements`, or `addUsage` and assert `requireOrg` already validated the same org; flag divergence between `req.params.orgId` and `x-organization-id`.
8. **Webhook/idempotency keys:** verify provider event ids are globally unique or include `organizationId` in dedupe/audit keys; assert `paymentEvents.organizationId` is non-empty whenever subscription/invoice state is mutated.
9. **Presence keying:** account for the `Map<userId, participant>` collision (R7) when deriving tenant keys for presence and quota; assert no user holds simultaneous valid sockets in two orgs under the current design.
10. **Route callback sweep:** classify every `.find`, `.some`, `.filter`, `findInOrg`, and `inOrg` in non-test `store.read`/`store.mutate` callbacks as org-predicated, token-derived-with-org-from-record, global/platform-by-design, or unclassified risk; the unclassified set must be empty before migration.

---

## 5. All 36 local JSON collections

No private record content was printed. Counts and field names only; structures are from `apps/api/src/domain/types.ts` and observed local JSON keys.

| Collection | Count | Structure / ownership | Current application usage | Proposed PostgreSQL destination | Recommended design | Relationships and migration risks |
| --- | ---: | --- | --- | --- | --- | --- |
| `users` | 11 | `id, phone, name, passwordHash, status, verifiedAt, createdAt`; global identity | auth, members, admin, reports, world | `users` | Normalized, but preserve one non-UUID `super-admin-seed` ID | Phone uniqueness; fixed privileged ID is referenced by sessions/audit logs. |
| `organizations` | 3 | `id, name, slug, timezone, status, settings, createdAt`; self-owned | orgs, auth, billing, schedules | `organizations` | Normalized after `tenant_id` rule approved | Runtime has no `tenantId`; normalized `tenant_id NOT NULL UNIQUE` would reject rows as-is. |
| `memberships` | 10 | `id, organizationId, userId, role, team, status, joinedAt` | members, auth, RBAC, billing, world | `memberships` | Normalized | Unique `(organization_id, user_id)`; no orphans locally; needs tenant/org consistency. |
| `authSessions` | 269 | `id, tokenHash, userId, activeOrgId, guestOrgId?, guestWorkspaceId?, guestRoomId?, guestLinkId?, worldOnly?, csrfHash?, wsTicketHash?, wsTicketExpiresAt?, kind, expiresAt, revokedAt, createdAt` | auth middleware, admin, orgs, invitations | `auth_sessions` | Normalize only after adding missing runtime fields | Nine sessions reference non-UUID super-admin ID; guest/world-only fields have no normalized columns. |
| `otps` | 0 | `id, phoneHash, codeHash, attempts, consumedAt, expiresAt, createdAt`; global | password-reset OTP auth | `otps` | Normalized | No local rows; preserve hash-only design. |
| `invitations` | 0 | `id, organizationId, phone?, email?, role, team, tokenHash, expiresAt, maxUses, uses, revokedAt, createdBy, createdAt` | invitation routes | `invitations` | Normalized | Token-hash uniqueness; `createdBy` FK must handle non-UUID super-admin if used. |
| `accessLinks` | 0 | `id, organizationId, workspaceId, roomId?, kind, subjectUserId?, requiresApproval?, tokenHash, expiresAt, maxUses, uses, revokedAt, createdBy, createdAt` | invitation/access routes | `access_links` | Normalized after adding `requires_approval` | Token uniqueness; guest/member link semantics must be preserved. |
| `workspaces` | 3 | `id, organizationId, name, description, width, height, createdAt` | workspaces, world, billing, media | `workspaces` | Normalized | No orphans locally; runtime lacks `updatedAt` (DB default exists). |
| `rooms` | 24 | `id, workspaceId, organizationId, name, kind, privacy, bounds, color, allowedRoles, capacity` | world, layout, media, messaging | `rooms` | Normalized | Verify workspace/org pair consistency; runtime lacks timestamps. |
| `schedules` | 7 | `id, organizationId, userId, kind, title, days, startTime, endTime, timezone, graceMinutes, minimumMinutes, exceptions, policySnapshot, status, history, createdAt` | schedules, demo | `schedule_rules` | Normalized | JSON arrays/objects; runtime lacks `updatedAt`; user FK. |
| `scheduledSessions` | 52 | `id, organizationId, scheduleRuleId, userId, kind, title, startsAt, endsAt, workspaceId?, graceMinutes, minimumMinutes, status, policySnapshot, createdAt` | schedules, attendance, reports, analytics | `scheduled_sessions` | Normalized | Unique `(schedule_rule_id, starts_at)`; no local duplicates/orphans. |
| `attendanceSessions` | 47 | `id, organizationId, scheduledSessionId, userId, firstJoin, lastLeave, lastHeartbeat, status, lateness/break/early-leave fields, finalizedAt, note, createdAt` | attendance, reports, analytics, jobs | `attendance_sessions` | Normalized | Unique `(scheduled_session_id, user_id)`; preserve finalized job state. |
| `attendanceEvents` | 892 | `id, organizationId, attendanceSessionId, scheduledSessionId, userId, type, at, source, metadata?` | attendance service/routes, demo | `attendance_events` | Normalized | High-volume append-only evidence; preserve exact timestamps/order. |
| `attendanceChanges` | 1 | `id, organizationId, attendanceSessionId, actorId, reason, before, after, at` | attendance corrections | `attendance_changes` | Normalized | Audit semantics; actor FK may reference non-UUID super-admin. |
| `auditLogs` | 225 | `id, organizationId?, actorId?, action, target, metadata, at` | middleware, admin, auth, billing, schedules | `audit_logs` | Normalized with nullable org/actor | One actor is non-UUID super-admin; append-only; platform rows may have null org. |
| `teams` | 0 | `id, organizationId, name, description, leadUserId?, createdAt` | teams, messaging, reports, integrations | `teams` | Normalized after adding `lead_user_id` | No local rows; normalized table currently missing runtime field. |
| `guestRequests` | 0 | `id, organizationId, linkId, name, phone?, status, reviewedBy?, reviewedAt?, createdAt` | invitations | New `guest_requests` table or JSONB | New normalized table preferred | `guest_admissions` is not a direct match; approval workflow fields differ. |
| `meetings` | 3 | `id, organizationId, workspaceId, roomId?, title, hostUserId, status, provider, startedAt?, endedAt?, createdAt` | meetings, AI, analytics, media, billing | New `meetings` table | Normalized | No current table; provider/livekit references. |
| `meetingParticipants` | 0 | `id, meetingId, organizationId, userId, role, micEnabled, cameraEnabled, sharing, joinedAt, leftAt?` | media | New `meeting_participants` table | Normalized | No current table; FK to meetings/users. |
| `recordings` | 0 | `id, organizationId, meetingId, roomId?, ownerUserId, status, providerFileId?, providerUrl?, retentionDays, attempts, lastError?, startedAt?, endedAt?, createdAt` | recordings, drive, admin | New `recordings` table | Metadata only; bytes in object storage | No current table; provider URLs/secret handling. |
| `driveConnections` | 0 | `organizationId, status, folderId?, folderName?, connectedBy?, connectedAt?, lastError?, updatedAt` | drive, integrations, recordings | New `drive_connections` table | Normalized, no token bytes here | No `id` in runtime shape; provider secrets live in `credentials`. |
| `plans` | 3 | `id, name, description, interval, priceCents, currency, features, featureKeys?, limits, status, createdAt` | billing, admin, entitlements | New `plans` table | Normalized platform catalog | Non-UUID IDs such as `plan-free`; global, not tenant-owned. |
| `subscriptions` | 0 | `id, organizationId, planId, interval?, status, trialEndsAt?, currentPeriodStart, currentPeriodEnd, cancelAtPeriodEnd, graceUntil?, createdAt, updatedAt` | billing, admin, webhooks | New `subscriptions` table | Normalized | Must preserve billing state and plan FK. |
| `invoices` | 0 | `id, organizationId, subscriptionId, amountCents, currency, status, periodStart, periodEnd, providerEventId?, createdAt` | billing, webhooks | New `invoices` table | Normalized | Provider event id uniqueness/idempotency. |
| `paymentEvents` | 0 | `id, organizationId, invoiceId?, provider, eventId, type, amountCents, status, createdAt` | billing webhooks | New `payment_events` table | Normalized, append-only | Provider event idempotency; webhook replay safety. |
| `channels` | 0 | `id, organizationId, name, scope, scopeId?, createdBy, createdAt` | messaging, integrations | New `channels` table | Normalized | Polymorphic scope needs validation. |
| `messages` | 0 | `id, organizationId, channelId?, directUserId?, senderUserId, body, readBy[], createdAt` | messaging | New `messages` table | Normalized plus read-receipt join table | `readBy[]` should not be a scalar in normalized design. |
| `notifications` | 0 | `id, organizationId, userId?, type, title, body, readAt?, readBy?, createdAt` | notifications, invitations | `notifications` | Normalize after adding `readBy` representation | Org-wide rows use `userId = null`; per-recipient receipts conflict with single `readAt`. |
| `notificationLogs` | 0 | `id, organizationId, userId?, channel, type, status, provider?, error?, createdAt` | notifications, drive | New `notification_logs` table | Normalized append-only | Delivery audit; no provider secrets. |
| `aiInsights` | 0 | `id, organizationId, meetingId?, kind, content, provider, createdAt` | AI | New `ai_insights` table | Normalized | Optional meeting FK; content may be large JSON/text. |
| `integrations` | 0 | `id, organizationId, provider, status, scopes[], connectedBy?, connectedAt?, lastError?, metadata, updatedAt` | integrations, drive, billing | New `integration_connections` table | Normalized | Secrets stay in `credentials`, not here. |
| `avatarConfigs` | 1 | `userId, organizationId, character, outfitColor, accessory?, updatedAt` | customization | New `avatar_configs` table | Normalized with `(user_id, organization_id)` key | No `id` in runtime shape; avatar render config must survive exactly. |
| `workspaceTemplates` | 0 | `id, organizationId, name, layout, createdAt` | customization | New `workspace_templates` table | Normalized; `layout` JSONB | Layout JSON must be preserved losslessly. |
| `usageRecords` | 0 | `id, organizationId, metric, value, at` | analytics, billing entitlements | New `usage_records` table | Normalized | Used for quota enforcement; exact timestamps matter. |
| `credentials` | 0 | `id, organizationId?, kind, provider, name, ciphertext, iv, authTag, keyVersion, scopes[], expiresAt?, revokedAt?, lastUsedAt?, createdBy, createdAt, updatedAt` | credential vault, auth, media, integrations | New encrypted-vault table or protected JSONB | Dedicated `credential_records` table preferred | Ciphertext only; never decrypt/export; master key stays in host env. |
| `jobRuns` | 100 | `id, name, organizationId?, startedAt, finishedAt?, status, result?, error?` | attendance durable jobs | New `job_runs` table | Normalized with idempotency key | All local rows are `succeeded`; preserve names/results for job idempotency. |

**Preservation rule:** until every destination table exists and round-trip tests pass, all 36 collections remain intact in `saha_state`. No collection is discarded or treated as disposable.

---

## 6. Non-standard identifier analysis

### 6.1 Correction to earlier report

The previous report described "nine non-UUID session IDs". That was a miscount. The nine values were `authSessions.userId` references to one non-UUID user; **all `authSessions.id` values are valid UUIDs**. The earlier report has been corrected on this branch.

### 6.2 The non-UUID user

| Property | Finding |
| --- | --- |
| Identifier | `super-admin-seed` (value shown because it is a hardcoded code constant, not a secret) |
| Count | 1 user |
| Shape | Has phone, password hash, active status, verified timestamp |
| Membership | No membership record |
| Privilege | Hardcoded super-admin identity in application authorization |
| Local references | 9 `authSessions.userId`, 1 `auditLogs.actorId`, 0 memberships |

Code evidence:

- `apps/api/src/common/middleware.ts:55` — role resolution maps this ID to `super_admin`.
- `apps/api/src/common/middleware.ts:80` — org authorization bypass for this ID.
- `apps/api/src/modules/admin/routes.ts:24` — cross-org admin access for this ID.
- `apps/api/src/modules/credentials/routes.ts:33` — credential-vault admin access for this ID.
- `apps/api/src/modules/auth/routes.ts:291` — org access check for this ID.
- `apps/api/src/modules/demo/seed.ts:17-22` — seeded deliberately with this fixed ID.

### 6.3 Backward-compatible recommendation

1. **Initial cutover:** keep `saha_state` as the source of truth and preserve the exact ID. Do not rewrite it.
2. **Before normalized users:** add an explicit role/flag (for example `is_super_admin`) and a legacy-ID mapping table, then update hardcoded authorization checks in a reviewed code change.
3. **Only after approval:** migrate references in one transaction, keeping the legacy ID as a retained column for auditability. Do not invalidate or recreate the nine sessions.
4. **Validation:** confirm the nine sessions still authenticate, can be revoked, and retain their expiry/revocation state; confirm the audit-log actor attribution remains correct.

No identifier conversion was performed.

---

## 7. TLS, adapter, and RLS remediation proposals

### 7.1 TLS

Current `postgres-store.ts` uses `ssl: rejectUnauthorized: false` for every `PGSSLMODE` other than `disable`. This weakens MITM protection and would make `verify-full` ineffective if only an env value were changed.

Proposal:

- Remove `rejectUnauthorized: false`.
- Use explicit certificate validation with hostname verification (for example `sslmode=verify-full`, or `ssl: { rejectUnauthorized: true, servername: <endpoint> }`).
- Supabase-managed endpoints normally use publicly trusted certificates; do not add or weaken CA settings without evidence.
- Never set `sslmode=disable` in staging/production.
- Keep TLS validation strict even if a connection initially fails; diagnose certificate/name/network causes instead of disabling verification.

Status: **Requires Owner Approval**, not activated.

### 7.2 Database adapter fail-closed startup

Current `store.ts` selects local JSON whenever `DATA_ADAPTER !== 'postgres'`. A missing or misspelled value can silently use local JSON in production.

Proposal:

- Define production explicitly (`APP_ENV`/`NODE_ENV=production`).
- In production, require `DATA_ADAPTER=postgres`; otherwise throw at startup.
- When `DATA_ADAPTER=postgres`, require a non-empty `DATABASE_URL`; `createPostgresStore()` already throws on empty URL, but the early adapter selection should also fail closed.
- Call `initializeStore()` before binding HTTP/WS ports; `main.ts` already does this.
- Keep local JSON as the intentional default for local development only.
- Treat `/api/health` as configuration status, not database proof; add a separate verified readiness check for runtime use.

Status: **Requires Owner Approval**, not activated.

### 7.3 RLS design

- Do not use Supabase Auth helpers such as `auth.uid()`; this app uses its own phone/password sessions and token hashes.
- Trusted org context must be established by application middleware after session and membership validation.
- Inside each SQL transaction, set transaction-local context, for example `SET LOCAL app.tenant_id` and `SET LOCAL app.user_id`, then enforce policies with `current_setting(..., true)` and fail closed when absent.
- Enable RLS on every tenant-bearing table: organizations, users (carefully), teams, memberships, workspaces, rooms, invitations, access_links, auth_sessions, guest_admissions, otps, schedule_rules, scheduled_sessions, attendance_sessions, attendance_events, breaks, attendance_changes, audit_logs, notifications, file_assets, plus all new normalized tables listed in Section 5.
- Use separate migration/backup roles; do not rely on the application role for unrestricted DDL.
- The JSONB `saha_state` row cannot use per-table RLS; tenant checks remain application-enforced until normalized repositories exist.

Status: **Not Implemented**; design only.

---

## 8. Migration readiness assessment

Overall readiness: **Blocked by External Dependency**. Code-side preparation is **Partially Implemented**; live database readiness is unknown.

### 8.1 Proposed migration plan

1. **Schema compatibility fixes** — extend the Drizzle schema for the 19 unmapped collections, add missing runtime fields, and add an explicit tenant mapping rule. Apply only additive DDL to a disposable DB.
2. **Data preservation** — snapshot `data/store.json`, record SHA-256 and 36 collection counts, and keep all collections in `saha_state` until normalized round-trips pass.
3. **Tenant mapping and validation** — derive `tenant_id` explicitly, validate organization references, and assert `(tenant_id, organization_id)` consistency.
4. **Non-standard identifiers** — preserve `super-admin-seed`; add role/mapping support before normalizing `users`; never rewrite sessions silently.
5. **RLS and authorization** — implement per-transaction trusted context and policies after normalized repositories exist; keep app-level checks meanwhile.
6. **Backup/recovery** — snapshot before and after; rehearse restore; never use reset/truncate as rollback.
7. **Disposable DB test** — apply additive migration, import snapshot into `saha_state`, run constraint/tenant/isolation tests, and roll back the test transaction.
8. **Integrity verification** — compare all 36 counts and canonical JSON; verify uniqueness, FK/orphan checks, token hashes, schedule keys, attendance keys, and job idempotency.
9. **Rollback** — switch to original local snapshot or restore DB snapshot; keep both until sign-off.
10. **Cutover prerequisites** — strict TLS, fail-closed adapter, single-instance ADR-002 world, verified workflows, owner approval, and no production deploy until all pass.

### 8.2 Safe technical fixes needing no data changes

- Read-only audit probe and catalog comparison.
- TLS verification fix in the adapter code.
- Production fail-closed adapter guard.
- Additive schema definitions for missing tables/columns.
- RLS policy design and SQL test scripts.
- Backup/restore and verification scripts.

### 8.3 Decisions requiring owner approval

- Confirm disposable/staging target and no production data at risk.
- Approve `tenant_id` derivation rule.
- Approve normalized tables for the 19 unmapped collections, or explicitly retain them in JSONB.
- Approve super-admin identity/role strategy.
- Approve migration on disposable DB.
- Approve production cutover and deploy separately.

### 8.4 External configuration requirements

- `DATABASE_URL` in local environment or approved secret mechanism.
- Network egress to the verified direct/pooler endpoint.
- Correct pooler endpoint/region and TLS settings from Supabase.
- Availability of a DB client/tooling if the Node-based read-only probe is not acceptable.

### 8.5 Risks preventing migration

- No database identity or read-only verification.
- No live schema/index/constraint/RLS comparison.
- No confirmed disposable/staging environment.
- No backup/restore drill.
- One hardcoded non-UUID privileged identity.
- 19 collections without normalized destinations.
- No RLS and no trusted SQL tenant context.
- No verified TLS chain or fail-closed production startup.

---

## 9. Exact blockers and owner decisions

1. Configure `DATABASE_URL` locally; do not paste it into chat, a file, a ticket, or CI output. I only need confirmation that it is set.
2. Confirm the URL belongs to Supabase project `wyjnopgbdszzkehxside` and whether it is direct or pooler.
3. Confirm the target database is disposable/staging and contains no production data at risk.
4. Ensure network egress from the audit host to that endpoint.
5. Approve the strict read-only probe design; it will abort if TLS verification or `BEGIN READ ONLY` cannot be confirmed.
6. Decide the `tenant_id` derivation rule; no automatic assignment will be made.
7. Decide whether to extend the schema for the 19 unmapped collections now or retain them in `saha_state` first.
8. Approve the super-admin identity/role strategy before normalizing `users`.
9. Approve TLS verification and fail-closed adapter changes.
10. Approve additive migration and tests on the disposable DB only.
11. Approve production cutover only after real-database workflows pass.

---

## 10. Final audit statement

- Intended Supabase database reached: **No**.
- Read-only inspection verified: **No** (method prepared, not executed).
- Database writes: **None**.
- All 36 collections accounted for: **Yes**.
- Tenant ownership and identifier risks documented: **Yes**.
- TLS/RLS/adapter remediation proposals delivered: **Yes**.
- Migration readiness: **Blocked by External Dependency**; this instruction is **not** approval to migrate.

**Stop point:** This phase ends with this report. No migration, seed, modification, adapter switch, deployment, or production cutover was performed.
