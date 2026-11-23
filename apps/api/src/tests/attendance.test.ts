import { describe, expect, it } from 'vitest';
import { calculateAttendance, type AttendancePolicy } from '../domain/attendance.js';
import type { AttendanceEvent, AttendanceEventType } from '../domain/types.js';

// Pure domain calculation only: these examples exercise local TypeScript logic and
// never touch a database. They are NOT a PostgreSQL verification.
const policy: AttendancePolicy = {
  graceMinutes: 10,
  heartbeatSeconds: 60,
  minimumMinutes: 60,
  verificationWindowMinutes: 15,
};

const scheduled = {
  startsAt: '2026-03-02T06:00:00.000Z',
  endsAt: '2026-03-02T07:00:00.000Z',
  graceMinutes: 10,
  minimumMinutes: 60,
};

const event = (id: string, type: AttendanceEventType, at: string): AttendanceEvent => ({
  id,
  organizationId: 'org-test',
  attendanceSessionId: 'attendance-test',
  scheduledSessionId: 'session-test',
  userId: 'user-test',
  type,
  at,
  source: 'api',
});

const later = new Date('2026-03-02T07:30:00.000Z');

describe('calculateAttendance (pure, local logic; not PostgreSQL)', () => {
  it('treats a 06:07 arrival with a 10-minute grace period as on_time', () => {
    const result = calculateAttendance([
      event('e1', 'joined', '2026-03-02T06:07:00.000Z'),
      event('e2', 'left', '2026-03-02T07:07:00.000Z'),
    ], scheduled, policy, later);

    expect(result.status).toBe('on_time');
    expect(result.rawLatenessSeconds).toBe(7 * 60);
    expect(result.countedLatenessSeconds).toBe(0);
    expect(result.confirmedConnectedSeconds).toBe(60 * 60);
    expect(result.firstJoin).toBe('2026-03-02T06:07:00.000Z');
    expect(result.lastLeave).toBe('2026-03-02T07:07:00.000Z');
  });

  it('counts only 5 minutes of lateness for a 06:15 arrival', () => {
    const result = calculateAttendance([
      event('e1', 'joined', '2026-03-02T06:15:00.000Z'),
      event('e2', 'left', '2026-03-02T07:15:00.000Z'),
    ], scheduled, policy, later);

    expect(result.status).toBe('late');
    expect(result.rawLatenessSeconds).toBe(15 * 60);
    expect(result.countedLatenessSeconds).toBe(5 * 60);
    expect(result.confirmedConnectedSeconds).toBe(60 * 60);
  });

  it('does not double-count connected time across a disconnect/reconnect', () => {
    const result = calculateAttendance([
      event('e1', 'joined', '2026-03-02T06:00:00.000Z'),
      event('e2', 'disconnected', '2026-03-02T06:30:00.000Z'),
      event('e3', 'reconnected', '2026-03-02T07:00:00.000Z'),
      event('e4', 'left', '2026-03-02T07:30:00.000Z'),
    ], scheduled, policy, later);

    // Wall-clock span is 90 minutes, but only two 30-minute segments are connected.
    expect(result.confirmedConnectedSeconds).toBe(60 * 60);
    expect(result.status).toBe('on_time');
  });

  it('excludes break intervals from confirmed connected time', () => {
    const shortSession = { ...scheduled, minimumMinutes: 30 };
    const shortPolicy = { ...policy, minimumMinutes: 30 };
    const result = calculateAttendance([
      event('e1', 'joined', '2026-03-02T06:00:00.000Z'),
      event('e2', 'break_started', '2026-03-02T06:20:00.000Z'),
      event('e3', 'break_ended', '2026-03-02T06:40:00.000Z'),
      event('e4', 'left', '2026-03-02T07:00:00.000Z'),
    ], shortSession, shortPolicy, later);

    expect(result.breakSeconds).toBe(20 * 60);
    expect(result.confirmedConnectedSeconds).toBe(40 * 60);
    expect(result.status).toBe('on_time');

    const withFullMinimum = calculateAttendance([
      event('e1', 'joined', '2026-03-02T06:00:00.000Z'),
      event('e2', 'break_started', '2026-03-02T06:20:00.000Z'),
      event('e3', 'break_ended', '2026-03-02T06:40:00.000Z'),
      event('e4', 'left', '2026-03-02T07:00:00.000Z'),
    ], scheduled, policy, later);
    expect(withFullMinimum.status).toBe('partial');
  });

  it('marks an absent session when no join arrives before the verification window closes', () => {
    const afterWindow = new Date('2026-03-02T07:16:00.000Z');
    const noEvents = calculateAttendance([], scheduled, policy, afterWindow);
    expect(noEvents.status).toBe('absent');
    expect(noEvents.firstJoin).toBeNull();
    expect(noEvents.countedLatenessSeconds).toBe(0);

    // A heartbeat without a join is not evidence of a verified arrival.
    const heartbeatOnly = calculateAttendance([
      event('e1', 'heartbeat', '2026-03-02T06:05:00.000Z'),
    ], scheduled, policy, afterWindow);
    expect(heartbeatOnly.status).toBe('absent');
    expect(heartbeatOnly.firstJoin).toBeNull();

    const withinWindow = calculateAttendance([], scheduled, policy, new Date('2026-03-02T07:14:00.000Z'));
    expect(withinWindow.status).toBe('pending_review');
  });

  it('ignores duplicate event ids and clamps open segments at the last heartbeat', () => {
    const deduplicated = calculateAttendance([
      event('same', 'joined', '2026-03-02T06:00:00.000Z'),
      event('same', 'joined', '2026-03-02T06:30:00.000Z'),
      event('left', 'left', '2026-03-02T07:00:00.000Z'),
    ], scheduled, policy, later);
    expect(deduplicated.confirmedConnectedSeconds).toBe(60 * 60);

    const timedOut = calculateAttendance([
      event('j', 'joined', '2026-03-02T06:00:00.000Z'),
      event('h', 'heartbeat', '2026-03-02T06:10:00.000Z'),
      event('l', 'left', '2026-03-02T07:00:00.000Z'),
    ], scheduled, policy, later);
    expect(timedOut.confirmedConnectedSeconds).toBe(11 * 60);
    expect(timedOut.lastHeartbeat).toBe('2026-03-02T06:10:00.000Z');
    expect(timedOut.status).toBe('partial');
  });
});
