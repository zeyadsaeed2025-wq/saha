import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { findInOrg, inOrg, store } from '../../common/store.js';
import { asyncRoute, getAuth, logAudit, requireFeature, requireOrg, requirePermission } from '../../common/middleware.js';
import { AppError, badRequest, forbidden } from '../../common/errors.js';
import { getEntitlements } from '../billing/entitlements.js';
import { createLiveKitToken, liveKitConfig } from './livekit.js';
import type { DbState, Meeting, MeetingParticipant } from '../../domain/types.js';

export const mediaRouter = Router({ mergeParams: true });

mediaRouter.use(requireOrg);
mediaRouter.use(requireFeature('media'));

/**Participant-facing actions use meeting:read so students can join their meetings;
 * meeting lifecycle changes require meeting:manage (admins only in the RBAC map). */
const readPerm = requirePermission('meeting:read');
const writePerm = requirePermission('meeting:manage');

const tokenSchema = z.object({ meetingId: z.string().uuid() });
const meetingSchema = z.object({
  title: z.string().min(2).max(120),
  workspaceId: z.string().uuid(),
  roomId: z.string().uuid().nullable().optional(),
  scheduledFor: z.string().datetime().optional(),
});
const controlsSchema = z.object({
  micEnabled: z.boolean().optional(),
  cameraEnabled: z.boolean().optional(),
  sharing: z.boolean().optional(),
});

function meetingById(draft: DbState, orgId: string, id: string): Meeting {
  const meeting = findInOrg(draft.meetings, orgId, id);
  if (!meeting) throw badRequest('Meeting not found', 'NOT_FOUND');
  return meeting;
}

function participantsFor(draft: DbState, orgId: string, meetingId: string): MeetingParticipant[] {
  return inOrg(draft.meetingParticipants, orgId)
    .filter((participant) => participant.meetingId === meetingId)
    .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
}

mediaRouter.get('/status', readPerm, (req, res) => {
  const config = liveKitConfig();
  res.json({
    provider: config.configured ? 'livekit' : 'local',
    configured: config.configured,
    url: config.url,
    message: config.message,
  });
});

mediaRouter.post('/token', readPerm, asyncRoute(async (req, res) => {
  const parsed = tokenSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest('A valid meeting id is required');
  const auth = getAuth(req)!;
  const orgId = req.params.orgId as string;

  const access = store.read((state) => {
    const meeting = findInOrg(state.meetings, orgId, parsed.data.meetingId);
    if (!meeting) return null;
    const isAdmin = auth.role === 'org_admin' || auth.role === 'super_admin';
    const isHost = meeting.hostUserId === auth.user.id;
    const isParticipant = state.meetingParticipants.some((participant) =>
      participant.organizationId === orgId
      && participant.meetingId === meeting.id
      && participant.userId === auth.user.id);
    return { allowed: isAdmin || isHost || isParticipant };
  });
  if (!access) throw badRequest('Meeting not found', 'NOT_FOUND');
  if (!access.allowed) throw forbidden('You are not a host or participant of this meeting');

  const config = liveKitConfig();
  if (!config.configured) {
    throw new AppError(503, 'PROVIDER_NOT_CONFIGURED',
      'LiveKit credentials are not configured; media tokens are unavailable locally.');
  }
  const issued = createLiveKitToken({
    apiKey: process.env.LIVEKIT_API_KEY as string,
    apiSecret: process.env.LIVEKIT_API_SECRET as string,
    identity: auth.user.id,
    roomName: `saha-${parsed.data.meetingId}`,
    name: auth.user.name,
    metadata: { organizationId: orgId, meetingId: parsed.data.meetingId, userId: auth.user.id },
  });
  res.json({
    token: issued.token,
    url: config.url,
    expiresAt: issued.expiresAt,
    identity: auth.user.id,
  });
}));

mediaRouter.get('/meetings', readPerm, (req, res) => {
  const orgId = req.params.orgId as string;
  const meetings = store.read((state) =>
    inOrg(state.meetings, orgId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  res.json({ meetings });
});

mediaRouter.post('/meetings', writePerm, asyncRoute(async (req, res) => {
  const parsed = meetingSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest('A title, workspace and valid schedule are required');
  const auth = getAuth(req)!;
  const orgId = req.params.orgId as string;
  const config = liveKitConfig();

  const meeting = await store.mutate((draft) => {
    getEntitlements(draft, orgId).assert('meetingsPerMonth', 1);
    if (!findInOrg(draft.workspaces, orgId, parsed.data.workspaceId)) {
      throw badRequest('Workspace not found', 'NOT_FOUND');
    }
    if (parsed.data.roomId && !findInOrg(draft.rooms, orgId, parsed.data.roomId)) {
      throw badRequest('Room not found', 'NOT_FOUND');
    }
    const created: Meeting = {
      id: randomUUID(),
      organizationId: orgId,
      workspaceId: parsed.data.workspaceId,
      roomId: parsed.data.roomId ?? null,
      title: parsed.data.title,
      hostUserId: auth.user.id,
      status: 'scheduled',
      provider: config.configured ? 'livekit' : 'local',
      startedAt: null,
      endedAt: null,
      createdAt: new Date().toISOString(),
    };
    // scheduledFor is a request-level scheduling hint; the entity type does not
    // carry it, so it is kept as an optional extra field when supplied.
    if (parsed.data.scheduledFor) Object.assign(created, { scheduledFor: parsed.data.scheduledFor });
    draft.meetings.push(created);
    logAudit(draft, auth, 'meeting.created', created.id, {
      title: created.title,
      workspaceId: created.workspaceId,
      roomId: created.roomId,
      scheduledFor: parsed.data.scheduledFor ?? null,
    });
    return created;
  });
  res.status(201).json({ meeting });
}));

mediaRouter.get('/meetings/:id', readPerm, (req, res) => {
  const orgId = req.params.orgId as string;
  const result = store.read((state) => {
    const meeting = findInOrg(state.meetings, orgId, req.params.id as string);
    if (!meeting) return null;
    return { meeting, participants: participantsFor(state, orgId, meeting.id) };
  });
  if (!result) throw badRequest('Meeting not found', 'NOT_FOUND');
  res.json(result);
});

mediaRouter.get('/meetings/:id/participants', readPerm, (req, res) => {
  const orgId = req.params.orgId as string;
  const participants = store.read((state) => {
    const meeting = findInOrg(state.meetings, orgId, req.params.id as string);
    if (!meeting) return null;
    return participantsFor(state, orgId, meeting.id);
  });
  if (!participants) throw badRequest('Meeting not found', 'NOT_FOUND');
  res.json({ participants });
});

mediaRouter.post('/meetings/:id/start', writePerm, asyncRoute(async (req, res) => {
  const auth = getAuth(req)!;
  const orgId = req.params.orgId as string;
  const meeting = await store.mutate((draft) => {
    const target = meetingById(draft, orgId, req.params.id as string);
    if (target.endedAt) throw badRequest('Meeting has already ended', 'MEETING_ENDED');
    if (target.status !== 'live') {
      target.status = 'live';
      target.startedAt = new Date().toISOString();
    }
    logAudit(draft, auth, 'meeting.started', target.id, { provider: target.provider });
    return target;
  });
  res.json({ meeting });
}));

mediaRouter.post('/meetings/:id/end', writePerm, asyncRoute(async (req, res) => {
  const auth = getAuth(req)!;
  const orgId = req.params.orgId as string;
  const meeting = await store.mutate((draft) => {
    const target = meetingById(draft, orgId, req.params.id as string);
    const at = new Date().toISOString();
    if (!target.endedAt) {
      target.status = 'ended';
      target.endedAt = at;
      for (const participant of participantsFor(draft, orgId, target.id)) {
        if (!participant.leftAt) participant.leftAt = at;
      }
    }
    logAudit(draft, auth, 'meeting.ended', target.id, { endedAt: target.endedAt });
    return target;
  });
  res.json({ meeting });
}));

mediaRouter.post('/meetings/:id/join', readPerm, asyncRoute(async (req, res) => {
  const auth = getAuth(req)!;
  const orgId = req.params.orgId as string;
  const participant = await store.mutate((draft) => {
    const meeting = meetingById(draft, orgId, req.params.id as string);
    if (meeting.status !== 'live') throw badRequest('Meeting is not live', 'MEETING_NOT_LIVE');
    const at = new Date().toISOString();
    let record = draft.meetingParticipants.find((item) =>
      item.organizationId === orgId && item.meetingId === meeting.id && item.userId === auth.user.id);
    if (!record) {
      record = {
        id: randomUUID(),
        meetingId: meeting.id,
        organizationId: orgId,
        userId: auth.user.id,
        role: meeting.hostUserId === auth.user.id ? 'host' : 'participant',
        micEnabled: true,
        cameraEnabled: true,
        sharing: false,
        joinedAt: at,
        leftAt: null,
      };
      draft.meetingParticipants.push(record);
    } else if (record.leftAt) {
      record.leftAt = null;
      record.joinedAt = at;
      record.role = meeting.hostUserId === auth.user.id ? 'host' : 'participant';
    }
    return record;
  });
  res.json({ participant });
}));

mediaRouter.post('/meetings/:id/leave', readPerm, asyncRoute(async (req, res) => {
  const auth = getAuth(req)!;
  const orgId = req.params.orgId as string;
  const participant = await store.mutate((draft) => {
    meetingById(draft, orgId, req.params.id as string);
    const record = draft.meetingParticipants.find((item) =>
      item.organizationId === orgId && item.meetingId === req.params.id && item.userId === auth.user.id);
    if (!record) throw badRequest('You are not a participant of this meeting', 'NOT_FOUND');
    if (!record.leftAt) record.leftAt = new Date().toISOString();
    return record;
  });
  res.json({ participant });
}));

mediaRouter.patch('/meetings/:id/controls', readPerm, asyncRoute(async (req, res) => {
  const parsed = controlsSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest('Invalid media control update');
  const auth = getAuth(req)!;
  const orgId = req.params.orgId as string;
  const participant = await store.mutate((draft) => {
    const meeting = meetingById(draft, orgId, req.params.id as string);
    const at = new Date().toISOString();
    let record = draft.meetingParticipants.find((item) =>
      item.organizationId === orgId && item.meetingId === meeting.id && item.userId === auth.user.id);
    if (!record) {
      record = {
        id: randomUUID(),
        meetingId: meeting.id,
        organizationId: orgId,
        userId: auth.user.id,
        role: meeting.hostUserId === auth.user.id ? 'host' : 'participant',
        micEnabled: true,
        cameraEnabled: true,
        sharing: false,
        joinedAt: at,
        leftAt: null,
      };
      draft.meetingParticipants.push(record);
    }
    if (parsed.data.micEnabled !== undefined) record.micEnabled = parsed.data.micEnabled;
    if (parsed.data.cameraEnabled !== undefined) record.cameraEnabled = parsed.data.cameraEnabled;
    if (parsed.data.sharing !== undefined) record.sharing = parsed.data.sharing;
    if (parsed.data.sharing === true) {
      for (const other of participantsFor(draft, orgId, meeting.id)) {
        if (other.id !== record!.id && other.sharing) other.sharing = false;
      }
    }
    return record;
  });
  res.json({ participant });
}));
