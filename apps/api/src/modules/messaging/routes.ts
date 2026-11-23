import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { findInOrg, inOrg, store } from '../../common/store.js';
import {
  asyncRoute, getAuth, logAudit, requireOrg, requirePermission,
  type AuthContext,
} from '../../common/middleware.js';
import { badRequest, forbidden, notFound } from '../../common/errors.js';
import type { Channel, DbState, Message } from '../../domain/types.js';

export const messagingRouter = Router({ mergeParams: true });

messagingRouter.use(requireOrg);

const channelSchema = z.object({
  name: z.string().min(2).max(60),
  scope: z.enum(['organization', 'team', 'room']),
  // Room scopes are strict UUIDs. Team scopes accept a team UUID (resolved to
  // its name below) or the team name itself, which is what membership.team holds.
  scopeId: z.string().min(1).max(120).nullable().optional(),
});

const messageSchema = z.object({ body: z.string().min(1).max(4000) });
const cursorSchema = z.object({ before: z.string().datetime().optional() });

const byCreatedAt = (
  a: { createdAt: string; id: string },
  b: { createdAt: string; id: string },
): number => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

/** Single source of truth for channel visibility, used by every read and write. */
function channelVisible(state: DbState, auth: AuthContext, orgId: string, channel: Channel): boolean {
  if (channel.organizationId !== orgId) return false;
  if (channel.scope === 'team') {
    const team = z.string().uuid().safeParse(channel.scopeId).success
      ? findInOrg(state.teams, orgId, channel.scopeId as string)
      : undefined;
    const teamName = team?.name ?? channel.scopeId;
    return Boolean(auth.membership && auth.membership.team === teamName);
  }
  if (channel.scope === 'room') {
    if (!channel.scopeId) return false;
    const room = findInOrg(state.rooms, orgId, channel.scopeId);
    return Boolean(room && room.allowedRoles.includes(auth.role));
  }
  return true;
}

function visibleChannel(
  state: DbState, auth: AuthContext, orgId: string, channelId: string,
): Channel {
  const channel = findInOrg(state.channels, orgId, channelId);
  if (!channel || !channelVisible(state, auth, orgId, channel)) throw notFound('Channel not found');
  return channel;
}

function requireDirectTarget(state: DbState, auth: AuthContext, orgId: string, targetId: string): void {
  if (targetId === auth.user.id) throw badRequest('You cannot message yourself', 'INVALID_RECIPIENT');
  const target = state.memberships.find(
    (m) => m.organizationId === orgId && m.userId === targetId && m.status === 'active',
  );
  if (!target) throw notFound('Recipient is not an active member of this organization');
}

messagingRouter.get('/channels', requirePermission('message:read'), (req, res) => {
  const auth = getAuth(req)!;
  const channels = store.read((state) => inOrg(state.channels, auth.orgId)
    .filter((channel) => channelVisible(state, auth, auth.orgId, channel))
    .sort(byCreatedAt));
  res.json({ channels });
});

messagingRouter.post('/channels', requirePermission('message:send'), asyncRoute(async (req, res) => {
  const parsed = channelSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest('Invalid channel details');
  if (parsed.data.scope !== 'organization' && !parsed.data.scopeId) {
    throw badRequest('scopeId is required for team and room channels', 'SCOPE_ID_REQUIRED');
  }
  const auth = getAuth(req)!;
  if (auth.isGuest || auth.role === 'guest') throw forbidden('Guests cannot create channels');

  const created = await store.mutate((draft) => {
    const orgId = auth.orgId;
    let scopeId: string | null = null;

    if (parsed.data.scope === 'team') {
      const requested = parsed.data.scopeId as string;
      const team = z.string().uuid().safeParse(requested).success
        ? findInOrg(draft.teams, orgId, requested)
        : undefined;
      const teamName = team?.name ?? requested;
      const membership = auth.membership;
      if (!membership || membership.organizationId !== orgId || membership.status !== 'active'
        || membership.team !== teamName) {
        throw forbidden('You must be an active member of this team to create its channel');
      }
      scopeId = teamName;
    } else if (parsed.data.scope === 'room') {
      const requested = parsed.data.scopeId as string;
      if (!z.string().uuid().safeParse(requested).success) {
        throw badRequest('scopeId must be a room id', 'INVALID_SCOPE_ID');
      }
      const room = findInOrg(draft.rooms, orgId, requested);
      if (!room) throw notFound('Room not found');
      if (!room.allowedRoles.includes(auth.role)) throw forbidden('You cannot use this room');
      scopeId = room.id;
    }

    const channel: Channel = {
      id: randomUUID(),
      organizationId: orgId,
      name: parsed.data.name,
      scope: parsed.data.scope,
      scopeId,
      createdBy: auth.user.id,
      createdAt: new Date().toISOString(),
    };
    draft.channels.push(channel);
    logAudit(draft, auth, 'channel.created', channel.id, {
      name: channel.name, scope: channel.scope, scopeId: channel.scopeId,
    });
    return channel;
  });
  res.status(201).json({ channel: created });
}));

messagingRouter.get('/channels/:id/messages', requirePermission('message:read'), (req, res) => {
  const auth = getAuth(req)!;
  const cursor = cursorSchema.safeParse(req.query);
  if (!cursor.success) throw badRequest('Invalid before cursor', 'INVALID_CURSOR');
  const channelId = req.params.id;
  const messages = store.read((state) => {
    visibleChannel(state, auth, auth.orgId, channelId);
    return inOrg(state.messages, auth.orgId)
      .filter((message) => message.channelId === channelId && message.directUserId === null)
      .filter((message) => !cursor.data.before || message.createdAt < cursor.data.before!)
      .sort(byCreatedAt)
      .slice(-100);
  });
  res.json({ messages });
});

messagingRouter.post('/channels/:id/messages', requirePermission('message:send'), asyncRoute(async (req, res) => {
  const parsed = messageSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest('A message body of 1 to 4000 characters is required');
  const auth = getAuth(req)!;
  const created = await store.mutate((draft) => {
    visibleChannel(draft, auth, auth.orgId, req.params.id);
    const message: Message = {
      id: randomUUID(),
      organizationId: auth.orgId,
      channelId: req.params.id,
      directUserId: null,
      senderUserId: auth.user.id,
      body: parsed.data.body,
      readBy: [auth.user.id],
      createdAt: new Date().toISOString(),
    };
    draft.messages.push(message);
    logAudit(draft, auth, 'message.sent', message.id, { channelId: message.channelId });
    return message;
  });
  res.status(201).json({ message: created });
}));

messagingRouter.get('/direct/:userId', requirePermission('message:read'), (req, res) => {
  const auth = getAuth(req)!;
  const targetId = req.params.userId;
  const messages = store.read((state) => {
    requireDirectTarget(state, auth, auth.orgId, targetId);
    return inOrg(state.messages, auth.orgId)
      .filter((message) => message.channelId === null && message.directUserId !== null
        && ((message.senderUserId === auth.user.id && message.directUserId === targetId)
          || (message.senderUserId === targetId && message.directUserId === auth.user.id)))
      .sort(byCreatedAt);
  });
  res.json({ messages });
});

messagingRouter.post('/direct/:userId', requirePermission('message:send'), asyncRoute(async (req, res) => {
  const parsed = messageSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest('A message body of 1 to 4000 characters is required');
  const auth = getAuth(req)!;
  const targetId = req.params.userId;
  const created = await store.mutate((draft) => {
    requireDirectTarget(draft, auth, auth.orgId, targetId);
    const message: Message = {
      id: randomUUID(),
      organizationId: auth.orgId,
      channelId: null,
      directUserId: targetId,
      senderUserId: auth.user.id,
      body: parsed.data.body,
      readBy: [auth.user.id],
      createdAt: new Date().toISOString(),
    };
    draft.messages.push(message);
    logAudit(draft, auth, 'message.sent', message.id, { directUserId: targetId });
    return message;
  });
  res.status(201).json({ message: created });
}));

messagingRouter.post('/messages/:id/read', requirePermission('message:send'), asyncRoute(async (req, res) => {
  const auth = getAuth(req)!;
  const updated = await store.mutate((draft) => {
    const message = findInOrg(draft.messages, auth.orgId, req.params.id);
    if (!message) throw notFound('Message not found');

    const channelMessage = message.channelId !== null;
    const channel = channelMessage
      ? findInOrg(draft.channels, auth.orgId, message.channelId as string)
      : undefined;
    const readableInChannel = Boolean(channel && channelVisible(draft, auth, auth.orgId, channel));
    const readableInDirect = !channelMessage && message.directUserId !== null
      && (message.directUserId === auth.user.id || message.senderUserId === auth.user.id);

    if ((readableInChannel || readableInDirect) && !message.readBy.includes(auth.user.id)) {
      message.readBy.push(auth.user.id);
    }
    return message;
  });
  res.json({ message: updated });
}));
