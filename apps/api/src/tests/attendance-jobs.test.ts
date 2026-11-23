import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Durable job records and restart recovery over the real store adapter. The
// finalizer itself is idempotent, so a recovered run can safely be re-executed.
const dataFile = join(tmpdir(), `saha-attendance-jobs-tests-${process.pid}.json`);
process.env.LOCAL_DATA_FILE = dataFile;
delete process.env.DATA_ADAPTER;

const { store } = await import('../common/store.js');
const { runAttendanceFinalizationOnce, startAttendanceJob } = await import('../modules/attendance/jobs.js');

const ORG_ID = 'jobs-org-1';

beforeEach(() => store.reset());
afterAll(() => rmSync(dataFile, { force: true }));

async function seedPendingSession() {
  await store.mutate((draft) => {
    draft.organizations.push({
      id: ORG_ID, name: 'Jobs Org', slug: 'jobs-org', timezone: 'UTC', status: 'active',
      settings: { graceMinutesDefault: 10, heartbeatSeconds: 60, verificationWindowMinutes: 15, demo: false },
      createdAt: new Date().toISOString(),
    });
    draft.scheduledSessions.push({
      id: 'jobs-session-1', organizationId: ORG_ID, scheduleRuleId: 'jobs-rule-1',
      userId: 'jobs-user-1', kind: 'shift', title: 'Past shift',
      startsAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
      endsAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
      graceMinutes: 10, minimumMinutes: 60, status: 'scheduled',
      policySnapshot: { graceMinutes: 10, minimumMinutes: 60 }, createdAt: new Date().toISOString(),
    });
  });
}

describe('durable attendance job', () => {
  it('records a successful run and never finalizes the same session twice', async () => {
    await seedPendingSession();
    const first = await runAttendanceFinalizationOnce();
    expect(first).toMatchObject({ organizations: 1, runs: 1, results: { [ORG_ID]: { absences: 1, finalized: 0 } } });

    const afterFirst = store.read((state) => ({
      sessions: state.attendanceSessions.filter((s) => s.organizationId === ORG_ID),
      scheduled: state.scheduledSessions.find((s) => s.id === 'jobs-session-1')!,
      runs: state.jobRuns,
      audits: state.auditLogs.filter((log) => log.action === 'attendance.finalized'),
    }));
    expect(afterFirst.sessions).toHaveLength(1);
    expect(afterFirst.sessions[0].status).toBe('absent');
    expect(afterFirst.scheduled.status).toBe('completed');
    expect(afterFirst.runs).toHaveLength(1);
    expect(afterFirst.runs[0]).toMatchObject({ status: 'succeeded', result: { absences: 1 } });
    expect(afterFirst.audits[0].metadata).toMatchObject({ source: 'worker', absences: 1 });

    const second = await runAttendanceFinalizationOnce();
    expect(second.results[ORG_ID]).toEqual({ absences: 0, finalized: 0 });
    expect(store.read((state) => state.attendanceSessions.filter((s) => s.organizationId === ORG_ID))).toHaveLength(1);
  });

  it('marks an interrupted run recovered on restart and still processes the work', async () => {
    await seedPendingSession();
    await store.mutate((draft) => {
      draft.jobRuns.push({
        id: 'stale-run', name: 'attendance.finalize', organizationId: ORG_ID,
        startedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(), finishedAt: null,
        status: 'running', result: null, error: null,
      });
    });

    const result = await runAttendanceFinalizationOnce();
    expect(result.recovered).toBe(1);
    expect(result.results[ORG_ID].absences).toBe(1);

    const runs = store.read((state) => state.jobRuns);
    expect(runs.find((run) => run.id === 'stale-run')).toMatchObject({ status: 'recovered' });
    expect(runs.filter((run) => run.status === 'succeeded')).toHaveLength(1);
  });

  it('starts and stops the periodic runner without losing persistence', async () => {
    await seedPendingSession();
    const stop = startAttendanceJob(20);
    await new Promise((resolve) => setTimeout(resolve, 90));
    stop();
    const runs = store.read((state) => state.jobRuns);
    expect(runs.length).toBeGreaterThanOrEqual(2);
    expect(runs.every((run) => run.status === 'succeeded')).toBe(true);
    expect(store.read((state) => state.attendanceSessions.filter((s) => s.organizationId === ORG_ID))).toHaveLength(1);
  });
});
