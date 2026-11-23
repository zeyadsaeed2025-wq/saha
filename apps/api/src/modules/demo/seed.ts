import { randomUUID } from 'node:crypto';
import { store as defaultStore, type Store } from '../../common/store.js';
import { hashPassword } from '../../common/security.js';
import { addDays, dayOfWeek, zonedDateTimeToUtc } from '../../common/time.js';
import { recalculate } from '../attendance/service.js';
import { createDefaultWorkspace } from '../workspaces/defaults.js';
import type { AttendanceEvent, DbState, Role, ScheduledSession } from '../../domain/types.js';

const DEMO_PASSWORD = 'Demo1234!';

/** Builds an isolated, clearly-labelled sample organization. Never mixed with customer data. */
export async function seedDemo(target: Store = defaultStore) {
  return target.mutate((draft) => {
    // A clearly-labelled platform admin for demonstrating the super-admin
    // surface. It has no organization membership by design; cross-org access
    // is granted by ADR role resolution for this id only.
    if (!draft.users.some((u) => u.id === 'super-admin-seed')) {
      draft.users.push({
        id: 'super-admin-seed', phone: '+201000000009', name: 'Platform Admin (Demo)',
        passwordHash: hashPassword(DEMO_PASSWORD), status: 'active',
        verifiedAt: new Date().toISOString(), createdAt: new Date().toISOString(),
      });
    }
    const existing = draft.organizations.find((o) => o.settings.demo);
    if (existing) {
      const admin = draft.memberships.find((m) => m.organizationId === existing.id && m.role === 'org_admin');
      return { organization: existing, adminPhone: draft.users.find((u) => u.id === admin?.userId)?.phone ?? '',
        adminPassword: DEMO_PASSWORD, alreadySeeded: true };
    }

    const orgId = randomUUID();
    const now = new Date().toISOString();
    draft.organizations.push({
      id: orgId, name: 'Northstar Academy (Demo)', slug: 'northstar-academy-demo',
      timezone: 'Africa/Cairo', status: 'active',
      settings: { graceMinutesDefault: 10, heartbeatSeconds: 60, verificationWindowMinutes: 15, demo: true },
      createdAt: now,
    });

    const people: Array<{ name: string; phone: string; role: Role; team: string }> = [
      { name: 'Lina Hassan', phone: '+201000000001', role: 'org_admin', team: 'Leadership' },
      { name: 'Omar Farouk', phone: '+201000000002', role: 'mentor', team: 'Engineering' },
      { name: 'Maya Adel', phone: '+201000000003', role: 'mentor', team: 'Design' },
      { name: 'Zeyad Saeed', phone: '+201000000004', role: 'student', team: 'Engineering' },
      { name: 'Nour Mohamed', phone: '+201000000005', role: 'student', team: 'Engineering' },
      { name: 'Hana Ali', phone: '+201000000006', role: 'student', team: 'Design' },
      { name: 'Karim Nabil', phone: '+201000000007', role: 'student', team: 'Design' },
      { name: 'Sara Mahmoud', phone: '+201000000008', role: 'student', team: 'Research' },
    ];
    const users = people.map((p) => ({
      id: randomUUID(), phone: p.phone, name: p.name,
      passwordHash: hashPassword(DEMO_PASSWORD), status: 'active' as const,
      verifiedAt: now, createdAt: now,
    }));
    draft.users.push(...users);
    people.forEach((p, i) => draft.memberships.push({
      id: randomUUID(), organizationId: orgId, userId: users[i].id, role: p.role,
      team: p.team, status: 'active', joinedAt: now,
    }));

    const { workspace, rooms } = createDefaultWorkspace(orgId);
    draft.workspaces.push(workspace);
    draft.rooms.push(...rooms);

    // Two recurring schedules: mentor sessions and student shifts.
    const rules = [
      { user: users[1], kind: 'mentor_session' as const, title: 'Engineering mentorship', start: '18:00', end: '20:00', days: [0, 1, 2, 3, 4] },
      { user: users[2], kind: 'mentor_session' as const, title: 'Design critique', start: '17:00', end: '18:30', days: [1, 2, 4] },
      { user: users[3], kind: 'shift' as const, title: 'Engineering study shift', start: '18:00', end: '20:00', days: [0, 1, 2, 3, 4] },
      { user: users[4], kind: 'shift' as const, title: 'Engineering study shift', start: '18:00', end: '20:00', days: [0, 1, 2, 3, 4] },
      { user: users[5], kind: 'shift' as const, title: 'Design studio shift', start: '17:00', end: '18:30', days: [1, 2, 4] },
      { user: users[6], kind: 'shift' as const, title: 'Design studio shift', start: '17:00', end: '18:30', days: [1, 2, 4] },
      { user: users[7], kind: 'shift' as const, title: 'Research lab', start: '19:00', end: '20:30', days: [2, 3] },
    ];
    const ruleIds = rules.map((rule) => {
      const id = randomUUID();
      draft.schedules.push({
        id, organizationId: orgId, userId: rule.user.id, kind: rule.kind, title: rule.title,
        days: rule.days, startTime: rule.start, endTime: rule.end, timezone: 'Africa/Cairo',
        graceMinutes: 10, minimumMinutes: 60, exceptions: [],
        policySnapshot: { graceMinutes: 10, minimumMinutes: 60 },
        status: 'active', history: [{ at: now, actorId: users[0].id, note: 'Created by demo seed' }],
        createdAt: now,
      });
      return id;
    });

    const statuses = ['on_time', 'late', 'on_time', 'partial', 'on_time', 'absent', 'on_time', 'late', 'on_time', 'excused'];
    let statusCursor = 0;
    const today = new Date().toISOString().slice(0, 10);
    for (let back = 13; back >= 0; back--) {
      const date = addDays(today, -back);
      rules.forEach((rule, i) => {
        if (!rule.days.includes(dayOfWeek(date))) return;
        const startsAt = zonedDateTimeToUtc(date, rule.start, 'Africa/Cairo');
        const endsAt = zonedDateTimeToUtc(date, rule.end, 'Africa/Cairo');
        const status = statuses[statusCursor++ % statuses.length];
        const session: ScheduledSession = {
          id: randomUUID(), organizationId: orgId, scheduleRuleId: ruleIds[i], userId: rule.user.id,
          kind: rule.kind, title: rule.title, startsAt, endsAt, workspaceId: workspace.id,
          graceMinutes: 10, minimumMinutes: 60,
          status: status === 'excused' ? 'excused' : 'scheduled',
          policySnapshot: { graceMinutes: 10, minimumMinutes: 60 }, createdAt: now,
        };
        draft.scheduledSessions.push(session);
        if (status === 'excused') return;

        const attId = randomUUID();
        const joinOffset = status === 'late' ? 15 * 60_000 : 3 * 60_000;
        const joinAt = new Date(new Date(startsAt).getTime() + joinOffset).toISOString();
        const leaveAt = status === 'absent' ? null
          : new Date(new Date(startsAt).getTime() + (status === 'partial' ? 25 : 115) * 60_000).toISOString();
        draft.attendanceSessions.push({
          id: attId, organizationId: orgId, scheduledSessionId: session.id, userId: rule.user.id,
          firstJoin: status === 'absent' ? null : joinAt, lastLeave: leaveAt, lastHeartbeat: leaveAt,
          status: status as never, rawLatenessSeconds: status === 'late' ? 15 * 60 : 3 * 60,
          countedLatenessSeconds: status === 'late' ? 5 * 60 : 0,
          confirmedConnectedSeconds: leaveAt ? Math.round((new Date(leaveAt).getTime() - new Date(joinAt).getTime()) / 1000) : 0,
          breakSeconds: 0, earlyLeaveSeconds: 0,
          finalizedAt: back > 0 ? now : null,
          note: status === 'absent' ? 'No verified join within the verification window' : '',
          createdAt: now,
        });
        if (status === 'absent') return;
        const push = (type: AttendanceEvent['type'], at: string, metadata?: Record<string, unknown>) =>
          draft.attendanceEvents.push({
            id: randomUUID(), organizationId: orgId, attendanceSessionId: attId,
            scheduledSessionId: session.id, userId: rule.user.id, type, at,
            source: 'api', metadata,
          });
        push('joined', joinAt);
        const end = leaveAt ? new Date(leaveAt).getTime() : new Date(joinAt).getTime() + 25 * 60_000;
        for (let t = new Date(joinAt).getTime() + 5 * 60_000; t < end; t += 5 * 60_000) {
          push('heartbeat', new Date(t).toISOString());
        }
        if (leaveAt) push('left', leaveAt);
        recalculate(draft, attId);
      });
    }

    // One audited manual correction to demonstrate the review workflow.
    const corrected = draft.attendanceSessions.find((s) => s.userId === users[6].id && s.status === 'late');
    if (corrected) {
      const before = corrected.status;
      corrected.status = 'excused';
      corrected.finalizedAt = now;
      corrected.note = 'Approved absence verified by mentor';
      draft.attendanceChanges.push({
        id: randomUUID(), organizationId: orgId, attendanceSessionId: corrected.id,
        actorId: users[0].id, reason: 'Mentor confirmed an approved absence for this date',
        before: { status: before }, after: { status: 'excused' }, at: now,
      });
    }
    draft.auditLogs.push({
      id: randomUUID(), organizationId: orgId, actorId: users[0].id,
      action: 'demo.seeded', target: orgId, metadata: { members: people.length }, at: now,
    });

    return {
      organization: draft.organizations.find((o) => o.id === orgId)!,
      adminPhone: people[0].phone,
      adminPassword: DEMO_PASSWORD,
      alreadySeeded: false,
    };
  });
}
