import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { store, findInOrg } from '../../common/store.js';
import {
  asyncRoute, getAuth, logAudit, requireOrg, requirePermission, scopedUserIds,
} from '../../common/middleware.js';
import { badRequest } from '../../common/errors.js';
import { recordAttendanceEvent } from './service.js';
import { finalizeAbsences } from './jobs.js';
import type { AttendanceEventType } from '../../domain/types.js';

export const attendanceRouter = Router({ mergeParams: true });

attendanceRouter.use(requireOrg);

attendanceRouter.get('/', requirePermission('attendance:read'), (req, res) => {
  const auth = getAuth(req)!;
  const from = typeof req.query.from === 'string' ? req.query.from : '';
  const to = typeof req.query.to === 'string' ? req.query.to : '';
  const userId = typeof req.query.userId === 'string' ? req.query.userId : '';
  const visible = scopedUserIds(auth, req.params.orgId!);
  const sessions = store.read((state) => state.attendanceSessions
    .filter((s) => s.organizationId === req.params.orgId)
    .filter((s) => !visible || visible.has(s.userId))
    .filter((s) => !userId || s.userId === userId)
    .filter((s) => {
      const scheduled = state.scheduledSessions.find((x) => x.id === s.scheduledSessionId);
      const day = scheduled?.startsAt.slice(0, 10) ?? s.createdAt.slice(0, 10);
      return (!from || day >= from) && (!to || day <= to);
    })
    .map((s) => {
      const scheduled = state.scheduledSessions.find((x) => x.id === s.scheduledSessionId);
      const user = state.users.find((u) => u.id === s.userId);
      const membership = state.memberships.find((m) => m.userId === s.userId && m.organizationId === s.organizationId);
      return { ...s, scheduled, memberName: user?.name ?? 'Unknown', team: membership?.team ?? '—',
        role: membership?.role ?? 'student' };
    })
    .sort((a, b) => (b.scheduled?.startsAt ?? '').localeCompare(a.scheduled?.startsAt ?? '')));
  res.json({ sessions });
});

attendanceRouter.get('/events', requirePermission('attendance:read'), (req, res) => {
  const parsed = z.object({ sessionId: z.string().uuid().optional() })
    .safeParse({ sessionId: req.query.sessionId || undefined });
  if (!parsed.success) throw badRequest('Invalid sessionId');
  const sessionId = parsed.data.sessionId ?? '';
  const visible = scopedUserIds(getAuth(req)!, req.params.orgId!);
  const events = store.read((state) => state.attendanceEvents
    .filter((e) => e.organizationId === req.params.orgId && (!sessionId || e.attendanceSessionId === sessionId))
    .filter((e) => {
      const session = state.attendanceSessions.find((s) => s.id === e.attendanceSessionId);
      return Boolean(session && (!visible || visible.has(session.userId)));
    })
    .sort((a, b) => a.at.localeCompare(b.at)));
  res.json({ events });
});

const eventSchema = z.object({ scheduledSessionId: z.string().uuid().optional() });

async function ingest(req: Request, res: Response, type: AttendanceEventType, source: 'api' | 'manual') {
  const auth = getAuth(req)!;
  const parsed = eventSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw badRequest('Invalid event payload');
  const result = await store.mutate((draft) => recordAttendanceEvent(draft, {
    organizationId: req.params.orgId!, userId: auth.user.id, type, source,
    scheduledSessionId: parsed.data.scheduledSessionId ?? null,
  }));
  if (!result) {
    const finalized = store.read((state) => state.attendanceSessions.some((session) =>
      session.organizationId === req.params.orgId && session.userId === auth.user.id
      && session.finalizedAt && (!parsed.data.scheduledSessionId || session.scheduledSessionId === parsed.data.scheduledSessionId)));
    if (finalized && parsed.data.scheduledSessionId) {
      throw badRequest('This session has already been finalized; check-in is no longer allowed', 'ATTENDANCE_FINALIZED');
    }
    throw badRequest('No active scheduled session was found for this action', 'NO_ACTIVE_SESSION');
  }
  if (type === 'joined') logAuditInBackground(req.params.orgId!, auth.user.id, 'attendance.joined', result.session.id);
  res.json({ session: result.session });
}

// Audit entries for high-frequency events are written in a single mutation below.
function logAuditInBackground(orgId: string, actorId: string, action: string, target: string) {
  void store.mutate((draft) => {
    draft.auditLogs.push({ id: randomUUID(), organizationId: orgId, actorId, action, target, metadata: {}, at: new Date().toISOString() });
  });
}

attendanceRouter.post('/join', requirePermission('attendance:read'), asyncRoute((req, res) =>
  ingest(req, res, 'joined', 'api')));
attendanceRouter.post('/heartbeat', requirePermission('attendance:read'), asyncRoute((req, res) =>
  ingest(req, res, 'heartbeat', 'api')));
attendanceRouter.post('/leave', requirePermission('attendance:read'), asyncRoute((req, res) =>
  ingest(req, res, 'left', 'api')));
attendanceRouter.post('/disconnect', requirePermission('attendance:read'), asyncRoute((req, res) =>
  ingest(req, res, 'disconnected', 'api')));
attendanceRouter.post('/reconnect', requirePermission('attendance:read'), asyncRoute((req, res) =>
  ingest(req, res, 'reconnected', 'api')));
attendanceRouter.post('/break/start', requirePermission('attendance:read'), asyncRoute((req, res) =>
  ingest(req, res, 'break_started', 'api')));
attendanceRouter.post('/break/end', requirePermission('attendance:read'), asyncRoute((req, res) =>
  ingest(req, res, 'break_ended', 'api')));

attendanceRouter.post('/finalize', requirePermission('attendance:correct'), asyncRoute(async (req, res) => {
  const auth = getAuth(req)!;
  const result = await store.mutate((draft) => finalizeAbsences(draft, req.params.orgId!, auth.user.id));
  res.json(result);
}));

attendanceRouter.post('/:id/correct', requirePermission('attendance:correct'), asyncRoute(async (req, res) => {
  const parsed = z.object({
    reason: z.string().min(5).max(500),
    status: z.enum(['on_time', 'late', 'absent', 'partial', 'excused', 'pending_review']).optional(),
    note: z.string().max(500).optional(),
  }).safeParse(req.body);
  if (!parsed.success) throw badRequest('A reason of at least 5 characters is required');
  const auth = getAuth(req)!;
  const updated = await store.mutate((draft) => {
    const session = findInOrg(draft.attendanceSessions, req.params.orgId, req.params.id);
    if (!session) throw badRequest('Attendance session not found', 'NOT_FOUND');
    const before = { ...session };
    if (parsed.data.status) session.status = parsed.data.status;
    if (parsed.data.note) session.note = parsed.data.note;
    session.finalizedAt = new Date().toISOString();
    draft.attendanceChanges.push({
      id: randomUUID(), organizationId: session.organizationId, attendanceSessionId: session.id,
      actorId: auth.user.id, reason: parsed.data.reason,
      before: { status: before.status, note: before.note },
      after: { status: session.status, note: session.note }, at: new Date().toISOString(),
    });
    draft.attendanceEvents.push({
      id: randomUUID(), organizationId: session.organizationId, attendanceSessionId: session.id,
      scheduledSessionId: session.scheduledSessionId, userId: session.userId,
      type: 'manual_adjustment', at: new Date().toISOString(), source: 'manual',
      metadata: { reason: parsed.data.reason, actorId: auth.user.id },
    });
    logAudit(draft, auth, 'attendance.corrected', session.id, { reason: parsed.data.reason, before: before.status, after: session.status });
    return session;
  });
  res.json({ session: updated });
}));

attendanceRouter.get('/:id/history', requirePermission('attendance:read'), (req, res) => {
  const visible = scopedUserIds(getAuth(req)!, req.params.orgId!);
  const history = store.read((state) => {
    const session = findInOrg(state.attendanceSessions, req.params.orgId, req.params.id);
    if (!session || (visible && !visible.has(session.userId))) return [];
    return state.attendanceChanges
      .filter((c) => c.organizationId === req.params.orgId && c.attendanceSessionId === req.params.id)
      .sort((a, b) => b.at.localeCompare(a.at));
  });
  res.json({ history });
});
