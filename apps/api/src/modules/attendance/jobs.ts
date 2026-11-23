import { randomUUID } from 'node:crypto';
import { store } from '../../common/store.js';
import type { DbState, JobRun } from '../../domain/types.js';
import { recalculate } from './service.js';

export interface FinalizeResult { absences: number; finalized: number }

export const ATTENDANCE_JOB = 'attendance.finalize';
/** A run older than this was almost certainly interrupted by a process restart. */
export const JOB_STALE_MS = 5 * 60_000;
const MAX_JOB_RUNS = 100;

/**
 * Idempotent absence finalizer. The 60-second runner only calls this helper;
 * the verification window still controls eligibility, so the periodic tick can
 * never replace the 15-minute grace rule.
 */
export function finalizeAbsences(draft: DbState, organizationId: string, actorId: string | null = null): FinalizeResult {
  const org = draft.organizations.find((o) => o.id === organizationId);
  if (!org) return { absences: 0, finalized: 0 };
  const cutoff = Date.now() - org.settings.verificationWindowMinutes * 60_000;
  let absences = 0;
  let finalized = 0;
  for (const scheduled of draft.scheduledSessions.filter(
    (s) => s.organizationId === organizationId && s.status === 'scheduled' && new Date(s.endsAt).getTime() < cutoff)) {
    let session = draft.attendanceSessions.find((s) => s.scheduledSessionId === scheduled.id);
    if (!session) {
      session = {
        id: randomUUID(), organizationId: scheduled.organizationId, scheduledSessionId: scheduled.id,
        userId: scheduled.userId, firstJoin: null, lastLeave: null, lastHeartbeat: null,
        status: 'absent', rawLatenessSeconds: 0, countedLatenessSeconds: 0,
        confirmedConnectedSeconds: 0, breakSeconds: 0, earlyLeaveSeconds: 0,
        finalizedAt: new Date().toISOString(),
        note: 'No verified join event within the verification window',
        createdAt: new Date().toISOString(),
      };
      draft.attendanceSessions.push(session);
      absences += 1;
    } else if (!session.finalizedAt) {
      recalculate(draft, session.id);
      session.finalizedAt = new Date().toISOString();
      finalized += 1;
    }
    scheduled.status = 'completed';
  }
  if (absences || finalized) {
    draft.auditLogs.push({
      id: randomUUID(), organizationId, actorId,
      action: 'attendance.finalized', target: organizationId,
      metadata: { absences, finalized, source: actorId ? 'api' : 'worker' },
      at: new Date().toISOString(),
    });
  }
  return { absences, finalized };
}

function recoverStaleRuns(draft: DbState, now: Date): number {
  let recovered = 0;
  for (const run of draft.jobRuns) {
    if (run.name !== ATTENDANCE_JOB || run.status !== 'running') continue;
    if (now.getTime() - Date.parse(run.startedAt) < JOB_STALE_MS) continue;
    run.status = 'recovered';
    run.finishedAt = now.toISOString();
    run.error = 'Recovered after process restart; finalization is idempotent';
    recovered += 1;
  }
  return recovered;
}

function pruneRuns(draft: DbState): void {
  if (draft.jobRuns.length <= MAX_JOB_RUNS) return;
  const keep = new Set(draft.jobRuns
    .slice()
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, MAX_JOB_RUNS)
    .map((run) => run.id));
  draft.jobRuns = draft.jobRuns.filter((run) => keep.has(run.id));
}

/** One complete pass. Exported so a restart/recovery can be tested without timers. */
export async function runAttendanceFinalizationOnce(): Promise<{
  organizations: number; recovered: number; runs: number; results: Record<string, FinalizeResult>;
}> {
  return store.mutate((draft) => {
    const now = new Date();
    const recovered = recoverStaleRuns(draft, now);
    const results: Record<string, FinalizeResult> = {};
    for (const org of draft.organizations) {
      const run: JobRun = {
        id: randomUUID(), name: ATTENDANCE_JOB, organizationId: org.id,
        startedAt: now.toISOString(), finishedAt: null, status: 'running',
        result: null, error: null,
      };
      draft.jobRuns.push(run);
      try {
        const result = finalizeAbsences(draft, org.id);
        results[org.id] = result;
        run.status = 'succeeded';
        run.result = { ...result };
      } catch (error) {
        run.status = 'failed';
        run.error = error instanceof Error ? error.message : String(error);
        throw error;
      } finally {
        run.finishedAt = new Date().toISOString();
      }
    }
    pruneRuns(draft);
    return { organizations: draft.organizations.length, recovered, runs: draft.organizations.length, results };
  });
}

export function startAttendanceJob(intervalMs = 60_000): () => void {
  void runAttendanceFinalizationOnce()
    .catch((error) => console.error('[jobs] initial attendance finalization failed', error));
  const timer = setInterval(() => {
    void runAttendanceFinalizationOnce()
      .catch((error) => console.error('[jobs] attendance finalization failed', error));
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
