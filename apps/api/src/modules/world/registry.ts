import type { WebSocket } from 'ws';
import type { AvatarAppearance } from '../customization/appearance.js';

export interface WorldParticipant {
  socket: WebSocket;
  userId: string;
  organizationId: string;
  name: string;
  role: string;
  workspaceId: string;
  roomId: string;
  x: number;
  y: number;
  color: string;
  appearance: AvatarAppearance;
  connectedAt: number;
  lastSeen: number;
}

/**
 * In-memory presence registry (ADR-002). Single-instance constraint applies:
 * multi-instance presence requires an external adapter, which is out of scope.
 * Presence is NOT attendance — attendance is derived from server-side events.
 */
export class WorldRegistry {
  private participants = new Map<string, WorldParticipant>();

  add(participant: WorldParticipant): void {
    this.participants.set(participant.userId, participant);
  }

  remove(userId: string): WorldParticipant | undefined {
    const participant = this.participants.get(userId);
    this.participants.delete(userId);
    return participant;
  }

  update(userId: string, patch: Partial<WorldParticipant>): WorldParticipant | undefined {
    const current = this.participants.get(userId);
    if (!current) return undefined;
    const next = { ...current, ...patch, lastSeen: Date.now() };
    this.participants.set(userId, next);
    return next;
  }

  get(userId: string): WorldParticipant | undefined {
    return this.participants.get(userId);
  }

  /** Presence is keyed by user id; confirm the tenant before acting on it. */
  forUser(userId: string, organizationId: string): WorldParticipant | undefined {
    const participant = this.participants.get(userId);
    return participant?.organizationId === organizationId ? participant : undefined;
  }

  all(): WorldParticipant[] {
    return [...this.participants.values()];
  }

  inRoom(workspaceId: string, roomId: string): WorldParticipant[] {
    return [...this.participants.values()].filter(
      (p) => p.workspaceId === workspaceId && p.roomId === roomId,
    );
  }

  sendToRoom(workspaceId: string, roomId: string, payload: unknown): void {
    const message = JSON.stringify(payload);
    for (const peer of this.inRoom(workspaceId, roomId)) {
      if (peer.socket.readyState === peer.socket.OPEN) peer.socket.send(message);
    }
  }

  snapshot(workspaceId: string, roomId: string) {
    return {
      type: 'snapshot',
      participants: this.inRoom(workspaceId, roomId).map((p) => ({
        userId: p.userId, name: p.name, role: p.role, roomId: p.roomId, x: p.x, y: p.y,
        color: p.color, appearance: p.appearance,
      })),
      at: Date.now(),
    };
  }

  occupancy(workspaceId: string): Record<string, number> {
    const result: Record<string, number> = {};
    for (const p of this.participants.values()) {
      if (p.workspaceId !== workspaceId) continue;
      result[p.roomId] = (result[p.roomId] ?? 0) + 1;
    }
    return result;
  }
}

export const worldRegistry = new WorldRegistry();
