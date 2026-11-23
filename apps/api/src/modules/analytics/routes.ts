import { Router } from 'express';
import { inOrg, store } from '../../common/store.js';
import { getAuth, requireOrg, requirePermission, scopedUserIds } from '../../common/middleware.js';
import { getEntitlements } from '../billing/entitlements.js';

export const analyticsRouter = Router({ mergeParams: true });

analyticsRouter.use(requireOrg);
analyticsRouter.use(requirePermission('report:read'));

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

analyticsRouter.get('/utilization', (req, res) => {
  const orgId = (req.params as { orgId: string }).orgId;
  const workspaces = store.read((state) => {
    const orgWorkspaces = inOrg(state.workspaces, orgId);
    const orgRooms = inOrg(state.rooms, orgId);
    const orgSessions = inOrg(state.scheduledSessions, orgId);
    const orgMeetings = inOrg(state.meetings, orgId);
    const orgAttendance = inOrg(state.attendanceSessions, orgId);

    return orgWorkspaces.map((workspace) => {
      // Scheduled sessions carry a workspaceId but no roomId, so their time is
      // reported for every room in that workspace; meetings are room-specific.
      const sessions = orgSessions.filter((session) => session.workspaceId === workspace.id);
      const scheduledIds = new Set(sessions.map((session) => session.id));
      const scheduledHours = sessions.reduce((total, session) => {
        const duration = Date.parse(session.endsAt) - Date.parse(session.startsAt);
        return total + (Number.isFinite(duration) ? Math.max(0, duration) / HOUR_MS : 0);
      }, 0);

      return {
        id: workspace.id,
        name: workspace.name,
        rooms: orgRooms.filter((room) => room.workspaceId === workspace.id).map((room) => ({
          id: room.id,
          name: room.name,
          scheduledHours: Math.round(scheduledHours * 100) / 100,
          meetingCount: orgMeetings.filter((meeting) => meeting.roomId === room.id).length,
          attendanceSessions: orgAttendance.filter((item) => scheduledIds.has(item.scheduledSessionId)).length,
        })),
      };
    });
  });
  res.json({ workspaces });
});

analyticsRouter.get('/meetings', (req, res) => {
  const orgId = (req.params as { orgId: string }).orgId;
  const result = store.read((state) => {
    const meetings = inOrg(state.meetings, orgId);
    const minutesOf = (meeting: typeof meetings[number]): number => {
      if (!meeting.startedAt || !meeting.endedAt) return 0;
      const duration = Date.parse(meeting.endedAt) - Date.parse(meeting.startedAt);
      return Number.isFinite(duration) ? Math.max(0, duration / 60_000) : 0;
    };
    const totals = {
      meetings: meetings.length,
      live: meetings.filter((meeting) => meeting.status === 'live').length,
      ended: meetings.filter((meeting) => meeting.status === 'ended').length,
      minutes: Math.round(meetings.reduce((total, meeting) => total + minutesOf(meeting), 0)),
    };
    const byDay = new Map<string, { day: string; count: number; minutes: number }>();
    for (const meeting of meetings) {
      const day = (meeting.startedAt ?? meeting.createdAt).slice(0, 10);
      const entry = byDay.get(day) ?? { day, count: 0, minutes: 0 };
      entry.count += 1;
      entry.minutes += Math.round(minutesOf(meeting));
      byDay.set(day, entry);
    }
    return {
      totals,
      byDay: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
    };
  });
  res.json(result);
});

analyticsRouter.get('/comparisons', (req, res) => {
  const auth = getAuth(req)!;
  const orgId = (req.params as { orgId: string }).orgId;
  const visibleUserIds = scopedUserIds(auth, orgId);
  const now = Date.now();
  const currentFrom = now - 7 * DAY_MS;
  const previousFrom = now - 14 * DAY_MS;

  const result = store.read((state) => {
    const attendance = inOrg(state.attendanceSessions, orgId)
      .filter((item) => !visibleUserIds || visibleUserIds.has(item.userId));
    const meetings = inOrg(state.meetings, orgId);
    const inWindow = (at: string, from: number, to: number): boolean => {
      const time = Date.parse(at);
      return Number.isFinite(time) && time >= from && time < to;
    };
    const statsFor = (from: number, to: number) => {
      const sessions = attendance.filter((item) => inWindow(item.createdAt, from, to));
      const meetingCount = meetings.filter((item) => inWindow(item.createdAt, from, to)).length;
      const seconds = sessions.reduce((total, item) => total + item.confirmedConnectedSeconds, 0);
      return {
        attendanceSessions: sessions.length,
        avgConnectedSeconds: sessions.length ? Math.round(seconds / sessions.length) : 0,
        meetings: meetingCount,
      };
    };
    const current = statsFor(currentFrom, now);
    const previous = statsFor(previousFrom, currentFrom);
    return {
      current,
      previous,
      deltas: {
        attendanceSessions: current.attendanceSessions - previous.attendanceSessions,
        avgConnectedSeconds: current.avgConnectedSeconds - previous.avgConnectedSeconds,
        meetings: current.meetings - previous.meetings,
      },
    };
  });
  res.json(result);
});

analyticsRouter.get('/usage', (req, res) => {
  const orgId = (req.params as { orgId: string }).orgId;
  const result = store.read((state) => {
    const entitlements = getEntitlements(state, orgId);
    return {
      usage: inOrg(state.usageRecords, orgId)
        .map((record) => ({ metric: record.metric, value: record.value, at: record.at }))
        .sort((a, b) => b.at.localeCompare(a.at)),
      entitlements: {
        limits: entitlements.limits,
        usage: entitlements.usage,
        remaining: entitlements.remaining,
      },
    };
  });
  res.json(result);
});
