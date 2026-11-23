import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { store, findInOrg } from '../../common/store.js';
import { addDays, dayOfWeek, zonedDateTimeToUtc } from '../../common/time.js';
import { isValidTimeZone } from '../../common/security.js';
import { asyncRoute, getAuth, logAudit, requireOrg, requirePermission } from '../../common/middleware.js';
import { badRequest, forbidden } from '../../common/errors.js';
import type { ScheduleRule } from '../../domain/types.js';

export const schedulesRouter = Router({ mergeParams: true });

schedulesRouter.use(requireOrg);

const timeOfDay = z.string().regex(/^\d{2}:\d{2}$/).refine((value) => {
  const [hours, minutes] = value.split(':').map(Number);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}, 'Invalid time of day');

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Invalid calendar date');

const ruleSchema = z.object({
  userId: z.string().uuid(),
  kind: z.enum(['shift', 'mentor_session']),
  title: z.string().min(2).max(100),
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7)
    .refine((days) => new Set(days).size === days.length, 'Duplicate days are not allowed'),
  startTime: timeOfDay,
  endTime: timeOfDay,
  timezone: z.string().min(3).max(64).refine(isValidTimeZone, 'Invalid IANA timezone'),
  graceMinutes: z.number().int().min(0).max(120).default(10),
  minimumMinutes: z.number().int().min(1).max(600).default(60),
  exceptions: z.array(z.object({
    date: isoDate,
    type: z.enum(['holiday', 'approved_absence', 'extra_session']),
    reason: z.string().max(200).default(''),
  })).max(100).default([]),
});

type RuleInput = z.infer<typeof ruleSchema>;

/** Shared POST/PATCH validation: the full rule must always be valid after a change. */
function validateRule(input: RuleInput, orgId: string, actor: { user: { id: string }; role: string }): void {
  if (!canManage(input.userId, actor)) throw forbidden('You can only manage your own schedule');
  if (input.endTime <= input.startTime) throw badRequest('End time must be after start time');
  const activeMember = store.read((state) => state.memberships.some(
    (m) => m.userId === input.userId && m.organizationId === orgId && m.status === 'active'));
  if (!activeMember) throw badRequest('The selected member is not in this organization', 'NOT_FOUND');
}

function canManage(userId: string, auth: { user: { id: string }; role: string }): boolean {
  return auth.role === 'org_admin' || auth.role === 'super_admin' || userId === auth.user.id;
}

/** Reconcile changed exceptions into already materialized sessions/attendance. */
function syncRuleExceptions(draft: Parameters<Parameters<typeof store.mutate>[0]>[0], rule: ScheduleRule, actorId: string): number {
  let changed = 0;
  for (const exception of rule.exceptions) {
    const starts = draft.scheduledSessions.filter((s) => s.scheduleRuleId === rule.id
      && s.startsAt.slice(0, 10) === exception.date);
    if (exception.type === 'extra_session' && !starts.length) {
      const start = zonedDateTimeToUtc(exception.date, '23:00', rule.timezone);
      draft.scheduledSessions.push({
        id: randomUUID(), organizationId: rule.organizationId, scheduleRuleId: rule.id,
        userId: rule.userId, kind: rule.kind, title: `${rule.title} (extra)`,
        startsAt: start, endsAt: new Date(Date.parse(start) + 3_600_000).toISOString(),
        graceMinutes: rule.graceMinutes, minimumMinutes: rule.minimumMinutes,
        status: 'scheduled', policySnapshot: { ...rule.policySnapshot, exception },
        createdAt: new Date().toISOString(),
      });
      changed += 1;
      continue;
    }
    for (const session of starts) {
      if (exception.type === 'holiday') session.status = 'cancelled';
      if (exception.type === 'approved_absence') session.status = 'excused';
      const attendance = draft.attendanceSessions.find((a) => a.scheduledSessionId === session.id);
      if (attendance && !attendance.finalizedAt) {
        attendance.status = 'excused';
        attendance.finalizedAt = new Date().toISOString();
        attendance.note = `Exception applied: ${exception.type}${exception.reason ? ` — ${exception.reason}` : ''}`;
        changed += 1;
      } else if (session.status !== 'scheduled') {
        changed += 1;
      }
      draft.auditLogs.push({
        id: randomUUID(), organizationId: rule.organizationId, actorId,
        action: 'schedule.exception_synced', target: session.id,
        metadata: { date: exception.date, type: exception.type }, at: new Date().toISOString(),
      });
    }
  }
  return changed;
}

schedulesRouter.get('/', requirePermission('schedule:read'), (req, res) => {
  const schedules = store.read((state) => state.schedules.filter((s) => s.organizationId === req.params.orgId));
  res.json({ schedules });
});

schedulesRouter.post('/', requirePermission('schedule:manage'), asyncRoute(async (req, res) => {
  const parsed = ruleSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest('Invalid schedule details');
  const auth = getAuth(req)!;
  validateRule(parsed.data, req.params.orgId!, auth);

  const created = await store.mutate((draft) => {
    const rule: ScheduleRule = {
      id: randomUUID(), organizationId: req.params.orgId!, ...parsed.data,
      policySnapshot: { ...parsed.data, capturedAt: new Date().toISOString() },
      status: 'active', history: [{ at: new Date().toISOString(), actorId: auth.user.id, note: 'Created' }],
      createdAt: new Date().toISOString(),
    };
    draft.schedules.push(rule);
    logAudit(draft, auth, 'schedule.created', rule.id, { title: rule.title });
    return rule;
  });
  res.status(201).json({ schedule: created });
}));

schedulesRouter.patch('/:id', requirePermission('schedule:manage'), asyncRoute(async (req, res) => {
  const existing = store.read((state) => findInOrg(state.schedules, req.params.orgId, req.params.id));
  if (!existing) throw badRequest('Schedule not found', 'NOT_FOUND');
  // Revalidate the complete rule: partial updates must not leave an invalid
  // combination (e.g. end before start, missing timezone, or a foreign user).
  const parsed = ruleSchema.safeParse({ ...existing, ...(req.body ?? {}) });
  if (!parsed.success) throw badRequest('Invalid schedule update');
  const auth = getAuth(req)!;
  validateRule(parsed.data, req.params.orgId!, auth);
  const updated = await store.mutate((draft) => {
    const rule = findInOrg(draft.schedules, req.params.orgId, req.params.id);
    if (!rule) throw badRequest('Schedule not found', 'NOT_FOUND');
    const before = { ...rule };
    Object.assign(rule, parsed.data);
    rule.history.push({ at: new Date().toISOString(), actorId: auth.user.id, note: 'Updated schedule' });
    const synced = syncRuleExceptions(draft, rule, auth.user.id);
    logAudit(draft, auth, 'schedule.updated', rule.id, { before, after: { ...rule }, synced });
    return rule;
  });
  res.json({ schedule: updated });
}));

/** Materializes recurring rules into concrete UTC sessions for a date range. */
schedulesRouter.post('/:id/generate', requirePermission('schedule:manage'), asyncRoute(async (req, res) => {
  const parsed = z.object({
    from: isoDate,
    to: isoDate,
    workspaceId: z.string().uuid().optional(),
  }).safeParse(req.body);
  if (!parsed.success) throw badRequest('from and to must be valid calendar dates');
  if (parsed.data.to < parsed.data.from) throw badRequest('to must not be before from');
  const spanDays = Math.round((Date.parse(parsed.data.to) - Date.parse(parsed.data.from)) / 86_400_000) + 1;
  if (spanDays > 366) throw badRequest('A generation range cannot exceed 366 days');
  const auth = getAuth(req)!;
  const created = await store.mutate((draft) => {
    const rule = findInOrg(draft.schedules, req.params.orgId, req.params.id);
    if (!rule) throw badRequest('Schedule not found', 'NOT_FOUND');
    if (!canManage(rule.userId, auth)) throw forbidden('You can only manage your own schedule');
    const org = draft.organizations.find((o) => o.id === rule.organizationId);
    if (!org) throw badRequest('Organization not found', 'NOT_FOUND');
    let workspaceId: string | undefined;
    if (parsed.data.workspaceId) {
      const workspace = findInOrg(draft.workspaces, req.params.orgId, parsed.data.workspaceId);
      if (!workspace) throw badRequest('Workspace not found in this organization', 'NOT_FOUND');
      workspaceId = workspace.id;
    } else {
      workspaceId = draft.workspaces.find((w) => w.organizationId === org.id)?.id;
    }
    if (!workspaceId) throw badRequest('No workspace is available for this organization', 'NOT_FOUND');
    const hasSessionAt = (startsAt: string) =>
      draft.scheduledSessions.some((s) => s.scheduleRuleId === rule.id && s.startsAt === startsAt);
    const made: string[] = [];
    for (let date = parsed.data.from; date <= parsed.data.to; date = addDays(date, 1)) {
      if (!rule.days.includes(dayOfWeek(date))) continue;
      // Materialize in the rule's own timezone, not the organization default.
      const start = zonedDateTimeToUtc(date, rule.startTime, rule.timezone);
      const end = zonedDateTimeToUtc(date, rule.endTime, rule.timezone);
      if (hasSessionAt(start)) continue;
      const exception = rule.exceptions.find((e) => e.date === date);
      if (exception?.type === 'holiday') continue;
      const excused = exception?.type === 'approved_absence';
      draft.scheduledSessions.push({
        id: randomUUID(), organizationId: rule.organizationId, scheduleRuleId: rule.id,
        userId: rule.userId, kind: rule.kind, title: rule.title,
        startsAt: start, endsAt: end, workspaceId, graceMinutes: rule.graceMinutes,
        minimumMinutes: rule.minimumMinutes,
        status: excused ? 'excused' : 'scheduled',
        policySnapshot: { ...rule.policySnapshot, exception: exception ?? null },
        createdAt: new Date().toISOString(),
      });
      made.push(start);
      if (exception?.type === 'extra_session' && dayOfWeek(date) !== rule.days[0]) {
        // Give the extra session its own slot so it never collides with the
        // regular session at the same startsAt.
        const extraStart = new Date(Date.parse(end) + 3_600_000).toISOString();
        const extraEnd = new Date(Date.parse(extraStart) + 3_600_000).toISOString();
        if (extraStart !== start && !hasSessionAt(extraStart)) {
          draft.scheduledSessions.push({
            id: randomUUID(), organizationId: rule.organizationId, scheduleRuleId: rule.id,
            userId: rule.userId, kind: rule.kind, title: `${rule.title} (extra)`,
            startsAt: extraStart, endsAt: extraEnd, workspaceId, graceMinutes: rule.graceMinutes,
            minimumMinutes: rule.minimumMinutes, status: 'scheduled',
            policySnapshot: { ...rule.policySnapshot, exception }, createdAt: new Date().toISOString(),
          });
        }
      }
    }
    logAudit(draft, auth, 'schedule.generated', rule.id, { count: made.length });
    return made.length;
  });
  res.json({ created: created, message: `${created} session(s) materialized` });
}));

schedulesRouter.post('/:id/sync-exceptions', requirePermission('schedule:manage'), asyncRoute(async (req, res) => {
  const auth = getAuth(req)!;
  const synced = await store.mutate((draft) => {
    const rule = findInOrg(draft.schedules, req.params.orgId, req.params.id);
    if (!rule) throw badRequest('Schedule not found', 'NOT_FOUND');
    if (!canManage(rule.userId, auth)) throw forbidden('You can only manage your own schedule');
    return syncRuleExceptions(draft, rule, auth.user.id);
  });
  res.json({ synced });
}));

schedulesRouter.post('/sessions/one-off', requirePermission('schedule:manage'), asyncRoute(async (req, res) => {
  const parsed = z.object({
    userId: z.string().uuid(),
    kind: z.enum(['shift', 'mentor_session']),
    title: z.string().min(2).max(100),
    date: isoDate,
    startTime: timeOfDay,
    endTime: timeOfDay,
    timezone: z.string().min(3).max(64).refine(isValidTimeZone, 'Invalid IANA timezone'),
    graceMinutes: z.number().int().min(0).max(120).default(10),
    minimumMinutes: z.number().int().min(1).max(600).default(60),
    workspaceId: z.string().uuid().optional(),
  }).safeParse(req.body);
  if (!parsed.success) throw badRequest('Invalid one-off session details');
  if (parsed.data.endTime <= parsed.data.startTime) throw badRequest('End time must be after start time');
  const auth = getAuth(req)!;
  if (!canManage(parsed.data.userId, auth)) throw forbidden('You can only manage your own schedule');
  const created = await store.mutate((draft) => {
    const orgId = req.params.orgId!;
    const org = draft.organizations.find((o) => o.id === orgId);
    if (!org) throw badRequest('Organization not found', 'NOT_FOUND');
    const activeMember = draft.memberships.some((m) => m.userId === parsed.data.userId && m.organizationId === orgId && m.status === 'active');
    if (!activeMember) throw badRequest('The selected member is not in this organization', 'NOT_FOUND');
    const workspaceId = parsed.data.workspaceId
      ? findInOrg(draft.workspaces, orgId, parsed.data.workspaceId)?.id
      : draft.workspaces.find((w) => w.organizationId === orgId)?.id;
    if (!workspaceId) throw badRequest('No workspace is available for this organization', 'NOT_FOUND');
    const startsAt = zonedDateTimeToUtc(parsed.data.date, parsed.data.startTime, parsed.data.timezone);
    const endsAt = zonedDateTimeToUtc(parsed.data.date, parsed.data.endTime, parsed.data.timezone);
    const session = {
      id: randomUUID(), organizationId: orgId, scheduleRuleId: `one-off:${randomUUID()}`,
      userId: parsed.data.userId, kind: parsed.data.kind, title: parsed.data.title,
      startsAt, endsAt, workspaceId, graceMinutes: parsed.data.graceMinutes,
      minimumMinutes: parsed.data.minimumMinutes, status: 'scheduled' as const,
      policySnapshot: {
        graceMinutes: parsed.data.graceMinutes, minimumMinutes: parsed.data.minimumMinutes,
        heartbeatSeconds: org.settings.heartbeatSeconds,
        verificationWindowMinutes: org.settings.verificationWindowMinutes,
        capturedAt: new Date().toISOString(), source: 'one_off',
      },
      createdAt: new Date().toISOString(),
    };
    draft.scheduledSessions.push(session);
    logAudit(draft, auth, 'session.one_off_created', session.id, { title: session.title });
    return session;
  });
  res.status(201).json({ session: created });
}));

schedulesRouter.get('/sessions/list', requirePermission('schedule:read'), (req, res) => {
  const range = z.object({
    from: isoDate.optional(), to: isoDate.optional(),
  }).safeParse({ from: req.query.from || undefined, to: req.query.to || undefined });
  if (!range.success) throw badRequest('Invalid date range');
  const from = range.data.from ?? '';
  const to = range.data.to ?? '';
  if (from && to && (to < from
    || Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1 > 366)) {
    throw badRequest('Invalid or excessive date range');
  }
  const sessions = store.read((state) => state.scheduledSessions
    .filter((s) => s.organizationId === req.params.orgId)
    .filter((s) => !from || s.startsAt.slice(0, 10) >= from)
    .filter((s) => !to || s.startsAt.slice(0, 10) <= to)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt)));
  res.json({ sessions });
});

schedulesRouter.post('/sessions/:id/cancel', requirePermission('schedule:manage'), asyncRoute(async (req, res) => {
  const auth = getAuth(req)!;
  const session = await store.mutate((draft) => {
    const target = findInOrg(draft.scheduledSessions, req.params.orgId, req.params.id);
    if (!target) throw badRequest('Session not found', 'NOT_FOUND');
    if (!canManage(target.userId, auth)) throw forbidden('You can only manage your own sessions');
    target.status = 'cancelled';
    logAudit(draft, auth, 'session.cancelled', target.id, {});
    return target;
  });
  res.json({ session });
}));
