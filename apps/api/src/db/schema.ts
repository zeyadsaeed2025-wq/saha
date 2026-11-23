/**
 * Target normalized PostgreSQL schema for Saha (Phase E).
 *
 * IMPORTANT — this schema is a migration target, not active runtime code:
 * - Presence stays in memory per ADR-002 (`WorldRegistry`); it is deliberately
 *   not represented here.
 * - The current runtime `Store` serializes the whole `DbState` into a single
 *   JSONB compatibility row (`saha_state`, see `common/postgres-store.ts`) for
 *   `DATA_ADAPTER=postgres`, or into a local JSON file by default. No repository
 *   reads/writes these normalized tables yet.
 * - These definitions and the SQL in `apps/api/migrations` have NOT been
 *   applied to any database. See `docs/database.md` for status labels.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type {
  AttendanceEventType,
  Organization,
  Role,
  ScheduleKind,
} from '../domain/types.js';

type JsonObject = Record<string, unknown>;
type OrganizationSettings = Organization['settings'];

/** Compatibility row used by the active JSONB Postgres adapter. */
export const sahaState = pgTable('saha_state', {
  id: text('id').primaryKey(),
  state: jsonb('state').$type<JsonObject>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** A tenant. `tenantId` intentionally mirrors `id` for a uniform RLS key. */
export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  timezone: text('timezone').notNull().default('UTC'),
  status: text('status').notNull().default('active'),
  settings: jsonb('settings').$type<OrganizationSettings>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('organizations_tenant_id_key').on(table.tenantId),
  uniqueIndex('organizations_slug_key').on(table.slug),
  index('organizations_status_idx').on(table.status),
]);

/**
 * Users are globally identified by normalized E.164 phone. `tenantId` is the
 * optional home tenant; org membership lives in `memberships`.
 */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => organizations.id, { onDelete: 'set null' }),
  phone: text('phone').notNull(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  status: text('status').notNull().default('active'),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('users_phone_key').on(table.phone),
  index('users_tenant_id_idx').on(table.tenantId),
]);

/** Normalized team records; `memberships.team` remains a display label. */
export const teams = pgTable('teams', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('teams_tenant_name_key').on(table.tenantId, table.name),
]);

export const memberships = pgTable('memberships', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  team: text('team'),
  teamId: uuid('team_id').references(() => teams.id, { onDelete: 'set null' }),
  role: text('role').$type<Role>().notNull(),
  status: text('status').notNull().default('active'),
  joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('memberships_org_user_key').on(table.organizationId, table.userId),
  index('memberships_tenant_status_idx').on(table.tenantId, table.status),
  index('memberships_user_id_idx').on(table.userId),
  index('memberships_team_id_idx').on(table.teamId),
]);

export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  width: integer('width').notNull().default(1600),
  height: integer('height').notNull().default(900),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('workspaces_tenant_id_idx').on(table.tenantId),
  index('workspaces_organization_id_idx').on(table.organizationId),
]);

export const rooms = pgTable('rooms', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  kind: text('kind').notNull(),
  privacy: text('privacy').notNull().default('public'),
  bounds: jsonb('bounds').$type<{ x: number; y: number; w: number; h: number }>().notNull().default(sql`'{}'::jsonb`),
  color: text('color').notNull().default('#0e7c7b'),
  allowedRoles: jsonb('allowed_roles').$type<Role[]>().notNull().default(sql`'[]'::jsonb`),
  capacity: integer('capacity').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('rooms_tenant_workspace_idx').on(table.tenantId, table.workspaceId),
  index('rooms_workspace_id_idx').on(table.workspaceId),
  index('rooms_organization_id_idx').on(table.organizationId),
]);

export const invitations = pgTable('invitations', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  phone: text('phone'),
  email: text('email'),
  role: text('role').$type<Role>().notNull(),
  team: text('team').notNull().default(''),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  maxUses: integer('max_uses').notNull().default(1),
  uses: integer('uses').notNull().default(0),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdBy: uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('invitations_token_hash_key').on(table.tokenHash),
  index('invitations_tenant_org_idx').on(table.tenantId, table.organizationId),
  index('invitations_expires_at_idx').on(table.expiresAt),
]);

/** Passwordless-member and public-guest access links (SRS guest admissions). */
export const accessLinks = pgTable('access_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  roomId: uuid('room_id').references(() => rooms.id, { onDelete: 'set null' }),
  kind: text('kind').notNull(),
  subjectUserId: uuid('subject_user_id').references(() => users.id, { onDelete: 'set null' }),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  maxUses: integer('max_uses').notNull().default(1),
  uses: integer('uses').notNull().default(0),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdBy: uuid('created_by').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('access_links_token_hash_key').on(table.tokenHash),
  index('access_links_tenant_kind_idx').on(table.tenantId, table.kind),
  index('access_links_workspace_id_idx').on(table.workspaceId),
  index('access_links_room_id_idx').on(table.roomId),
]);

export const authSessions = pgTable('auth_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => organizations.id, { onDelete: 'set null' }),
  tokenHash: text('token_hash').notNull(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  activeOrgId: uuid('active_org_id').references(() => organizations.id, { onDelete: 'set null' }),
  guestOrgId: uuid('guest_org_id').references(() => organizations.id, { onDelete: 'set null' }),
  guestWorkspaceId: uuid('guest_workspace_id').references(() => workspaces.id, { onDelete: 'set null' }),
  guestRoomId: uuid('guest_room_id').references(() => rooms.id, { onDelete: 'set null' }),
  kind: text('kind').notNull().default('member'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('auth_sessions_token_hash_key').on(table.tokenHash),
  index('auth_sessions_tenant_user_idx').on(table.tenantId, table.userId),
  index('auth_sessions_user_id_idx').on(table.userId),
  index('auth_sessions_expires_at_idx').on(table.expiresAt),
]);

/**
 * Normalized record of a guest admission. The runtime currently models guests
 * as synthetic users plus a scoped `auth_sessions` row; this table is the
 * target projection when guest identity is normalized.
 */
export const guestAdmissions = pgTable('guest_admissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  workspaceId: uuid('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  roomId: uuid('room_id').references(() => rooms.id, { onDelete: 'set null' }),
  accessLinkId: uuid('access_link_id').references(() => accessLinks.id, { onDelete: 'set null' }),
  subjectUserId: uuid('subject_user_id').references(() => users.id, { onDelete: 'set null' }),
  sessionId: uuid('session_id').references(() => authSessions.id, { onDelete: 'set null' }),
  status: text('status').notNull().default('active'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('guest_admissions_tenant_status_idx').on(table.tenantId, table.status),
  index('guest_admissions_session_id_idx').on(table.sessionId),
  index('guest_admissions_access_link_id_idx').on(table.accessLinkId),
]);

export const otps = pgTable('otps', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => organizations.id, { onDelete: 'set null' }),
  phoneHash: text('phone_hash').notNull(),
  codeHash: text('code_hash').notNull(),
  attempts: integer('attempts').notNull().default(0),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('otps_phone_consumed_idx').on(table.phoneHash, table.consumedAt),
  index('otps_expires_at_idx').on(table.expiresAt),
]);

export const scheduleRules = pgTable('schedule_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  kind: text('kind').$type<ScheduleKind>().notNull(),
  title: text('title').notNull(),
  days: integer('days').array().notNull(),
  startTime: varchar('start_time', { length: 5 }).notNull(),
  endTime: varchar('end_time', { length: 5 }).notNull(),
  timezone: text('timezone').notNull(),
  graceMinutes: integer('grace_minutes').notNull().default(0),
  minimumMinutes: integer('minimum_minutes').notNull().default(0),
  exceptions: jsonb('exceptions').$type<Array<{ date: string; type: string; reason: string }>>().notNull().default(sql`'[]'::jsonb`),
  policySnapshot: jsonb('policy_snapshot').$type<JsonObject>().notNull().default(sql`'{}'::jsonb`),
  status: text('status').notNull().default('active'),
  history: jsonb('history').$type<Array<{ at: string; actorId: string; note: string }>>().notNull().default(sql`'[]'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('schedule_rules_tenant_status_idx').on(table.tenantId, table.status),
  index('schedule_rules_org_status_idx').on(table.organizationId, table.status),
  index('schedule_rules_user_id_idx').on(table.userId),
]);

export const scheduledSessions = pgTable('scheduled_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  scheduleRuleId: uuid('schedule_rule_id').notNull().references(() => scheduleRules.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  kind: text('kind').$type<ScheduleKind>().notNull(),
  title: text('title').notNull(),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
  workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'set null' }),
  graceMinutes: integer('grace_minutes').notNull().default(0),
  minimumMinutes: integer('minimum_minutes').notNull().default(0),
  status: text('status').notNull().default('scheduled'),
  policySnapshot: jsonb('policy_snapshot').$type<JsonObject>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('scheduled_sessions_rule_start_key').on(table.scheduleRuleId, table.startsAt),
  index('scheduled_sessions_tenant_start_idx').on(table.tenantId, table.startsAt),
  index('scheduled_sessions_org_start_idx').on(table.organizationId, table.startsAt),
  index('scheduled_sessions_user_start_idx').on(table.userId, table.startsAt),
]);

export const attendanceSessions = pgTable('attendance_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  scheduledSessionId: uuid('scheduled_session_id').notNull().references(() => scheduledSessions.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  firstJoin: timestamp('first_join', { withTimezone: true }),
  lastLeave: timestamp('last_leave', { withTimezone: true }),
  lastHeartbeat: timestamp('last_heartbeat', { withTimezone: true }),
  status: text('status').notNull().default('pending_review'),
  rawLatenessSeconds: doublePrecision('raw_lateness_seconds').notNull().default(0),
  countedLatenessSeconds: doublePrecision('counted_lateness_seconds').notNull().default(0),
  confirmedConnectedSeconds: doublePrecision('confirmed_connected_seconds').notNull().default(0),
  breakSeconds: doublePrecision('break_seconds').notNull().default(0),
  earlyLeaveSeconds: doublePrecision('early_leave_seconds').notNull().default(0),
  finalizedAt: timestamp('finalized_at', { withTimezone: true }),
  note: text('note').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('attendance_sessions_scheduled_user_key').on(table.scheduledSessionId, table.userId),
  index('attendance_sessions_tenant_user_idx').on(table.tenantId, table.userId),
  index('attendance_sessions_org_status_idx').on(table.organizationId, table.status),
  index('attendance_sessions_scheduled_id_idx').on(table.scheduledSessionId),
]);

export const attendanceEvents = pgTable('attendance_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  attendanceSessionId: uuid('attendance_session_id').notNull().references(() => attendanceSessions.id, { onDelete: 'cascade' }),
  scheduledSessionId: uuid('scheduled_session_id').notNull().references(() => scheduledSessions.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  type: text('type').$type<AttendanceEventType>().notNull(),
  at: timestamp('at', { withTimezone: true }).notNull(),
  source: text('source').notNull(),
  metadata: jsonb('metadata').$type<JsonObject>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('attendance_events_tenant_at_idx').on(table.tenantId, table.at),
  index('attendance_events_session_at_idx').on(table.attendanceSessionId, table.at),
  index('attendance_events_scheduled_id_idx').on(table.scheduledSessionId),
  index('attendance_events_user_at_idx').on(table.userId, table.at),
]);

/** Derived break intervals; the runtime derives them from start/end events. */
export const breaks = pgTable('breaks', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  attendanceSessionId: uuid('attendance_session_id').notNull().references(() => attendanceSessions.id, { onDelete: 'cascade' }),
  attendanceEventId: uuid('attendance_event_id').references(() => attendanceEvents.id, { onDelete: 'set null' }),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  seconds: doublePrecision('seconds').notNull().default(0),
  source: text('source').notNull().default('world'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('breaks_tenant_started_idx').on(table.tenantId, table.startedAt),
  index('breaks_session_started_idx').on(table.attendanceSessionId, table.startedAt),
]);

export const attendanceChanges = pgTable('attendance_changes', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  attendanceSessionId: uuid('attendance_session_id').notNull().references(() => attendanceSessions.id, { onDelete: 'cascade' }),
  actorId: uuid('actor_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  reason: text('reason').notNull(),
  before: jsonb('before').$type<JsonObject>().notNull().default(sql`'{}'::jsonb`),
  after: jsonb('after').$type<JsonObject>().notNull().default(sql`'{}'::jsonb`),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('attendance_changes_tenant_at_idx').on(table.tenantId, table.at),
  index('attendance_changes_session_at_idx').on(table.attendanceSessionId, table.at),
]);

/** Append-only audit trail; never update or delete via application code. */
export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => organizations.id, { onDelete: 'set null' }),
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'set null' }),
  actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
  action: text('action').notNull(),
  target: text('target').notNull(),
  metadata: jsonb('metadata').$type<JsonObject>().notNull().default(sql`'{}'::jsonb`),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('audit_logs_tenant_at_idx').on(table.tenantId, table.at),
  index('audit_logs_org_at_idx').on(table.organizationId, table.at),
  index('audit_logs_actor_at_idx').on(table.actorId, table.at),
]);

/** In-app notification placeholders; no delivery channel is implemented. */
export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').references(() => organizations.id, { onDelete: 'set null' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  channel: text('channel').notNull().default('in_app'),
  type: text('type').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull().default(''),
  payload: jsonb('payload').$type<JsonObject>().notNull().default(sql`'{}'::jsonb`),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('notifications_tenant_user_read_idx').on(table.tenantId, table.userId, table.readAt),
  index('notifications_user_created_idx').on(table.userId, table.createdAt),
]);

/**
 * Metadata only — bytes belong in tenant-scoped object storage, never in the
 * database. No Drive/upload integration is implemented (Explicitly Deferred).
 */
export const fileAssets = pgTable('file_assets', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'set null' }),
  roomId: uuid('room_id').references(() => rooms.id, { onDelete: 'set null' }),
  uploaderId: uuid('uploader_id').references(() => users.id, { onDelete: 'set null' }),
  provider: text('provider').notNull().default('local'),
  objectKey: text('object_key').notNull(),
  fileName: text('file_name').notNull(),
  mimeType: text('mime_type'),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull().default(0),
  checksum: text('checksum'),
  status: text('status').notNull().default('active'),
  metadata: jsonb('metadata').$type<JsonObject>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('file_assets_tenant_provider_key').on(table.tenantId, table.provider, table.objectKey),
  index('file_assets_tenant_workspace_idx').on(table.tenantId, table.workspaceId),
  index('file_assets_uploader_id_idx').on(table.uploaderId),
]);
