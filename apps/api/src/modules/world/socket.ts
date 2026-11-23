import type { Server as HttpServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { store } from '../../common/store.js';
import { findSessionByWorldCredential } from '../../common/security.js';
import { recordWorldAttendanceEvent } from '../attendance/service.js';
import { getEntitlements } from '../billing/entitlements.js';
import { resolveAvatarAppearance } from '../customization/appearance.js';
import { authorizeWorldConnection, validateMovement } from './logic.js';
import { buildOfficeLayout } from './layout.js';
import { worldRegistry, type WorldParticipant } from './registry.js';

const AVATAR_COLORS = ['#0e7c7b', '#f0795a', '#6d5bd0', '#d99a2b', '#2e9e6b', '#3b7dd8', '#b8557a', '#5b7180'];
const PROXIMITY_RADIUS = 140;

function allowedOrigins(requestHost: string | undefined): Set<string> {
  const origins = new Set<string>();
  if (requestHost) {
    origins.add(`http://${requestHost}`);
    origins.add(`https://${requestHost}`);
  }
  for (const candidate of [process.env.APP_URL, process.env.CORS_ORIGINS]) {
    for (const value of (candidate ?? '').split(',')) {
      if (!value.trim()) continue;
      try { origins.add(new URL(value.trim()).origin); } catch { /* ignore malformed config */ }
    }
  }
  return origins;
}

export function attachWorldServer(server: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws/world', maxPayload: 16 * 1024 });

  wss.on('connection', (socket: WebSocket, request) => {
    const origin = request.headers.origin;
    if (origin && !allowedOrigins(request.headers.host).has(origin)) {
      socket.close(4002, 'BAD_ORIGIN');
      return;
    }
    const url = new URL(request.url ?? '/', 'http://localhost');
    const token = url.searchParams.get('token') ?? '';
    const orgId = url.searchParams.get('orgId') ?? '';
    const workspaceId = url.searchParams.get('workspaceId') ?? '';
    const state = store.read((s) => s);
    const session = findSessionByWorldCredential(state, token);
    const user = state.users.find((u) => u.id === session?.userId && u.status === 'active');
    if (!session || !user) {
      socket.close(4001, 'UNAUTHORIZED');
      return;
    }
    const membership = state.memberships.find((m) => m.userId === user.id && m.organizationId === orgId && m.status === 'active');
    const workspace = state.workspaces.find((w) => w.id === workspaceId);
    const auth = authorizeWorldConnection({
      role: session.kind === 'guest' ? 'guest' : membership?.role ?? 'student',
      membershipStatus: session.kind === 'guest' ? 'active' : membership?.status ?? null,
      workspace, orgId,
    });
    if (!auth.ok || !workspace || (session.kind === 'guest' && session.guestOrgId !== orgId)) {
      socket.close(4003, auth.ok ? 'GUEST_ORG_MISMATCH' : auth.reason);
      return;
    }
    if (session.kind === 'guest' && session.guestWorkspaceId && session.guestWorkspaceId !== workspaceId) {
      socket.close(4003, 'WORKSPACE_NOT_ALLOWED');
      return;
    }

    const rooms = state.rooms.filter((r) => r.workspaceId === workspaceId);
    const layout = buildOfficeLayout(workspace, rooms);
    const preferredRoom = session.kind === 'guest' && session.guestRoomId
      ? rooms.find((r) => r.id === session.guestRoomId)
      : rooms.find((r) => r.privacy === 'public' && (r.kind === 'reception' || r.kind === 'lobby'))
        ?? rooms.find((r) => r.privacy === 'public');
    const initialRoom = preferredRoom ?? rooms[0];
    if (!initialRoom) {
      socket.close(4004, 'NO_ROOMS');
      return;
    }
    const occupancy = worldRegistry.occupancy(workspaceId);
    if ((occupancy[initialRoom.id] ?? 0) >= initialRoom.capacity) {
      socket.close(4005, 'ROOM_FULL');
      return;
    }
    // The stored avatar configuration is authoritative for appearance; the
    // palette color remains a deterministic fallback for peers without config.
    // X-ACC-01: the subscription limit must block the real world connection,
    // not just be displayed on the billing page. The check and registry.add
    // below are synchronous, so a burst of connects cannot over-admit in the
    // single-instance world (ADR-002).
    const entitlements = getEntitlements(state, orgId);
    if (!entitlements.allow('concurrentUsers', 1)) {
      socket.close(4029, 'QUOTA_EXCEEDED');
      return;
    }
    const appearance = resolveAvatarAppearance(state, user.id, orgId);
    const color = appearance.outfitColor ?? AVATAR_COLORS[user.id.charCodeAt(0) % AVATAR_COLORS.length];
    const participant: WorldParticipant = {
      socket, userId: user.id, organizationId: orgId,
      name: user.name, role: membership?.role ?? (session.kind === 'guest' ? 'guest' : 'student'),
      workspaceId, roomId: initialRoom.id,
      x: initialRoom.bounds.x + initialRoom.bounds.w / 2,
      y: initialRoom.bounds.y + initialRoom.bounds.h / 2,
      color, appearance, connectedAt: Date.now(), lastSeen: Date.now(),
    };
    worldRegistry.add(participant);

    const send = (payload: unknown) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
    };
    const broadcast = (payload: unknown) => {
      const message = JSON.stringify(payload);
      for (const peer of worldRegistry.inRoom(workspaceId, participant.roomId)) {
        if (peer.socket.readyState === peer.socket.OPEN) peer.socket.send(message);
      }
    };
    const sendProximity = (target: WorldParticipant) => {
      const nearby = worldRegistry.inRoom(workspaceId, target.roomId)
        .filter((peer) => peer.userId !== target.userId)
        .map((peer) => ({
          userId: peer.userId,
          name: peer.name,
          color: peer.color,
          appearance: peer.appearance,
          distance: Math.round(Math.hypot(peer.x - target.x, peer.y - target.y)),
        }))
        .filter((peer) => peer.distance <= PROXIMITY_RADIUS)
        .sort((a, b) => a.distance - b.distance);
      if (target.socket.readyState === target.socket.OPEN) {
        target.socket.send(JSON.stringify({ type: 'proximity', peers: nearby, radius: PROXIMITY_RADIUS }));
      }
    };
    const broadcastProximity = () => {
      for (const peer of worldRegistry.inRoom(workspaceId, participant.roomId)) sendProximity(peer);
    };
    const sendAudioGroups = () => {
      const peers = worldRegistry.inRoom(workspaceId, participant.roomId);
      const remaining = [...peers];
      const groups: Array<{ id: string; roomId: string; userIds: string[] }> = [];
      while (remaining.length) {
        const seed = remaining.shift()!;
        const members = [seed];
        for (let index = remaining.length - 1; index >= 0; index -= 1) {
          const candidate = remaining[index];
          if (members.some((member) => Math.hypot(member.x - candidate.x, member.y - candidate.y) <= PROXIMITY_RADIUS)) {
            members.push(candidate);
            remaining.splice(index, 1);
          }
        }
        groups.push({ id: `audio-${seed.roomId}-${seed.userId}`, roomId: seed.roomId, userIds: members.map((m) => m.userId) });
      }
      const payload = JSON.stringify({ type: 'audio_groups', groups, radius: PROXIMITY_RADIUS });
      for (const peer of peers) if (peer.socket.readyState === peer.socket.OPEN) peer.socket.send(payload);
    };
    const roomRole = participant.role === 'guest' ? 'guest' : participant.role;
    const resolveRole = (): 'guest' | 'student' | 'mentor' | 'org_admin' | 'super_admin' =>
      roomRole === 'guest' || roomRole === 'student' || roomRole === 'mentor' || roomRole === 'org_admin' || roomRole === 'super_admin'
        ? roomRole : 'student';

    send({ type: 'welcome', participant: {
      userId: participant.userId, roomId: participant.roomId, x: participant.x, y: participant.y,
      appearance: participant.appearance,
    } });
    send({ type: 'layout', ...layout });
    send(worldRegistry.snapshot(workspaceId, participant.roomId));
    broadcast({ type: 'presence', joined: {
      userId: user.id, name: user.name, color, appearance,
      roomId: participant.roomId, x: participant.x, y: participant.y,
    } });
    send({ type: 'occupancy', rooms: worldRegistry.occupancy(workspaceId) });
    broadcastProximity();
    sendAudioGroups();

    socket.on('message', (raw) => {
      let message: Record<string, unknown>;
      try { message = JSON.parse(raw.toString()); } catch { return; }
      if (message.type === 'move') {
        if (session.kind === 'guest' && session.guestRoomId && String(message.roomId ?? participant.roomId) !== session.guestRoomId) {
          send({ type: 'rejected', reason: 'ROOM_FORBIDDEN' });
          return;
        }
        const decision = validateMovement({
          x: Number(message.x),
          y: Number(message.y),
          roomId: String(message.roomId ?? participant.roomId),
          fromX: participant.x,
          fromY: participant.y,
          fromRoomId: participant.roomId,
        }, workspace, rooms, resolveRole(), layout);
        if (!decision.allowed) {
          send({ type: 'rejected', reason: decision.reason });
          return;
        }
        if (decision.roomId !== participant.roomId) {
          const destination = rooms.find((r) => r.id === decision.roomId);
          const destinationOccupancy = worldRegistry.occupancy(workspaceId)[decision.roomId] ?? 0;
          if (!destination || destinationOccupancy >= destination.capacity) {
            send({ type: 'rejected', reason: 'ROOM_FULL' });
            return;
          }
        }
        const updated = worldRegistry.update(user.id, { x: decision.x, y: decision.y, roomId: decision.roomId });
        if (!updated) return;
        const previousRoomId = participant.roomId;
        // registry.update returns a new object; keep the connection-local view in
        // sync so the next move is validated from the confirmed position, not the
        // original spawn point (otherwise MAX_STEP pins the avatar at 30px away).
        participant.x = updated.x;
        participant.y = updated.y;
        if (updated.roomId !== previousRoomId) {
          broadcast({ type: 'presence', left: { userId: user.id, roomId: previousRoomId } });
          participant.roomId = updated.roomId;
          broadcast({ type: 'presence', joined: {
            userId: user.id, name: user.name, color, appearance,
            roomId: updated.roomId, x: updated.x, y: updated.y,
          } });
        }
        // Echo the authoritative position to the sender as an acknowledgement,
        // then broadcast the same state to everyone in the destination room.
        send({ type: 'ack', userId: user.id, x: updated.x, y: updated.y, roomId: updated.roomId });
        broadcast({ type: 'moved', userId: user.id, x: updated.x, y: updated.y, roomId: updated.roomId });
        send({ type: 'occupancy', rooms: worldRegistry.occupancy(workspaceId) });
        broadcastProximity();
        sendAudioGroups();
        return;
      }
      if (message.type === 'heartbeat') {
        void store.mutate((draft) => recordWorldAttendanceEvent(draft, {
          organizationId: orgId, userId: user.id, type: 'heartbeat', source: 'world',
        }));
        worldRegistry.update(user.id, {});
        return;
      }
      if (message.type === 'leave') {
        void store.mutate((draft) => recordWorldAttendanceEvent(draft, {
          organizationId: orgId, userId: user.id, type: 'left', source: 'world',
        }));
        worldRegistry.remove(user.id);
        broadcast({ type: 'presence', left: { userId: user.id, roomId: participant.roomId } });
        broadcastProximity();
        sendAudioGroups();
        socket.close(1000, 'LEFT');
      }
    });

    const liveSocket = socket as WebSocket & { isAlive?: boolean };
    liveSocket.isAlive = true;
    liveSocket.on('pong', () => { liveSocket.isAlive = true; });
    const livenessTimer = setInterval(() => {
      if (liveSocket.readyState !== liveSocket.OPEN) return;
      if (!liveSocket.isAlive) {
        liveSocket.terminate();
        return;
      }
      liveSocket.isAlive = false;
      liveSocket.ping();
    }, 30_000);

    socket.on('close', () => {
      clearInterval(livenessTimer);
      const removed = worldRegistry.remove(user.id);
      if (removed) {
        broadcast({ type: 'presence', left: { userId: user.id, roomId: removed.roomId } });
        broadcastProximity();
        sendAudioGroups();
        void store.mutate((draft) => recordWorldAttendanceEvent(draft, {
          organizationId: orgId, userId: user.id, type: 'disconnected', source: 'world',
        }));
      }
    });
  });

  return wss;
}
