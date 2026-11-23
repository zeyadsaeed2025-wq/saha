# Entity relationship diagram (target normalized schema)

> **Status: Implemented but Not Runtime-Verified.** This ERD mirrors `apps/api/src/db/schema.ts` and `apps/api/migrations/0000_initial_schema.sql`. It is a migration target, not active runtime code. Presence is intentionally absent (ADR-002). `saha_state` is a standalone JSONB compatibility row used by the active adapter.

```mermaid
erDiagram
  SAHA_STATE {
    text id PK
    jsonb state
    timestamptz updated_at
  }

  ORGANIZATIONS ||--o{ USERS : "optional home tenant"
  ORGANIZATIONS ||--o{ TEAMS : has
  ORGANIZATIONS ||--o{ MEMBERSHIPS : has
  USERS ||--o{ MEMBERSHIPS : joins
  TEAMS ||--o{ MEMBERSHIPS : labels
  ORGANIZATIONS ||--o{ WORKSPACES : has
  WORKSPACES ||--o{ ROOMS : contains
  ORGANIZATIONS ||--o{ ROOMS : scopes
  ORGANIZATIONS ||--o{ INVITATIONS : issues
  USERS ||--o{ INVITATIONS : created_by
  ORGANIZATIONS ||--o{ ACCESS_LINKS : issues
  WORKSPACES ||--o{ ACCESS_LINKS : targets
  ROOMS ||--o{ ACCESS_LINKS : "optional room scope"
  USERS ||--o{ ACCESS_LINKS : "subject/creator"
  ORGANIZATIONS ||--o{ AUTH_SESSIONS : scopes
  USERS ||--o{ AUTH_SESSIONS : owns
  WORKSPACES ||--o{ AUTH_SESSIONS : "guest scope"
  ROOMS ||--o{ AUTH_SESSIONS : "guest room"
  ACCESS_LINKS ||--o{ GUEST_ADMISSIONS : grants
  AUTH_SESSIONS ||--o| GUEST_ADMISSIONS : "scoped session"
  ORGANIZATIONS ||--o{ OTPS : "optional scope"
  ORGANIZATIONS ||--o{ SCHEDULE_RULES : has
  USERS ||--o{ SCHEDULE_RULES : owns
  SCHEDULE_RULES ||--o{ SCHEDULED_SESSIONS : materializes
  USERS ||--o{ SCHEDULED_SESSIONS : attends
  WORKSPACES ||--o{ SCHEDULED_SESSIONS : "optional location"
  SCHEDULED_SESSIONS ||--o{ ATTENDANCE_SESSIONS : produces
  USERS ||--o{ ATTENDANCE_SESSIONS : records
  ATTENDANCE_SESSIONS ||--o{ ATTENDANCE_EVENTS : receives
  SCHEDULED_SESSIONS ||--o{ ATTENDANCE_EVENTS : references
  USERS ||--o{ ATTENDANCE_EVENTS : emits
  ATTENDANCE_SESSIONS ||--o{ BREAKS : derives
  ATTENDANCE_EVENTS ||--o| BREAKS : "start event"
  ATTENDANCE_SESSIONS ||--o{ ATTENDANCE_CHANGES : corrected_by
  USERS ||--o{ ATTENDANCE_CHANGES : actor
  ORGANIZATIONS ||--o{ AUDIT_LOGS : "optional scope"
  USERS ||--o{ AUDIT_LOGS : actor
  ORGANIZATIONS ||--o{ NOTIFICATIONS : "optional scope"
  USERS ||--o{ NOTIFICATIONS : receives
  ORGANIZATIONS ||--o{ FILE_ASSETS : owns
  WORKSPACES ||--o{ FILE_ASSETS : "optional scope"
  ROOMS ||--o{ FILE_ASSETS : "optional scope"
  USERS ||--o{ FILE_ASSETS : uploads

  ORGANIZATIONS {
    uuid id PK
    uuid tenant_id UK
    text name
    text slug UK
    text timezone
    text status
    jsonb settings
    timestamptz created_at
  }
  USERS {
    uuid id PK
    uuid tenant_id FK
    text phone UK
    text name
    text password_hash
    text status
    timestamptz verified_at
  }
  TEAMS {
    uuid id PK
    uuid tenant_id FK
    text name
    text description
  }
  MEMBERSHIPS {
    uuid id PK
    uuid tenant_id FK
    uuid organization_id FK
    uuid user_id FK
    uuid team_id FK
    text team
    text role
    text status
  }
  WORKSPACES {
    uuid id PK
    uuid tenant_id FK
    uuid organization_id FK
    text name
    integer width
    integer height
  }
  ROOMS {
    uuid id PK
    uuid tenant_id FK
    uuid organization_id FK
    uuid workspace_id FK
    text name
    text kind
    text privacy
    jsonb bounds
    jsonb allowed_roles
    integer capacity
  }
  INVITATIONS {
    uuid id PK
    uuid tenant_id FK
    uuid organization_id FK
    text token_hash UK
    text phone
    text email
    text role
    timestamptz expires_at
    integer uses
    integer max_uses
  }
  ACCESS_LINKS {
    uuid id PK
    uuid tenant_id FK
    uuid organization_id FK
    uuid workspace_id FK
    uuid room_id FK
    uuid subject_user_id FK
    text kind
    text token_hash UK
    timestamptz expires_at
  }
  AUTH_SESSIONS {
    uuid id PK
    uuid tenant_id FK
    uuid user_id FK
    uuid active_org_id FK
    uuid guest_org_id FK
    uuid guest_workspace_id FK
    uuid guest_room_id FK
    text token_hash UK
    text kind
    timestamptz expires_at
    timestamptz revoked_at
  }
  GUEST_ADMISSIONS {
    uuid id PK
    uuid tenant_id FK
    uuid organization_id FK
    uuid workspace_id FK
    uuid room_id FK
    uuid access_link_id FK
    uuid session_id FK
    text status
    timestamptz expires_at
  }
  OTPS {
    uuid id PK
    uuid tenant_id FK
    text phone_hash
    text code_hash
    integer attempts
    timestamptz consumed_at
    timestamptz expires_at
  }
  SCHEDULE_RULES {
    uuid id PK
    uuid tenant_id FK
    uuid organization_id FK
    uuid user_id FK
    text kind
    jsonb days
    varchar start_time
    varchar end_time
    text timezone
    jsonb exceptions
    jsonb policy_snapshot
    text status
  }
  SCHEDULED_SESSIONS {
    uuid id PK
    uuid tenant_id FK
    uuid organization_id FK
    uuid schedule_rule_id FK
    uuid user_id FK
    timestamptz starts_at
    timestamptz ends_at
    uuid workspace_id FK
    text status
  }
  ATTENDANCE_SESSIONS {
    uuid id PK
    uuid tenant_id FK
    uuid organization_id FK
    uuid scheduled_session_id FK
    uuid user_id FK
    text status
    double raw_lateness_seconds
    double counted_lateness_seconds
    double confirmed_connected_seconds
    double break_seconds
    timestamptz finalized_at
  }
  ATTENDANCE_EVENTS {
    uuid id PK
    uuid tenant_id FK
    uuid organization_id FK
    uuid attendance_session_id FK
    uuid scheduled_session_id FK
    uuid user_id FK
    text type
    timestamptz at
    text source
    jsonb metadata
  }
  BREAKS {
    uuid id PK
    uuid tenant_id FK
    uuid organization_id FK
    uuid attendance_session_id FK
    uuid attendance_event_id FK
    timestamptz started_at
    timestamptz ended_at
    double seconds
  }
  ATTENDANCE_CHANGES {
    uuid id PK
    uuid tenant_id FK
    uuid organization_id FK
    uuid attendance_session_id FK
    uuid actor_id FK
    text reason
    jsonb before
    jsonb after
    timestamptz at
  }
  AUDIT_LOGS {
    uuid id PK
    uuid tenant_id FK
    uuid organization_id FK
    uuid actor_id FK
    text action
    text target
    jsonb metadata
    timestamptz at
  }
  NOTIFICATIONS {
    uuid id PK
    uuid tenant_id FK
    uuid user_id FK
    text channel
    text type
    text title
    timestamptz read_at
  }
  FILE_ASSETS {
    uuid id PK
    uuid tenant_id FK
    uuid organization_id FK
    uuid workspace_id FK
    uuid room_id FK
    text provider
    text object_key
    text mime_type
    bigint size_bytes
    text status
  }
```
