import { randomUUID } from 'node:crypto';
import { calculateAttendance } from '../../domain/attendance.js';
import type {
  AttendanceEventType, AttendanceSession, DbState, ScheduledSession,
} from '../../domain/types.js';

export interface RecordEventInput {
  organizationId: string;
  userId: string;
  type: AttendanceEventType;
  source: 'world' | 'api' | 'manual';
  scheduledSessionId?: string | null;
  at?: string;
  metadata?: Record<string, unknown>;
}

export interface RecordEventResult {
  session: AttendanceSession;
  eventId: string;
  created: boolean;
}

/**
 * Single writer for all attendance events. Called by REST routes and the world
 * server. Every timestamp originates on the server. Duplicate event IDs are
 * ignored by the calculation layer; multiple tabs share one attendance session.
 */
export function recordAttendanceEvent(draft: DbState, input: RecordEventInput): RecordEventResult | null {
  const at = input.at ?? new Date().toISOString();
  let session: AttendanceSession | undefined;

  if (input.scheduledSessionId) {
    const scheduled = draft.scheduledSessions.find(
      (s) => s.id === input.scheduledSessionId && s.organizationId === input.organizationId && s.userId === input.userId,
    );
    if (!scheduled) return null;
    session = draft.attendanceSessions.find(
      (s) => s.scheduledSessionId === input.scheduledSessionId
        && s.organizationId === input.organizationId
        && s.userId === input.userId,
    );
  }
  if (!session) {
    session = [...draft.attendanceSessions]
      .reverse()
      .find((s) => s.organizationId === input.organizationId && s.userId === input.userId && !s.finalizedAt
        && new Date(s.createdAt).getTime() > Date.now() - 12 * 3_600_000);
  }
  if (session?.finalizedAt) return null;
  if (!session) {
    let scheduled: ScheduledSession | undefined;
    if (input.scheduledSessionId) {
      scheduled = draft.scheduledSessions.find(
        (s) => s.id === input.scheduledSessionId && s.organizationId === input.organizationId && s.userId === input.userId,
      );
    } else {
      scheduled = draft.scheduledSessions
        .filter((s) => s.organizationId === input.organizationId && s.userId === input.userId
          && s.status === 'scheduled' && new Date(s.startsAt).getTime() <= Date.now()
          && new Date(s.endsAt).getTime() + 20 * 60_000 >= Date.now())
        .sort((a, b) => b.startsAt.localeCompare(a.startsAt))[0];
    }
    if (!scheduled) return null;
    session = {
      id: randomUUID(), organizationId: input.organizationId, scheduledSessionId: scheduled.id,
      userId: input.userId, firstJoin: null, lastLeave: null, lastHeartbeat: null,
      status: 'pending_review', rawLatenessSeconds: 0, countedLatenessSeconds: 0,
      confirmedConnectedSeconds: 0, breakSeconds: 0, earlyLeaveSeconds: 0,
      finalizedAt: null, note: '', createdAt: at,
    };
    draft.attendanceSessions.push(session);
  }

  const eventId = randomUUID();
  draft.attendanceEvents.push({
    id: eventId, organizationId: input.organizationId, attendanceSessionId: session.id,
    scheduledSessionId: session.scheduledSessionId, userId: input.userId,
    type: input.type, at, source: input.source, metadata: input.metadata,
  });
  recalculate(draft, session.id);
  return { session: draft.attendanceSessions.find((s) => s.id === session!.id)!, eventId, created: true };
}

/**
 * World activity can belong to several overlapping scheduled sessions (for
 * example a shift and a mentor session at the same time). Record the same
 * server-timestamped event once for every still-open session instead of
 * arbitrarily attaching it to just the newest one.
 */
export function recordWorldAttendanceEvent(draft: DbState, input: Omit<RecordEventInput, 'scheduledSessionId'>): void {
  const now = Date.now();
  const active = draft.scheduledSessions
    .filter((s) => s.organizationId === input.organizationId && s.userId === input.userId
      && s.status === 'scheduled' && new Date(s.startsAt).getTime() <= now
      && new Date(s.endsAt).getTime() + 20 * 60_000 >= now)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  if (!active.length) {
    recordAttendanceEvent(draft, input);
    return;
  }
  for (const scheduled of active) {
    recordAttendanceEvent(draft, { ...input, scheduledSessionId: scheduled.id });
  }
}

export function recalculate(draft: DbState, attendanceSessionId: string): AttendanceSession | null {
  const session = draft.attendanceSessions.find((s) => s.id === attendanceSessionId);
  if (!session) return null;
  const scheduled = draft.scheduledSessions.find((s) => s.id === session.scheduledSessionId);
  const org = draft.organizations.find((o) => o.id === session.organizationId);
  if (!scheduled || !org) return session;
  const events = draft.attendanceEvents.filter((e) => e.attendanceSessionId === session.id);
  const policy = scheduled.policySnapshot ?? {};
  const asNumber = (key: string, fallback: number): number => {
    const value = policy[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  };
  const result = calculateAttendance(events, scheduled, {
    graceMinutes: asNumber('graceMinutes', scheduled.graceMinutes),
    heartbeatSeconds: asNumber('heartbeatSeconds', org.settings.heartbeatSeconds),
    minimumMinutes: asNumber('minimumMinutes', scheduled.minimumMinutes),
    verificationWindowMinutes: asNumber('verificationWindowMinutes', org.settings.verificationWindowMinutes),
  });
  session.firstJoin = result.firstJoin;
  session.lastLeave = result.lastLeave;
  session.lastHeartbeat = result.lastHeartbeat;
  session.rawLatenessSeconds = result.rawLatenessSeconds;
  session.countedLatenessSeconds = result.countedLatenessSeconds;
  session.confirmedConnectedSeconds = result.confirmedConnectedSeconds;
  session.breakSeconds = result.breakSeconds;
  session.earlyLeaveSeconds = result.earlyLeaveSeconds;
  if (!session.finalizedAt) session.status = result.status;
  return session;
}
