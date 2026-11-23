export type Role = 'super_admin' | 'org_admin' | 'mentor' | 'student' | 'guest';
export type Permission =
  | 'org:read' | 'org:update'
  | 'member:read' | 'member:manage'
  | 'workspace:read' | 'workspace:manage'
  | 'schedule:read' | 'schedule:manage'
  | 'attendance:read' | 'attendance:correct'
  | 'report:read' | 'report:export'
  | 'invitation:manage' | 'link:manage'
  | 'team:read' | 'team:manage' | 'guest:manage'
  | 'meeting:read' | 'meeting:manage' | 'recording:read' | 'recording:manage'
  | 'message:read' | 'message:send' | 'notification:read'
  | 'billing:read' | 'billing:manage' | 'plan:manage' | 'admin:access' | 'audit:read'
  | 'integration:manage' | 'customization:manage'
  | 'world:connect';

export interface User {
  id: string;
  phone: string;
  name: string;
  passwordHash: string;
  status: 'active' | 'disabled';
  verifiedAt: string | null;
  createdAt: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  status: 'active' | 'suspended';
  settings: {
    graceMinutesDefault: number;
    heartbeatSeconds: number;
    verificationWindowMinutes: number;
    demo: boolean;
  };
  createdAt: string;
}

export interface Membership {
  id: string;
  organizationId: string;
  userId: string;
  role: Role;
  team: string;
  status: 'active' | 'invited' | 'suspended';
  joinedAt: string;
}

export interface AuthSession {
  id: string;
  tokenHash: string;
  userId: string;
  activeOrgId: string | null;
  guestOrgId?: string | null;
  guestWorkspaceId?: string | null;
  guestRoomId?: string | null;
  guestLinkId?: string | null;
  worldOnly?: boolean;
  csrfHash?: string | null;
  wsTicketHash?: string | null;
  wsTicketExpiresAt?: string | null;
  kind: 'member' | 'guest';
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
}

export interface Otp {
  id: string;
  phoneHash: string;
  codeHash: string;
  attempts: number;
  consumedAt: string | null;
  expiresAt: string;
  createdAt: string;
}

export interface Invitation {
  id: string;
  organizationId: string;
  phone: string | null;
  email: string | null;
  role: Role;
  team: string;
  tokenHash: string;
  expiresAt: string;
  maxUses: number;
  uses: number;
  revokedAt: string | null;
  createdBy: string;
  createdAt: string;
}

export interface AccessLink {
  id: string;
  organizationId: string;
  workspaceId: string;
  roomId: string | null;
  kind: AccessLinkKind;
  subjectUserId: string | null;
  requiresApproval?: boolean;
  tokenHash: string;
  expiresAt: string;
  maxUses: number;
  uses: number;
  revokedAt: string | null;
  createdBy: string;
  createdAt: string;
}

export interface Room {
  id: string;
  workspaceId: string;
  organizationId: string;
  name: string;
  kind: 'focus' | 'meeting' | 'social' | 'reception' | 'mentor' | 'study'
    | 'lobby' | 'open' | 'private' | 'collaboration';
  privacy: 'public' | 'private';
  bounds: { x: number; y: number; w: number; h: number };
  color: string;
  allowedRoles: Role[];
  capacity: number;
}

export interface Workspace {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  width: number;
  height: number;
  createdAt: string;
}

export type ScheduleKind = 'shift' | 'mentor_session';

export interface ScheduleException {
  date: string;
  type: 'holiday' | 'approved_absence' | 'extra_session';
  reason: string;
}

export interface ScheduleRule {
  id: string;
  organizationId: string;
  userId: string;
  kind: ScheduleKind;
  title: string;
  days: number[];
  startTime: string;
  endTime: string;
  timezone: string;
  graceMinutes: number;
  minimumMinutes: number;
  exceptions: ScheduleException[];
  policySnapshot: Record<string, unknown>;
  status: 'active' | 'paused';
  history: Array<{ at: string; actorId: string; note: string }>;
  createdAt: string;
}

export interface ScheduledSession {
  id: string;
  organizationId: string;
  scheduleRuleId: string;
  userId: string;
  kind: ScheduleKind;
  title: string;
  startsAt: string;
  endsAt: string;
  workspaceId?: string;
  graceMinutes: number;
  minimumMinutes: number;
  status: 'scheduled' | 'completed' | 'cancelled' | 'excused';
  policySnapshot: Record<string, unknown>;
  createdAt: string;
}

export type AttendanceEventType =
  | 'joined' | 'heartbeat' | 'disconnected' | 'reconnected' | 'left'
  | 'break_started' | 'break_ended' | 'manual_adjustment';

export interface AttendanceEvent {
  id: string;
  organizationId: string;
  attendanceSessionId: string;
  scheduledSessionId: string;
  userId: string;
  type: AttendanceEventType;
  at: string;
  source: 'world' | 'api' | 'manual';
  metadata?: Record<string, unknown>;
}

export interface AttendanceSession {
  id: string;
  organizationId: string;
  scheduledSessionId: string;
  userId: string;
  firstJoin: string | null;
  lastLeave: string | null;
  lastHeartbeat: string | null;
  status: 'on_time' | 'late' | 'absent' | 'partial' | 'excused' | 'pending_review';
  rawLatenessSeconds: number;
  countedLatenessSeconds: number;
  confirmedConnectedSeconds: number;
  breakSeconds: number;
  earlyLeaveSeconds: number;
  finalizedAt: string | null;
  note: string;
  createdAt: string;
}

export interface AttendanceChange {
  id: string;
  organizationId: string;
  attendanceSessionId: string;
  actorId: string;
  reason: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  at: string;
}

export interface AuditLog {
  id: string;
  organizationId: string | null;
  actorId: string | null;
  action: string;
  target: string;
  metadata: Record<string, unknown>;
  at: string;
}

// ---- Stage 1 additions ----

export interface Team {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  leadUserId: string | null;
  createdAt: string;
}

export interface GuestRequest {
  id: string;
  organizationId: string;
  linkId: string;
  name: string;
  phone: string | null;
  status: 'pending' | 'approved' | 'rejected';
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

export type AccessLinkKind =
  | 'private_workspace' | 'public_guest' | 'member_invitation'
  | 'passwordless_access' | 'passwordless_member';

// ---- Stage 2 additions ----

export interface Meeting {
  id: string;
  organizationId: string;
  workspaceId: string;
  roomId: string | null;
  title: string;
  hostUserId: string;
  status: 'scheduled' | 'live' | 'ended';
  provider: 'local' | 'livekit';
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
}

export interface MeetingParticipant {
  id: string;
  meetingId: string;
  organizationId: string;
  userId: string;
  role: 'host' | 'participant';
  micEnabled: boolean;
  cameraEnabled: boolean;
  sharing: boolean;
  joinedAt: string;
  leftAt: string | null;
}

export interface Recording {
  id: string;
  organizationId: string;
  meetingId: string;
  roomId: string | null;
  ownerUserId: string;
  status: 'pending' | 'recording' | 'uploading' | 'uploaded' | 'retrying' | 'failed';
  providerFileId: string | null;
  providerUrl: string | null;
  retentionDays: number;
  attempts: number;
  lastError: string | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
}

export interface DriveConnection {
  organizationId: string;
  status: 'not_connected' | 'connected' | 'expired' | 'error';
  folderId: string | null;
  folderName: string | null;
  connectedBy: string | null;
  connectedAt: string | null;
  lastError: string | null;
  updatedAt: string;
}

// ---- Stage 3 additions ----

export interface PlanLimits {
  members: number;
  rooms: number;
  workspaces: number;
  concurrentUsers: number;
  recordingMinutes: number;
  storageGb: number;
  meetingsPerMonth: number;
}

export interface Plan {
  id: string;
  name: string;
  description: string;
  interval: 'monthly' | 'annual';
  priceCents: number;
  currency: string;
  features: string[];
  /** Capability keys enforced by the API; absent means the baseline feature set. */
  featureKeys?: string[];
  limits: PlanLimits;
  status: 'active' | 'archived';
  createdAt: string;
}

export interface Subscription {
  id: string;
  organizationId: string;
  planId: string;
  interval?: 'monthly' | 'annual';
  status: 'trialing' | 'active' | 'past_due' | 'grace' | 'cancelled';
  trialEndsAt: string | null;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  graceUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Invoice {
  id: string;
  organizationId: string;
  subscriptionId: string;
  amountCents: number;
  currency: string;
  status: 'draft' | 'open' | 'paid' | 'failed' | 'void';
  periodStart: string;
  periodEnd: string;
  providerEventId: string | null;
  createdAt: string;
}

export interface PaymentEvent {
  id: string;
  organizationId: string;
  invoiceId: string | null;
  provider: 'sandbox' | 'stripe';
  eventId: string;
  type: string;
  amountCents: number;
  status: string;
  createdAt: string;
}

export interface Channel {
  id: string;
  organizationId: string;
  name: string;
  scope: 'organization' | 'team' | 'room';
  scopeId: string | null;
  createdBy: string;
  createdAt: string;
}

export interface Message {
  id: string;
  organizationId: string;
  channelId: string | null;
  directUserId: string | null;
  senderUserId: string;
  body: string;
  readBy: string[];
  createdAt: string;
}

export interface Notification {
  id: string;
  organizationId: string;
  /** null means an organization-wide notification visible to every member. */
  userId: string | null;
  type: string;
  title: string;
  body: string;
  readAt: string | null;
  /** Per-recipient read receipts; org-wide rows must not share one read flag. */
  readBy?: string[];
  createdAt: string;
}

export interface NotificationLog {
  id: string;
  organizationId: string;
  userId: string | null;
  channel: 'in_app' | 'email' | 'sms';
  type: string;
  status: 'sent' | 'failed' | 'skipped';
  provider: string | null;
  error: string | null;
  createdAt: string;
}

export interface AiInsight {
  id: string;
  organizationId: string;
  meetingId: string | null;
  kind: 'summary' | 'highlight' | 'insight';
  content: string;
  provider: 'local' | 'external';
  createdAt: string;
}

export interface IntegrationConnection {
  id: string;
  organizationId: string;
  provider: 'google_drive' | 'google_calendar' | 'outlook' | 'slack' | 'teams' | 'webhook' | 'public_api';
  status: 'not_connected' | 'connected' | 'expired' | 'error';
  scopes: string[];
  connectedBy: string | null;
  connectedAt: string | null;
  lastError: string | null;
  metadata: Record<string, unknown>;
  updatedAt: string;
}

/**
 * A server-side secret. Only ciphertext is persisted; the plaintext exists in
 * memory for the duration of the write and is never returned after creation.
 * organizationId === null marks a platform-level credential.
 */
export interface CredentialRecord {
  id: string;
  organizationId: string | null;
  kind: 'internal_api_key' | 'organization_integration' | 'provider_secret' | 'oauth_token';
  provider: string;
  name: string;
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: number;
  scopes: string[];
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface AvatarConfig {
  userId: string;
  organizationId: string;
  character: string;
  outfitColor: string;
  accessory: string | null;
  updatedAt: string;
}

export interface WorkspaceTemplate {
  id: string;
  organizationId: string;
  name: string;
  layout: Record<string, unknown>;
  createdAt: string;
}

export interface UsageRecord {
  id: string;
  organizationId: string;
  metric: string;
  value: number;
  at: string;
}

/** Persisted execution record for an idempotent background job (ADR-002 single instance). */
export interface JobRun {
  id: string;
  name: string;
  organizationId: string | null;
  startedAt: string;
  finishedAt: string | null;
  status: 'running' | 'succeeded' | 'failed' | 'recovered';
  result: Record<string, unknown> | null;
  error: string | null;
}

export interface DbState {
  users: User[];
  organizations: Organization[];
  memberships: Membership[];
  authSessions: AuthSession[];
  otps: Otp[];
  invitations: Invitation[];
  accessLinks: AccessLink[];
  workspaces: Workspace[];
  rooms: Room[];
  schedules: ScheduleRule[];
  scheduledSessions: ScheduledSession[];
  attendanceSessions: AttendanceSession[];
  attendanceEvents: AttendanceEvent[];
  attendanceChanges: AttendanceChange[];
  auditLogs: AuditLog[];
  teams: Team[];
  guestRequests: GuestRequest[];
  meetings: Meeting[];
  meetingParticipants: MeetingParticipant[];
  recordings: Recording[];
  driveConnections: DriveConnection[];
  plans: Plan[];
  subscriptions: Subscription[];
  invoices: Invoice[];
  paymentEvents: PaymentEvent[];
  channels: Channel[];
  messages: Message[];
  notifications: Notification[];
  notificationLogs: NotificationLog[];
  aiInsights: AiInsight[];
  integrations: IntegrationConnection[];
  avatarConfigs: AvatarConfig[];
  workspaceTemplates: WorkspaceTemplate[];
  usageRecords: UsageRecord[];
  credentials: CredentialRecord[];
  jobRuns: JobRun[];
}

export const emptyState = (): DbState => ({
  users: [], organizations: [], memberships: [], authSessions: [], otps: [],
  invitations: [], accessLinks: [], workspaces: [], rooms: [], schedules: [],
  scheduledSessions: [], attendanceSessions: [], attendanceEvents: [],
  attendanceChanges: [], auditLogs: [], teams: [], guestRequests: [], meetings: [],
  meetingParticipants: [], recordings: [], driveConnections: [], plans: [], subscriptions: [],
  invoices: [], paymentEvents: [], channels: [], messages: [], notifications: [],
  notificationLogs: [], aiInsights: [], integrations: [], avatarConfigs: [],
  workspaceTemplates: [], usageRecords: [], credentials: [], jobRuns: [],
});
