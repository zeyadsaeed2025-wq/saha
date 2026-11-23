import { Router } from 'express';
import { store } from '../../common/store.js';
import { csvCell } from '../../common/security.js';
import { getAuth, requireOrg, requirePermission, scopedUserIds } from '../../common/middleware.js';
import { formatDuration } from '../../common/time.js';

export const reportsRouter = Router({ mergeParams: true });

reportsRouter.use(requireOrg);

interface Filters {
  from: string;
  to: string;
  team: string;
  role: string;
  memberId: string;
  status: string;
  workspaceId: string;
}

function filtersOf(query: Record<string, unknown>): Filters {
  const get = (key: keyof Filters) => typeof query[key] === 'string' ? String(query[key]) : '';
  return {
    from: get('from'), to: get('to'), team: get('team'), role: get('role'),
    memberId: get('memberId'), status: get('status'), workspaceId: get('workspaceId'),
  };
}

function rowsFor(orgId: string, filters: Filters, visibleUserIds: Set<string> | null) {
  return store.read((state) => {
    const scheduled = state.scheduledSessions.filter((s) => s.organizationId === orgId);
    const byId = new Map(scheduled.map((s) => [s.id, s]));
    return state.attendanceSessions
      .filter((s) => s.organizationId === orgId)
      .filter((s) => !visibleUserIds || visibleUserIds.has(s.userId))
      .map((s) => {
        const session = byId.get(s.scheduledSessionId);
        const user = state.users.find((u) => u.id === s.userId);
        const membership = state.memberships.find((m) => m.userId === s.userId && m.organizationId === orgId);
        return {
          id: s.id, userId: s.userId, memberName: user?.name ?? 'Unknown',
          team: membership?.team ?? 'General', role: membership?.role ?? 'student',
          status: s.status, day: (session?.startsAt ?? s.createdAt).slice(0, 10),
          title: session?.title ?? 'Session',
          scheduledMinutes: session ? Math.round((new Date(session.endsAt).getTime() - new Date(session.startsAt).getTime()) / 60000) : 0,
          connectedSeconds: s.confirmedConnectedSeconds,
          countedLatenessSeconds: s.countedLatenessSeconds,
          breakSeconds: s.breakSeconds,
          earlyLeaveSeconds: s.earlyLeaveSeconds,
          workspaceId: session?.workspaceId ?? '',
          note: s.note,
        };
      })
      .filter((r) => !filters.from || r.day >= filters.from)
      .filter((r) => !filters.to || r.day <= filters.to)
      .filter((r) => !filters.team || r.team === filters.team)
      .filter((r) => !filters.role || r.role === filters.role)
      .filter((r) => !filters.memberId || r.userId === filters.memberId)
      .filter((r) => !filters.status || r.status === filters.status)
      .filter((r) => !filters.workspaceId || r.workspaceId === filters.workspaceId)
      .sort((a, b) => b.day.localeCompare(a.day));
  });
}

reportsRouter.get('/summary', requirePermission('report:read'), (req, res) => {
  const filters = filtersOf(req.query as Record<string, unknown>);
  const rows = rowsFor(req.params.orgId, filters, scopedUserIds(getAuth(req)!, req.params.orgId!));
  const counts = { on_time: 0, late: 0, partial: 0, absent: 0, excused: 0, pending_review: 0 } as Record<string, number>;
  for (const row of rows) counts[row.status] = (counts[row.status] ?? 0) + 1;
  const attended = counts.on_time + counts.late + counts.partial;
  const punctualityRate = attended ? Math.round((counts.on_time / attended) * 1000) / 10 : 0;
  const connected = rows.reduce((sum, r) => sum + r.connectedSeconds, 0);
  const teams = new Map<string, { team: string; total: number; onTime: number; connectedSeconds: number }>();
  for (const row of rows) {
    const entry = teams.get(row.team) ?? { team: row.team, total: 0, onTime: 0, connectedSeconds: 0 };
    entry.total += 1;
    if (row.status === 'on_time') entry.onTime += 1;
    entry.connectedSeconds += row.connectedSeconds;
    teams.set(row.team, entry);
  }
  const byDay = new Map<string, { day: string; total: number; onTime: number; connectedMinutes: number }>();
  for (const row of rows) {
    const entry = byDay.get(row.day) ?? { day: row.day, total: 0, onTime: 0, connectedMinutes: 0 };
    entry.total += 1;
    if (row.status === 'on_time') entry.onTime += 1;
    entry.connectedMinutes += Math.round(row.connectedSeconds / 60);
    byDay.set(row.day, entry);
  }
  res.json({
    summary: {
      expected: rows.length,
      present: attended,
      onTime: counts.on_time,
      late: counts.late,
      partial: counts.partial,
      absent: counts.absent,
      excused: counts.excused,
      pendingReview: counts.pending_review,
      confirmedConnectedSeconds: connected,
      confirmedConnectedLabel: formatDuration(connected),
      punctualityRate,
      exceptions: counts.partial + counts.pending_review,
    },
    teams: [...teams.values()].map((t) => ({ ...t, punctualityRate: t.total ? Math.round((t.onTime / t.total) * 1000) / 10 : 0 })),
    trend: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
  });
});

reportsRouter.get('/members', requirePermission('report:read'), (req, res) => {
  const rows = rowsFor(req.params.orgId, filtersOf(req.query as Record<string, unknown>),
    scopedUserIds(getAuth(req)!, req.params.orgId!));
  const grouped = new Map<string, {
    userId: string; memberName: string; team: string; role: string;
    scheduled: number; attended: number; onTime: number; late: number; absent: number;
    connectedSeconds: number; latenessSeconds: number;
  }>();
  for (const row of rows) {
    const entry = grouped.get(row.userId) ?? {
      userId: row.userId, memberName: row.memberName, team: row.team, role: row.role,
      scheduled: 0, attended: 0, onTime: 0, late: 0, absent: 0, connectedSeconds: 0, latenessSeconds: 0,
    };
    entry.scheduled += 1;
    if (row.status !== 'absent') entry.attended += 1;
    if (row.status === 'on_time') entry.onTime += 1;
    if (row.status === 'late') entry.late += 1;
    if (row.status === 'absent') entry.absent += 1;
    entry.connectedSeconds += row.connectedSeconds;
    entry.latenessSeconds += row.countedLatenessSeconds;
    grouped.set(row.userId, entry);
  }
  const members = [...grouped.values()].map((m) => ({
    ...m,
    punctualityRate: m.attended ? Math.round((m.onTime / m.attended) * 1000) / 10 : 0,
    connectedLabel: formatDuration(m.connectedSeconds),
  })).sort((a, b) => b.scheduled - a.scheduled);
  res.json({ members });
});

reportsRouter.get('/sessions', requirePermission('report:read'), (req, res) => {
  const sessions = rowsFor(req.params.orgId, filtersOf(req.query as Record<string, unknown>),
    scopedUserIds(getAuth(req)!, req.params.orgId!));
  res.json({ sessions });
});

reportsRouter.get('/export.csv', requirePermission('report:export'), (req, res) => {
  const rows = rowsFor(req.params.orgId, filtersOf(req.query as Record<string, unknown>),
    scopedUserIds(getAuth(req)!, req.params.orgId!));
  const header = ['Date', 'Member', 'Team', 'Role', 'Session', 'Status', 'Scheduled (min)',
    'Confirmed connected (min)', 'Counted lateness (min)', 'Break (min)', 'Early leave (min)', 'Note'];
  const lines = [header.map(csvCell).join(','), ...rows.map((r) => [
    r.day, r.memberName, r.team, r.role, r.title, r.status, r.scheduledMinutes,
    Math.round(r.connectedSeconds / 60), Math.round(r.countedLatenessSeconds / 60),
    Math.round(r.breakSeconds / 60), Math.round(r.earlyLeaveSeconds / 60), r.note,
  ].map(csvCell).join(','))];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="saha-attendance-${req.params.orgId.slice(0, 8)}.csv"`);
  res.send(`\uFEFF${lines.join('\r\n')}`);
});
