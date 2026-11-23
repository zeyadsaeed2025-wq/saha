# API contracts

Based on the actual Express routers in `apps/api/src`. All paths below are relative to `/api` unless shown otherwise. Requests/responses are JSON except the CSV export.

## Conventions

- **Auth:** cookie `saha_session` (httpOnly). Protected routes call `requireAuth`; org-scoped routes call `requireOrg` and then `requirePermission`.
- **Tenant scope:** `requireOrg` reads `:orgId` from the route (or `x-organization-id` header when no route param is present), verifies active membership (guest sessions are bound to one org), and sets `auth.role`. All list/get writes are filtered by organization ID.
- **CSRF / WS credentials:** for non-`GET`/`HEAD`/`OPTIONS` requests, `x-csrf-token` must equal the readable `saha_csrf` cookie; this value is distinct from `saha_session`. Exempt: `POST /auth/login`, `/auth/register`, `/auth/forgot`, `/auth/reset`, `POST /access/:token/redeem`. `GET /health` and `POST /demo/seed` are mounted before the CSRF/auth middleware. For WebSocket, the client first calls `POST /auth/ws-ticket` and uses the returned 10-minute ticket as `?token=`, with `saha_csrf` only as a fallback. Both resolve as world-only aliases and cannot authenticate HTTP requests.
- **Error envelope:** `{ "error": { "code": "CODE", "message": "...", "details"?: ... } }`.

| HTTP | Common codes |
| --- | --- |
| 400 | `BAD_REQUEST`, `INVALID_JSON`, `INVALID_CODE`, `INVALID_INVITATION`, `PHONE_MISMATCH`, `INVALID_LINK`, `NO_ACTIVE_SESSION`, `NOT_FOUND` (some lookups) |
| 401 | `UNAUTHORIZED` |
| 403 | `FORBIDDEN`, `CSRF_FAILED` |
| 404 | `NOT_FOUND` |
| 409 | `CONFLICT`, `DUPLICATE_PHONE`, `DUPLICATE_MEMBER`, `LINK_EXHAUSTED` |
| 500 | `INTERNAL_ERROR` |

## Health & demo

| Method | Path | Access | Response |
| --- | --- | --- | --- |
| GET | `/health` | Public | `{ status:'ok', service:'saha-api', time, dataAdapter:'local-json'|'postgres' }` |
| POST | `/demo/seed` | Public; gated by `ALLOW_DEMO_SEED !== 'false'` | `{ organization, adminPhone, adminPassword, alreadySeeded, notice }` |

## Auth (`/auth`)

| Method | Path | Access | Request → response |
| --- | --- | --- | --- |
| POST | `/register` | Public, CSRF-exempt | `{ name, phone, password }` (≥8 char password) → `201 { user:{id,phone,name}, activeOrgId:null }`; issues cookies. Duplicate normalized phone → `409 DUPLICATE_PHONE`. |
| POST | `/login` | Public, CSRF-exempt | `{ phone, password }` → `{ user:{id,phone,name}, activeOrgId }`; issues cookies. Invalid credentials → generic `401`. |
| POST | `/logout` | Auth + CSRF | → `{ ok:true }`; revokes current session and clears cookies. |
| GET | `/me` | Auth | → `{ user, activeOrgId, organization?, memberships:[{organizationId,role,team,organizationName}], role, isGuest }`. |
| POST | `/ws-ticket` | Auth + CSRF | → `{ ticket, expiresAt }`; separate random 10-minute world-only credential for `/ws/world`. |
| POST | `/forgot` | Public, CSRF-exempt | `{ phone }` → `{ ok:true, message, devCode?, devNotice? }`. Always generic; dev code only when no SMS provider and non-production. |
| POST | `/reset` | Public, CSRF-exempt | `{ phone, code (6 digits), newPassword (≥8) }` → `{ ok:true }`. |
| POST | `/session/org` | Auth + CSRF | `{ organizationId (uuid) }` → `{ ok:true, activeOrgId }`; membership required. |
| GET | `/sessions` | Auth | → `{ sessions:[{id,createdAt,expiresAt,current}] }`. |
| DELETE | `/sessions/:id` | Auth + CSRF | → `{ ok:true }`; only own sessions; logs `session.revoked`. |

## Organizations (`/orgs`)

| Method | Path | Permission | Request → response |
| --- | --- | --- | --- |
| GET | `/` | Auth | → `{ organizations:[Organization & {role,team}] }`. |
| POST | `/` | Auth + CSRF | `{ name, timezone? }` → `201 { organization }`; also creates org admin membership, default workspace/rooms and sets active org. |
| GET | `/:orgId` | `org:read` | → `{ organization }`. |
| PATCH | `/:orgId` | `org:update` | `{ name?, timezone?, graceMinutesDefault?, heartbeatSeconds?, verificationWindowMinutes? }` → `{ organization }`. |

## Workspaces (`/orgs/:orgId/workspaces`)

| Method | Path | Permission | Request → response |
| --- | --- | --- | --- |
| GET | `/` | `workspace:read` | → `{ workspaces:[Workspace & {roomCount}] }`. |
| GET | `/:id` | `workspace:read` | → `{ workspace, rooms:[Room] }`. |
| POST | `/` | `workspace:manage` | `{ name, description? }` → `201 { workspace, rooms }` (default floor plan). |
| PATCH | `/:id/rooms/:roomId` | `workspace:manage` | `{ privacy?, capacity?, allowedRoles? }` → `{ room }`. |

## Members (`/orgs/:orgId/members`)

| Method | Path | Permission | Request → response |
| --- | --- | --- | --- |
| GET | `/` | `member:read` | → `{ members:[{id,userId,name,phone,role,team,status,joinedAt}] }`. |
| POST | `/` | `member:manage` | `{ phone, name, role:'org_admin'|'mentor'|'student', team? }` → `201 { member, temporaryPassword|null, notice }`. A one-time temporary password is returned only when creating a new user. |
| PATCH | `/:id` | `member:manage` | `{ role?, team?, status:'active'|'suspended'? }` → `{ membership }`. Cannot escalate role or change own admin role. |
| DELETE | `/:id` | `member:manage` | → `{ ok:true }`; cannot remove yourself. |

## Invitations & access links

| Method | Path | Access | Request → response |
| --- | --- | --- | --- |
| POST | `/orgs/:orgId/invitations` | Auth + `invitation:manage` | `{ phone?, email?, role?, team?, expiresInHours?, maxUses? }` → `201 { invitation, url, token, notice }`. Raw token shown once; hash stored. |
| GET | `/orgs/:orgId/invitations` | Auth + `invitation:manage` | → `{ invitations:[Invitation without tokenHash + active] }`. |
| GET | `/orgs/token/:token` | Public | → `{ organizationName, role, team, expiresAt, active, phoneHint }`; `404` if unknown. No raw token in response. |
| POST | `/orgs/token/:token/accept` | Auth + CSRF | → `{ organizationId, role }`; validates expiry, uses, phone restriction; sets active org. |
| POST | `/orgs/:orgId/invitations/:id/revoke` | Auth + `invitation:manage` | → `{ ok:true }`. |
| GET | `/orgs/:orgId/access-links` | `link:manage` | → `{ links:[AccessLink without tokenHash + active] }`. |
| POST | `/orgs/:orgId/access-links` | `link:manage` | `{ kind:'passwordless_member'|'public_guest', workspaceId, roomId?, subjectUserId?, expiresInHours?, maxUses? }` → `201 { link, url, token }`. Passwordless member links require `subjectUserId`. |
| POST | `/orgs/:orgId/access-links/:id/revoke` | `link:manage` | → `{ ok:true }`. |
| GET | `/access/:token/info` | Public | → `{ kind, organizationName, workspaceName, roomName, subjectName, expiresAt, uses, maxUses, active }`; `404` if unknown. |
| POST | `/access/:token/redeem` | Public, CSRF-exempt | → guest: `{ kind:'guest', organizationId, workspaceId, roomId }`; member: `{ kind:'member', organizationId, userId }`. Issues a scoped session; expired/exhausted links are rejected atomically. |

> The web client uses the `/api/orgs/token/...` paths shown above for invitation preview and acceptance; no alias under `/api/invitations/token/...` is required.

## Schedules (`/orgs/:orgId/schedules`)

| Method | Path | Permission | Request → response |
| --- | --- | --- | --- |
| GET | `/` | `schedule:read` | → `{ schedules:[ScheduleRule] }`. |
| POST | `/` | `schedule:manage` | `{ userId, kind:'shift'|'mentor_session', title, days:number[], startTime:'HH:mm', endTime:'HH:mm', timezone, graceMinutes?, minimumMinutes?, exceptions? }` → `201 { schedule }`. Managers may only manage their own schedule unless org/super admin. |
| PATCH | `/:id` | `schedule:manage` | Partial rule body → `{ schedule }`; appends history and audit. |
| POST | `/:id/generate` | `schedule:manage` | `{ from:'YYYY-MM-DD', to:'YYYY-MM-DD', workspaceId? }` → `{ created:number, message }`; skips holidays, marks approved absences excused, deduplicates by rule + start. |
| GET | `/sessions/list` | `schedule:read` | Query `from`, `to` → `{ sessions:[ScheduledSession] }`. |
| POST | `/sessions/:id/cancel` | `schedule:manage` | → `{ session }` with status `cancelled`. |

## Attendance (`/orgs/:orgId/attendance`)

| Method | Path | Permission | Request → response |
| --- | --- | --- | --- |
| GET | `/` | `attendance:read` | Query `from`, `to`, `userId` → `{ sessions:[AttendanceSession + scheduled + memberName, team, role] }`. Non-admins see only their own records. |
| GET | `/events` | `attendance:read` | Query `sessionId` → `{ events:[AttendanceEvent] }`. |
| POST | `/join`, `/heartbeat`, `/leave`, `/disconnect`, `/reconnect`, `/break/start`, `/break/end` | `attendance:read` | Optional `{ scheduledSessionId }` → `{ session }`; timestamps are server-generated; `NO_ACTIVE_SESSION` if no eligible session. |
| POST | `/finalize` | `attendance:correct` | → `{ absences, finalized }`; creates absences past the verification window and marks scheduled sessions completed. |
| POST | `/:id/correct` | `attendance:correct` | `{ reason (≥5), status?, note? }` → `{ session }`; writes `attendanceChanges`, a manual event and audit log. |
| GET | `/:id/history` | `attendance:read` | → `{ history:[AttendanceChange] }` newest first. |

## Reports (`/orgs/:orgId/reports`)

All accept filters `from`, `to`, `team`, `role`, `memberId`, `status`, `workspaceId`.

| Method | Path | Permission | Response |
| --- | --- | --- | --- |
| GET | `/summary` | `report:read` | `{ summary:{expected,present,onTime,late,partial,absent,excused,pendingReview,confirmedConnectedSeconds,confirmedConnectedLabel,punctualityRate,exceptions}, teams:[...], trend:[...] }`. |
| GET | `/members` | `report:read` | `{ members:[{userId,memberName,team,role,scheduled,attended,onTime,late,absent,connectedSeconds,latenessSeconds,punctualityRate,connectedLabel}] }`. |
| GET | `/sessions` | `report:read` | `{ sessions:[report rows] }`. |
| GET | `/export.csv` | `report:export` | `text/csv` attachment with BOM, UTF-8, quoted cells. |

## World (`/orgs/:orgId/world`) and WebSocket

| Method | Path | Permission | Response |
| --- | --- | --- | --- |
| GET | `/layout` | `world:connect` | Query optional `workspaceId` → deterministic `{ decor, obstacles, portals }` for the server-owned floor plan. |
| GET | `/presence` | `world:connect` | `{ online:[{userId,name,roomId,roomName,x,y,color}], occupancy:Record<roomId,number>, count }`. |

WebSocket: `ws(s)://<host>/ws/world?token=<ws-ticket|saha_csrf fallback>&orgId=<uuid>&workspaceId=<uuid>`.

- Server → client: `welcome`, `snapshot`, `presence` (joined/left), `occupancy`, `moved`, `rejected`.
- Client → server: `{type:'move',x,y,roomId}`, `{type:'heartbeat'}`, `{type:'leave'}`.
- Close codes: `4002` bad origin, `4001` unauthorized, `4003` membership/guest/workspace rejection, `4004` no rooms, `1000` explicit leave.
- Movement is validated server-side (room/org/workspace, role privacy, finite coordinates, bounds, 12px margin, 30px same-room step cap, obstacle/portal rules). Heartbeats feed attendance; presence itself is never attendance.
