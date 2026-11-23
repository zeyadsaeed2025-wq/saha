import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { findInOrg, inOrg, store } from '../../common/store.js';
import { asyncRoute, getAuth, logAudit, requireFeature, requireOrg, requirePermission } from '../../common/middleware.js';
import { badRequest } from '../../common/errors.js';
import { addUsage } from '../billing/entitlements.js';
import { liveKitConfig } from '../media/livekit.js';

export const recordingsRouter = Router({ mergeParams: true });

recordingsRouter.use(requireOrg);
recordingsRouter.use(requireFeature('recording'));

const createSchema = z.object({ meetingId: z.string().uuid() });

const readPerm = requirePermission('recording:read');
const writePerm = requirePermission('recording:manage');

recordingsRouter.get('/', readPerm, (req, res) => {
  const orgId = req.params.orgId as string;
  const meetingId = typeof req.query.meetingId === 'string' ? req.query.meetingId : null;
  const recordings = store.read((state) =>
    inOrg(state.recordings, orgId)
      .filter((recording) => !meetingId || recording.meetingId === meetingId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  res.json({ recordings });
});

recordingsRouter.get('/:id', readPerm, (req, res) => {
  const orgId = req.params.orgId as string;
  const recording = store.read((state) => findInOrg(state.recordings, orgId, req.params.id as string));
  if (!recording) throw badRequest('Recording not found', 'NOT_FOUND');
  res.json({ recording });
});

recordingsRouter.post('/', writePerm, asyncRoute(async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success || !parsed.data) throw badRequest('A valid meeting id is required');
  const auth = getAuth(req)!;
  const orgId = req.params.orgId as string;
  const configured = liveKitConfig().configured;

  const result = await store.mutate((draft) => {
    const meeting = findInOrg(draft.meetings, orgId, parsed.data.meetingId);
    if (!meeting) throw badRequest('Meeting not found', 'NOT_FOUND');
    const active = configured && meeting.status === 'live';
    const at = new Date().toISOString();
    const recording = {
      id: randomUUID(),
      organizationId: orgId,
      meetingId: meeting.id,
      roomId: meeting.roomId,
      ownerUserId: auth.user.id,
      status: active ? 'recording' as const : 'pending' as const,
      providerFileId: null,
      providerUrl: null,
      retentionDays: 30,
      attempts: 0,
      lastError: configured ? null : 'Local adapter cannot capture media; connect LiveKit to record.',
      startedAt: active ? at : null,
      endedAt: null,
      createdAt: at,
    };
    draft.recordings.push(recording);
    logAudit(draft, auth, 'recording.created', recording.id, {
      meetingId: meeting.id,
      status: recording.status,
    });
    const note = configured
      ? (active
        ? 'LiveKit is configured. This local adapter does not capture media itself; a real recorder must write the file before upload.'
        : 'Recording is pending until the meeting is live; no media is captured by the local adapter.')
      : 'LiveKit credentials are missing, so the local adapter cannot capture media. No recording file will exist until a provider is connected.';
    return { recording, note };
  });
  res.status(201).json(result);
}));

recordingsRouter.post('/:id/stop', writePerm, asyncRoute(async (req, res) => {
  const auth = getAuth(req)!;
  const orgId = req.params.orgId as string;
  const result = await store.mutate((draft) => {
    const recording = findInOrg(draft.recordings, orgId, req.params.id as string);
    if (!recording) throw badRequest('Recording not found', 'NOT_FOUND');
    const endedAt = new Date().toISOString();
    const driveReady = inOrg(draft.driveConnections, orgId)
      .some((connection) => connection.status === 'connected' && Boolean(connection.folderId));
    const startedMs = Date.parse(recording.startedAt ?? recording.createdAt);
    const minutes = Number.isFinite(startedMs)
      ? Math.max(1, Math.ceil((Date.parse(endedAt) - startedMs) / 60_000))
      : 1;

    recording.endedAt = endedAt;
    if (driveReady) {
      recording.status = 'uploading';
      recording.lastError = null;
      addUsage(draft, orgId, 'recordingMinutes', minutes, endedAt);
    } else {
      recording.status = 'failed';
      recording.lastError = 'No connected Google Drive folder is selected.';
    }
    logAudit(draft, auth, 'recording.stopped', recording.id, {
      status: recording.status,
      minutes,
    });
    return { recording, minutes };
  });
  res.json({ recording: result.recording });
}));

recordingsRouter.post('/:id/retry', writePerm, asyncRoute(async (req, res) => {
  const auth = getAuth(req)!;
  const orgId = req.params.orgId as string;
  const recording = await store.mutate((draft) => {
    const target = findInOrg(draft.recordings, orgId, req.params.id as string);
    if (!target) throw badRequest('Recording not found', 'NOT_FOUND');
    if (target.status !== 'failed' && target.status !== 'retrying') {
      throw badRequest('Only failed recordings can be retried', 'INVALID_STATUS');
    }
    if (target.attempts >= 3) throw badRequest('Retry limit reached', 'RETRY_LIMIT');
    target.attempts += 1;
    target.status = 'retrying';
    target.lastError = null;
    logAudit(draft, auth, 'recording.retried', target.id, { attempts: target.attempts });
    return target;
  });
  res.json({ recording });
}));
