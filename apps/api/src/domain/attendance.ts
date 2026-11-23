import type { AttendanceEvent, ScheduledSession } from './types.js';

export interface AttendancePolicy {
  graceMinutes: number;
  heartbeatSeconds: number;
  minimumMinutes: number;
  verificationWindowMinutes: number;
}

export interface AttendanceResult {
  status: 'on_time' | 'late' | 'absent' | 'partial' | 'excused' | 'pending_review';
  rawLatenessSeconds: number;
  countedLatenessSeconds: number;
  confirmedConnectedSeconds: number;
  breakSeconds: number;
  earlyLeaveSeconds: number;
  firstJoin: string | null;
  lastLeave: string | null;
  lastHeartbeat: string | null;
}

const ms = (iso: string) => new Date(iso).getTime();

/**
 * Pure, server-side attendance calculation.
 * - Uses server event timestamps only (client clocks are never trusted).
 * - Disconnected time is not counted; reconnects never double-count.
 * - Connected time is evidence of connection, never of productive work.
 */
export function calculateAttendance(
  events: AttendanceEvent[],
  scheduled: Pick<ScheduledSession, 'startsAt' | 'endsAt' | 'graceMinutes' | 'minimumMinutes'>,
  policy: AttendancePolicy,
  now: Date = new Date(),
): AttendanceResult {
  const ordered = [...events].sort((a, b) => ms(a.at) - ms(b.at) || a.id.localeCompare(b.id));
  const seen = new Set<string>();
  const unique = ordered.filter((event) => {
    if (seen.has(event.id)) return false;
    seen.add(event.id);
    return true;
  });

  const firstJoinEvent = unique.find((event) => event.type === 'joined');
  const firstJoin = firstJoinEvent?.at ?? null;
  const lastLeaveEvent = [...unique].reverse().find((event) => event.type === 'left');
  const lastLeave = lastLeaveEvent?.at ?? null;
  const heartbeats = unique.filter((event) => event.type === 'heartbeat');
  const lastHeartbeat = heartbeats.at(-1)?.at ?? null;

  const rawLatenessSeconds = firstJoin ? Math.max(0, ms(firstJoin) - ms(scheduled.startsAt)) / 1000 : 0;
  const countedLatenessSeconds = Math.max(0, rawLatenessSeconds - scheduled.graceMinutes * 60);

  // Build connected segments from join/reconnect → disconnect/left.
  const segments: Array<{ start: number; end: number }> = [];
  let open: { start: number; lastHeartbeat: number | null; hasHeartbeat: boolean } | null = null;
  const timeoutMs = policy.heartbeatSeconds * 1000;
  const close = (at: number) => {
    if (!open) return;
    let end = at;
    if (open.hasHeartbeat && open.lastHeartbeat !== null) {
      end = Math.min(end, open.lastHeartbeat + timeoutMs);
    }
    if (end > open.start) segments.push({ start: open.start, end });
    open = null;
  };
  for (const event of unique) {
    const at = ms(event.at);
    switch (event.type) {
      case 'joined':
      case 'reconnected':
        if (!open) open = { start: at, lastHeartbeat: null, hasHeartbeat: false };
        break;
      case 'heartbeat':
        if (open) { open.lastHeartbeat = at; open.hasHeartbeat = true; }
        break;
      case 'disconnected':
      case 'left':
        close(at);
        break;
      default:
        break;
    }
  }
  if (open) close(ms(lastHeartbeat ?? now.toISOString()));

  // Break intervals are excluded from connected time.
  const breaks: Array<{ start: number; end: number }> = [];
  let breakStart: number | null = null;
  for (const event of unique) {
    if (event.type === 'break_started') breakStart = ms(event.at);
    if (event.type === 'break_ended' && breakStart !== null) {
      breaks.push({ start: breakStart, end: Math.max(breakStart, ms(event.at)) });
      breakStart = null;
    }
  }
  if (breakStart !== null) breaks.push({ start: breakStart, end: now.getTime() });

  let connectedMs = segments.reduce((sum, s) => sum + (s.end - s.start), 0);
  let breakMs = 0;
  for (const b of breaks) {
    const overlap = segments.reduce((sum, s) =>
      sum + Math.max(0, Math.min(s.end, b.end) - Math.max(s.start, b.start)), 0);
    breakMs += overlap;
    connectedMs -= overlap;
  }
  connectedMs = Math.max(0, connectedMs);
  breakMs = Math.max(0, breakMs);

  const scheduledEnd = ms(scheduled.endsAt);
  const earlyLeaveSeconds = lastLeave ? Math.max(0, (scheduledEnd - ms(lastLeave)) / 1000) : 0;
  const verificationEnd = scheduledEnd + policy.verificationWindowMinutes * 60_000;
  const minSeconds = scheduled.minimumMinutes * 60;

  let status: AttendanceResult['status'];
  if (!firstJoin) {
    status = now.getTime() >= verificationEnd ? 'absent' : 'pending_review';
  } else if (connectedMs / 1000 < minSeconds) {
    status = 'partial';
  } else if (countedLatenessSeconds > 0) {
    status = 'late';
  } else {
    status = 'on_time';
  }

  return {
    status,
    rawLatenessSeconds,
    countedLatenessSeconds,
    confirmedConnectedSeconds: connectedMs / 1000,
    breakSeconds: breakMs / 1000,
    earlyLeaveSeconds,
    firstJoin,
    lastLeave,
    lastHeartbeat,
  };
}
