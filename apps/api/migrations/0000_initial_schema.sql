-- Saha baseline normalized schema (Phase E).
--
-- STATUS: hand-authored, reviewed-by-type-check-only, NOT applied to any database.
-- No PostgreSQL instance, credentials or docker were available. Do not run this
-- against production until it has been reviewed and staged.
--
-- Safe by construction: only CREATE TABLE IF NOT EXISTS and CREATE [UNIQUE]
-- INDEX IF NOT EXISTS. No DROPs, no data rewrites, no destructive migrations.
-- `gen_random_uuid()` requires PostgreSQL 13+ (or the pgcrypto extension).
-- The active runtime Store still uses the single `saha_state` JSONB row; the
-- normalized tables below are the target migration path, not active runtime code.
-- Presence stays in memory per ADR-002 and is intentionally absent.

CREATE TABLE IF NOT EXISTS saha_state (
  id          TEXT PRIMARY KEY,
  state       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organizations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL,
  timezone    TEXT NOT NULL DEFAULT 'UTC',
  status      TEXT NOT NULL DEFAULT 'active',
  settings    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- tenant_id is optional here: users are globally identified by phone.
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID REFERENCES organizations (id) ON DELETE SET NULL,
  phone         TEXT NOT NULL,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active',
  verified_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS teams (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memberships (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  team            TEXT,
  team_id         UUID REFERENCES teams (id) ON DELETE SET NULL,
  role            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active',
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspaces (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  width           INTEGER NOT NULL DEFAULT 1600,
  height          INTEGER NOT NULL DEFAULT 900,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rooms (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  workspace_id    UUID NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  kind            TEXT NOT NULL,
  privacy         TEXT NOT NULL DEFAULT 'public',
  bounds          JSONB NOT NULL DEFAULT '{}'::jsonb,
  color           TEXT NOT NULL DEFAULT '#0e7c7b',
  allowed_roles   JSONB NOT NULL DEFAULT '[]'::jsonb,
  capacity        INTEGER NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invitations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  phone           TEXT,
  email           TEXT,
  role            TEXT NOT NULL,
  team            TEXT NOT NULL DEFAULT '',
  token_hash      TEXT NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  max_uses        INTEGER NOT NULL DEFAULT 1,
  uses            INTEGER NOT NULL DEFAULT 0,
  revoked_at      TIMESTAMPTZ,
  created_by      UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS access_links (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  workspace_id   UUID NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  room_id        UUID REFERENCES rooms (id) ON DELETE SET NULL,
  kind           TEXT NOT NULL,
  subject_user_id UUID REFERENCES users (id) ON DELETE SET NULL,
  token_hash     TEXT NOT NULL,
  expires_at     TIMESTAMPTZ NOT NULL,
  max_uses       INTEGER NOT NULL DEFAULT 1,
  uses           INTEGER NOT NULL DEFAULT 0,
  revoked_at     TIMESTAMPTZ,
  created_by     UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID REFERENCES organizations (id) ON DELETE SET NULL,
  token_hash        TEXT NOT NULL,
  user_id           UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  active_org_id     UUID REFERENCES organizations (id) ON DELETE SET NULL,
  guest_org_id      UUID REFERENCES organizations (id) ON DELETE SET NULL,
  guest_workspace_id UUID REFERENCES workspaces (id) ON DELETE SET NULL,
  guest_room_id     UUID REFERENCES rooms (id) ON DELETE SET NULL,
  kind              TEXT NOT NULL DEFAULT 'member',
  expires_at        TIMESTAMPTZ NOT NULL,
  revoked_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS guest_admissions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  workspace_id    UUID NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  room_id         UUID REFERENCES rooms (id) ON DELETE SET NULL,
  access_link_id  UUID REFERENCES access_links (id) ON DELETE SET NULL,
  subject_user_id UUID REFERENCES users (id) ON DELETE SET NULL,
  session_id      UUID REFERENCES auth_sessions (id) ON DELETE SET NULL,
  status          TEXT NOT NULL DEFAULT 'active',
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS otps (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID REFERENCES organizations (id) ON DELETE SET NULL,
  phone_hash  TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  consumed_at TIMESTAMPTZ,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS schedule_rules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  kind            TEXT NOT NULL,
  title           TEXT NOT NULL,
  days            INTEGER[] NOT NULL,
  start_time      VARCHAR(5) NOT NULL,
  end_time        VARCHAR(5) NOT NULL,
  timezone        TEXT NOT NULL,
  grace_minutes   INTEGER NOT NULL DEFAULT 0,
  minimum_minutes INTEGER NOT NULL DEFAULT 0,
  exceptions      JSONB NOT NULL DEFAULT '[]'::jsonb,
  policy_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  status          TEXT NOT NULL DEFAULT 'active',
  history         JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scheduled_sessions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  organization_id  UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  schedule_rule_id UUID NOT NULL REFERENCES schedule_rules (id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  kind             TEXT NOT NULL,
  title            TEXT NOT NULL,
  starts_at        TIMESTAMPTZ NOT NULL,
  ends_at          TIMESTAMPTZ NOT NULL,
  workspace_id     UUID REFERENCES workspaces (id) ON DELETE SET NULL,
  grace_minutes    INTEGER NOT NULL DEFAULT 0,
  minimum_minutes  INTEGER NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'scheduled',
  policy_snapshot  JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS attendance_sessions (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  organization_id           UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  scheduled_session_id      UUID NOT NULL REFERENCES scheduled_sessions (id) ON DELETE CASCADE,
  user_id                   UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  first_join                TIMESTAMPTZ,
  last_leave                TIMESTAMPTZ,
  last_heartbeat            TIMESTAMPTZ,
  status                    TEXT NOT NULL DEFAULT 'pending_review',
  raw_lateness_seconds      DOUBLE PRECISION NOT NULL DEFAULT 0,
  counted_lateness_seconds  DOUBLE PRECISION NOT NULL DEFAULT 0,
  confirmed_connected_seconds DOUBLE PRECISION NOT NULL DEFAULT 0,
  break_seconds             DOUBLE PRECISION NOT NULL DEFAULT 0,
  early_leave_seconds       DOUBLE PRECISION NOT NULL DEFAULT 0,
  finalized_at              TIMESTAMPTZ,
  note                      TEXT NOT NULL DEFAULT '',
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS attendance_events (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  organization_id      UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  attendance_session_id UUID NOT NULL REFERENCES attendance_sessions (id) ON DELETE CASCADE,
  scheduled_session_id UUID NOT NULL REFERENCES scheduled_sessions (id) ON DELETE CASCADE,
  user_id              UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  type                 TEXT NOT NULL,
  at                   TIMESTAMPTZ NOT NULL,
  source               TEXT NOT NULL,
  metadata             JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS breaks (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  organization_id      UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  attendance_session_id UUID NOT NULL REFERENCES attendance_sessions (id) ON DELETE CASCADE,
  attendance_event_id  UUID REFERENCES attendance_events (id) ON DELETE SET NULL,
  started_at           TIMESTAMPTZ NOT NULL,
  ended_at             TIMESTAMPTZ,
  seconds              DOUBLE PRECISION NOT NULL DEFAULT 0,
  source               TEXT NOT NULL DEFAULT 'world',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS attendance_changes (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  organization_id      UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  attendance_session_id UUID NOT NULL REFERENCES attendance_sessions (id) ON DELETE CASCADE,
  actor_id             UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  reason               TEXT NOT NULL,
  before               JSONB NOT NULL DEFAULT '{}'::jsonb,
  after                JSONB NOT NULL DEFAULT '{}'::jsonb,
  at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID REFERENCES organizations (id) ON DELETE SET NULL,
  organization_id UUID REFERENCES organizations (id) ON DELETE SET NULL,
  actor_id        UUID REFERENCES users (id) ON DELETE SET NULL,
  action          TEXT NOT NULL,
  target          TEXT NOT NULL,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID REFERENCES organizations (id) ON DELETE SET NULL,
  user_id    UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  channel    TEXT NOT NULL DEFAULT 'in_app',
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  payload    JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS file_assets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  workspace_id    UUID REFERENCES workspaces (id) ON DELETE SET NULL,
  room_id         UUID REFERENCES rooms (id) ON DELETE SET NULL,
  uploader_id     UUID REFERENCES users (id) ON DELETE SET NULL,
  provider        TEXT NOT NULL DEFAULT 'local',
  object_key      TEXT NOT NULL,
  file_name       TEXT NOT NULL,
  mime_type       TEXT,
  size_bytes      BIGINT NOT NULL DEFAULT 0,
  checksum        TEXT,
  status          TEXT NOT NULL DEFAULT 'active',
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique constraints / indexes (names match apps/api/src/db/schema.ts).
CREATE UNIQUE INDEX IF NOT EXISTS organizations_tenant_id_key ON organizations (tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS organizations_slug_key ON organizations (slug);
CREATE INDEX IF NOT EXISTS organizations_status_idx ON organizations (status);
CREATE UNIQUE INDEX IF NOT EXISTS users_phone_key ON users (phone);
CREATE INDEX IF NOT EXISTS users_tenant_id_idx ON users (tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS teams_tenant_name_key ON teams (tenant_id, name);
CREATE UNIQUE INDEX IF NOT EXISTS memberships_org_user_key ON memberships (organization_id, user_id);
CREATE INDEX IF NOT EXISTS memberships_tenant_status_idx ON memberships (tenant_id, status);
CREATE INDEX IF NOT EXISTS memberships_user_id_idx ON memberships (user_id);
CREATE INDEX IF NOT EXISTS memberships_team_id_idx ON memberships (team_id);
CREATE INDEX IF NOT EXISTS workspaces_tenant_id_idx ON workspaces (tenant_id);
CREATE INDEX IF NOT EXISTS workspaces_organization_id_idx ON workspaces (organization_id);
CREATE INDEX IF NOT EXISTS rooms_tenant_workspace_idx ON rooms (tenant_id, workspace_id);
CREATE INDEX IF NOT EXISTS rooms_workspace_id_idx ON rooms (workspace_id);
CREATE INDEX IF NOT EXISTS rooms_organization_id_idx ON rooms (organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS invitations_token_hash_key ON invitations (token_hash);
CREATE INDEX IF NOT EXISTS invitations_tenant_org_idx ON invitations (tenant_id, organization_id);
CREATE INDEX IF NOT EXISTS invitations_expires_at_idx ON invitations (expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS access_links_token_hash_key ON access_links (token_hash);
CREATE INDEX IF NOT EXISTS access_links_tenant_kind_idx ON access_links (tenant_id, kind);
CREATE INDEX IF NOT EXISTS access_links_workspace_id_idx ON access_links (workspace_id);
CREATE INDEX IF NOT EXISTS access_links_room_id_idx ON access_links (room_id);
CREATE UNIQUE INDEX IF NOT EXISTS auth_sessions_token_hash_key ON auth_sessions (token_hash);
CREATE INDEX IF NOT EXISTS auth_sessions_tenant_user_idx ON auth_sessions (tenant_id, user_id);
CREATE INDEX IF NOT EXISTS auth_sessions_user_id_idx ON auth_sessions (user_id);
CREATE INDEX IF NOT EXISTS auth_sessions_expires_at_idx ON auth_sessions (expires_at);
CREATE INDEX IF NOT EXISTS guest_admissions_tenant_status_idx ON guest_admissions (tenant_id, status);
CREATE INDEX IF NOT EXISTS guest_admissions_session_id_idx ON guest_admissions (session_id);
CREATE INDEX IF NOT EXISTS guest_admissions_access_link_id_idx ON guest_admissions (access_link_id);
CREATE INDEX IF NOT EXISTS otps_phone_consumed_idx ON otps (phone_hash, consumed_at);
CREATE INDEX IF NOT EXISTS otps_expires_at_idx ON otps (expires_at);
CREATE INDEX IF NOT EXISTS schedule_rules_tenant_status_idx ON schedule_rules (tenant_id, status);
CREATE INDEX IF NOT EXISTS schedule_rules_org_status_idx ON schedule_rules (organization_id, status);
CREATE INDEX IF NOT EXISTS schedule_rules_user_id_idx ON schedule_rules (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS scheduled_sessions_rule_start_key ON scheduled_sessions (schedule_rule_id, starts_at);
CREATE INDEX IF NOT EXISTS scheduled_sessions_tenant_start_idx ON scheduled_sessions (tenant_id, starts_at);
CREATE INDEX IF NOT EXISTS scheduled_sessions_org_start_idx ON scheduled_sessions (organization_id, starts_at);
CREATE INDEX IF NOT EXISTS scheduled_sessions_user_start_idx ON scheduled_sessions (user_id, starts_at);
CREATE UNIQUE INDEX IF NOT EXISTS attendance_sessions_scheduled_user_key ON attendance_sessions (scheduled_session_id, user_id);
CREATE INDEX IF NOT EXISTS attendance_sessions_tenant_user_idx ON attendance_sessions (tenant_id, user_id);
CREATE INDEX IF NOT EXISTS attendance_sessions_org_status_idx ON attendance_sessions (organization_id, status);
CREATE INDEX IF NOT EXISTS attendance_sessions_scheduled_id_idx ON attendance_sessions (scheduled_session_id);
CREATE INDEX IF NOT EXISTS attendance_events_tenant_at_idx ON attendance_events (tenant_id, at);
CREATE INDEX IF NOT EXISTS attendance_events_session_at_idx ON attendance_events (attendance_session_id, at);
CREATE INDEX IF NOT EXISTS attendance_events_scheduled_id_idx ON attendance_events (scheduled_session_id);
CREATE INDEX IF NOT EXISTS attendance_events_user_at_idx ON attendance_events (user_id, at);
CREATE INDEX IF NOT EXISTS breaks_tenant_started_idx ON breaks (tenant_id, started_at);
CREATE INDEX IF NOT EXISTS breaks_session_started_idx ON breaks (attendance_session_id, started_at);
CREATE INDEX IF NOT EXISTS attendance_changes_tenant_at_idx ON attendance_changes (tenant_id, at);
CREATE INDEX IF NOT EXISTS attendance_changes_session_at_idx ON attendance_changes (attendance_session_id, at);
CREATE INDEX IF NOT EXISTS audit_logs_tenant_at_idx ON audit_logs (tenant_id, at);
CREATE INDEX IF NOT EXISTS audit_logs_org_at_idx ON audit_logs (organization_id, at);
CREATE INDEX IF NOT EXISTS audit_logs_actor_at_idx ON audit_logs (actor_id, at);
CREATE INDEX IF NOT EXISTS notifications_tenant_user_read_idx ON notifications (tenant_id, user_id, read_at);
CREATE INDEX IF NOT EXISTS notifications_user_created_idx ON notifications (user_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS file_assets_tenant_provider_key ON file_assets (tenant_id, provider, object_key);
CREATE INDEX IF NOT EXISTS file_assets_tenant_workspace_idx ON file_assets (tenant_id, workspace_id);
CREATE INDEX IF NOT EXISTS file_assets_uploader_id_idx ON file_assets (uploader_id);

-- RLS is a DESIGN INTENT only and is NOT enabled here (Status: Not Implemented).
-- Example for a future per-request repository role (never applied by this file):
--   ALTER TABLE attendance_sessions ENABLE ROW LEVEL SECURITY;
--   CREATE POLICY tenant_isolation ON attendance_sessions
--     USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
-- Every tenant_id-bearing table needs the same policy before raw SQL is exposed.
