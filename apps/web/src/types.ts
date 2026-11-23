export type Role = 'super_admin' | 'org_admin' | 'mentor' | 'student' | 'guest';
export type AttendanceStatus = 'on_time' | 'late' | 'absent' | 'partial' | 'excused' | 'pending_review';

export interface Me {
  user: { id: string; phone: string; name: string };
  activeOrgId: string;
  organization: { id: string; name: string; timezone: string; settings: Record<string, number | boolean> } | null;
  memberships: Array<{ organizationId: string; organizationName: string; role: Role; team: string }>;
  role: Role;
  isGuest: boolean;
}

export interface Organization {
  id: string; name: string; slug: string; timezone: string;
  settings: { graceMinutesDefault: number; heartbeatSeconds: number; verificationWindowMinutes: number; demo: boolean };
  role?: Role;
}

export interface Room {
  id: string; workspaceId: string; name: string; kind: string; privacy: 'public' | 'private';
  bounds: { x: number; y: number; w: number; h: number }; color: string;
  allowedRoles: Role[]; capacity: number;
}
export interface Workspace { id: string; organizationId: string; name: string; description: string; width: number; height: number; roomCount?: number; rooms?: Room[]; }

export interface OfficeRect { x: number; y: number; w: number; h: number }
export type OfficeDecorKind =
  | 'desk' | 'chair' | 'monitor' | 'plant' | 'sofa' | 'table' | 'bookshelf'
  | 'rug' | 'lamp' | 'whiteboard' | 'counter' | 'partition' | 'window'
  | 'door' | 'mug' | 'screen' | 'cushion';
export interface OfficeDecor extends OfficeRect {
  id: string; kind: OfficeDecorKind; color?: string; label?: string; roomId: string;
}
export interface OfficePortal {
  id: string; fromRoomId: string; toRoomId: string;
  from: { x: number; y: number }; to: { x: number; y: number };
  orientation: 'horizontal' | 'vertical';
}
export interface OfficeLayout {
  roomId: string; decor: OfficeDecor[]; obstacles: OfficeRect[]; portals: OfficePortal[];
}

export interface Member {
  id: string; userId: string; name: string; phone: string; role: Role; team: string; status: string; joinedAt: string;
}

export interface ScheduleRule {
  id: string; title: string; kind: 'shift' | 'mentor_session'; userId: string;
  days: number[]; startTime: string; endTime: string; timezone: string;
  graceMinutes: number; minimumMinutes: number; status: string;
  exceptions: Array<{ date: string; type: string; reason: string }>;
  history: Array<{ at: string; actorId: string; note: string }>;
}
export interface ScheduledSession {
  id: string; title: string; userId: string; startsAt: string; endsAt: string;
  workspaceId?: string; status: string; kind: string; graceMinutes: number;
}

export interface AttendanceRow {
  id: string; userId: string; scheduledSessionId: string; memberName: string; team: string; role: Role;
  status: AttendanceStatus; firstJoin: string | null; lastLeave: string | null;
  confirmedConnectedSeconds: number; countedLatenessSeconds: number; earlyLeaveSeconds: number;
  note: string; finalizedAt: string | null;
  scheduled?: ScheduledSession | null;
}
export interface AttendanceEvent {
  id: string; type: string; at: string; source: string; metadata?: Record<string, unknown>;
}

export interface ReportSummary {
  expected: number; present: number; onTime: number; late: number; partial: number;
  absent: number; excused: number; pendingReview: number;
  confirmedConnectedSeconds: number; confirmedConnectedLabel: string; punctualityRate: number; exceptions: number;
}
export interface TeamStat { team: string; total: number; onTime: number; connectedSeconds: number; punctualityRate: number }
export interface TrendPoint { day: string; total: number; onTime: number; connectedMinutes: number }
export interface MemberReport {
  userId: string; memberName: string; team: string; role: Role; scheduled: number; attended: number;
  onTime: number; late: number; absent: number; connectedSeconds: number; latenessSeconds: number;
  punctualityRate: number; connectedLabel: string;
}
export interface SessionReportRow {
  id: string; day: string; memberName: string; team: string; role: Role; title: string;
  status: AttendanceStatus; scheduledMinutes: number; connectedSeconds: number;
  countedLatenessSeconds: number; breakSeconds: number; earlyLeaveSeconds: number; note: string;
}

export interface Invitation {
  id: string; role: Role; team: string; expiresAt: string; maxUses: number; uses: number;
  active: boolean; phone: string | null; email: string | null;
}
export type AccessLinkKind =
  | 'private_workspace' | 'public_guest' | 'member_invitation'
  | 'passwordless_access' | 'passwordless_member';

export interface AccessLink {
  id: string; kind: AccessLinkKind; workspaceId: string;
  roomId: string | null; subjectUserId: string | null; requiresApproval?: boolean; expiresAt: string;
  maxUses: number; uses: number; active: boolean;
}

// ---- Stage 1 additions ----
export interface Team {
  id: string; organizationId: string; name: string; description: string;
  leadUserId: string | null; leadName: string | null; memberCount: number; createdAt: string;
}
export interface GuestRequest {
  id: string; organizationId: string; linkId: string; name: string; phone: string | null;
  status: 'pending' | 'approved' | 'rejected'; reviewedBy: string | null;
  reviewedAt: string | null; createdAt: string;
}

// ---- Stage 2 additions ----
export interface Meeting {
  id: string; organizationId: string; workspaceId: string; roomId: string | null;
  title: string; hostUserId: string; status: 'scheduled' | 'live' | 'ended';
  provider: 'local' | 'livekit'; startedAt: string | null; endedAt: string | null; createdAt: string;
}
export interface MeetingParticipant {
  id: string; meetingId: string; organizationId: string; userId: string;
  role: 'host' | 'participant'; micEnabled: boolean; cameraEnabled: boolean;
  sharing: boolean; joinedAt: string; leftAt: string | null;
}
export interface Recording {
  id: string; organizationId: string; meetingId: string; roomId: string | null;
  ownerUserId: string; status: 'pending' | 'recording' | 'uploading' | 'uploaded' | 'retrying' | 'failed';
  providerFileId: string | null; providerUrl: string | null; retentionDays: number;
  attempts: number; lastError: string | null; startedAt: string | null;
  endedAt: string | null; createdAt: string;
}
export interface DriveConnection {
  organizationId: string; status: 'not_connected' | 'connected' | 'expired' | 'error';
  folderId: string | null; folderName: string | null; connectedBy: string | null;
  connectedAt: string | null; lastError: string | null; configured?: boolean; updatedAt?: string;
}
export interface IntegrationConnection {
  id: string; organizationId: string;
  provider: 'google_drive' | 'google_calendar' | 'outlook' | 'slack' | 'teams' | 'webhook' | 'public_api';
  status: 'not_connected' | 'connected' | 'expired' | 'error'; scopes: string[];
  connectedBy: string | null; connectedAt: string | null; lastError: string | null;
  metadata: Record<string, unknown>; updatedAt: string;
}

// ---- Stage 3 additions ----
export interface PlanLimits {
  members: number; rooms: number; workspaces: number; concurrentUsers: number;
  recordingMinutes: number; storageGb: number; meetingsPerMonth: number;
}
export interface Plan {
  id: string; name: string; description: string; interval: 'monthly' | 'annual';
  priceCents: number; currency: string; features: string[]; featureKeys?: string[];
  limits: PlanLimits; status: string;
}
export interface Subscription {
  id: string; organizationId: string; planId: string; interval?: 'monthly' | 'annual';
  status: 'trialing' | 'active' | 'past_due' | 'grace' | 'cancelled';
  trialEndsAt: string | null; currentPeriodStart: string; currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean; graceUntil: string | null;
}
export interface Invoice {
  id: string; organizationId: string; subscriptionId: string; amountCents: number;
  currency: string; status: string; periodStart: string; periodEnd: string;
  providerEventId: string | null; createdAt: string;
}
export interface Entitlements {
  planId: string | null; planName: string; status: string; limits: PlanLimits;
  usage: Record<string, number>; remaining: Record<string, number>; features?: string[];
}
export interface Channel {
  id: string; organizationId: string; name: string;
  scope: 'organization' | 'team' | 'room'; scopeId: string | null;
  createdBy: string; createdAt: string;
}
export interface ChatMessage {
  id: string; organizationId: string; channelId: string | null; directUserId: string | null;
  senderUserId: string; body: string; readBy: string[]; createdAt: string;
}
export interface NotificationItem {
  id: string; organizationId: string; userId: string | null; type: string;
  title: string; body: string; readAt: string | null; createdAt: string;
}
export interface AiInsight {
  id: string; organizationId: string; meetingId: string | null;
  kind: 'summary' | 'highlight' | 'insight'; content: string; provider: string; createdAt: string;
}
export interface AvatarConfig {
  userId: string; organizationId: string; character: string; outfitColor: string;
  accessory: string | null; updatedAt: string | null;
}
export interface WorkspaceTemplate {
  id: string; organizationId: string; name: string;
  layout: { rooms: Array<{
    name: string; kind: string; privacy?: 'public' | 'private';
    bounds: { x: number; y: number; w: number; h: number };
    color: string; capacity: number; allowedRoles: Role[];
  }> };
  createdAt: string;
}
export interface AdminOrganization {
  id: string; name: string; slug: string; status: string; createdAt: string;
  memberCount: number; activeSessions: number;
  entitlements: { planName: string; status: string; usage: Record<string, number>; remaining: Record<string, number> };
}
export interface UtilizationRoom {
  id: string; name: string; scheduledHours: number; meetingCount: number; attendanceSessions: number;
}
export interface UtilizationWorkspace { id: string; name: string; rooms: UtilizationRoom[] }
export interface MeetingAnalytics {
  totals: { meetings: number; live: number; ended: number; minutes: number };
  byDay: Array<{ day: string; count: number; minutes: number }>;
}
export interface ComparisonData {
  current: { attendanceSessions: number; avgConnectedSeconds: number; meetings: number };
  previous: { attendanceSessions: number; avgConnectedSeconds: number; meetings: number };
  deltas: { attendanceSessions: number; avgConnectedSeconds: number; meetings: number };
}
