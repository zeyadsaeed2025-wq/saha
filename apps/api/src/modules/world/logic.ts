import type { Role, Room, Workspace } from '../../domain/types.js';
import { hasPermission } from '../../common/security.js';
import { obstacleAt, type OfficeLayout } from './layout.js';

export interface MovementInput {
  x: number;
  y: number;
  roomId: string;
  fromX?: number;
  fromY?: number;
  fromRoomId?: string;
}

export interface MovementDecision {
  allowed: boolean;
  x: number;
  y: number;
  roomId: string;
  reason?: string;
}

const MAX_STEP = 30;
const AVATAR_RADIUS = 10;

/** Server-authoritative movement validation. Never trust client coordinates. */
export function validateMovement(
  input: MovementInput,
  workspace: Workspace,
  rooms: Room[],
  role: Role,
  layout?: OfficeLayout,
): MovementDecision {
  const room = rooms.find((r) => r.id === input.roomId && r.organizationId === workspace.organizationId);
  if (!room || room.workspaceId !== workspace.id) {
    return { allowed: false, x: 0, y: 0, roomId: '', reason: 'UNKNOWN_ROOM' };
  }
  if (role !== 'super_admin' && !room.allowedRoles.includes(role)) {
    return { allowed: false, x: 0, y: 0, roomId: room.id, reason: 'ROOM_FORBIDDEN' };
  }
  if (!Number.isFinite(input.x) || !Number.isFinite(input.y)) {
    return { allowed: false, x: 0, y: 0, roomId: room.id, reason: 'INVALID_COORDINATES' };
  }
  const { x, y, w, h } = room.bounds;
  let cx = Math.min(Math.max(input.x, x + 12), x + w - 12);
  let cy = Math.min(Math.max(input.y, y + 12), y + h - 12);
  const withinMap = cx >= 0 && cy >= 0 && cx <= workspace.width && cy <= workspace.height;
  if (!withinMap) return { allowed: false, x: 0, y: 0, roomId: room.id, reason: 'OUT_OF_BOUNDS' };

  const hasOrigin = Number.isFinite(input.fromX) && Number.isFinite(input.fromY) && !!input.fromRoomId;
  if (!hasOrigin) {
    // Backwards-compatible direct placement used by legacy clients and tests.
    return { allowed: true, x: cx, y: cy, roomId: room.id };
  }

  const fromX = Number(input.fromX);
  const fromY = Number(input.fromY);
  const fromRoomId = String(input.fromRoomId);
  const dx = cx - fromX;
  const dy = cy - fromY;
  const distance = Math.hypot(dx, dy);

  if (fromRoomId !== room.id) {
    const portal = layout?.portals.find((candidate) => (
      (candidate.fromRoomId === fromRoomId && candidate.toRoomId === room.id)
      || (candidate.toRoomId === fromRoomId && candidate.fromRoomId === room.id)
    ));
    if (!portal) return { allowed: false, x: fromX, y: fromY, roomId: fromRoomId, reason: 'NO_DOOR' };
    const exit = portal.fromRoomId === fromRoomId ? portal.from : portal.to;
    const entry = portal.toRoomId === room.id ? portal.to : portal.from;
    const nearExit = Math.hypot(fromX - exit.x, fromY - exit.y) <= 34;
    const nearEntry = Math.hypot(cx - entry.x, cy - entry.y) <= 46;
    if (!nearExit || !nearEntry) {
      return { allowed: false, x: exit.x, y: exit.y, roomId: fromRoomId, reason: 'USE_DOOR' };
    }
    // Door transitions are bounded by the exit/entry checks above, not by the
    // normal same-room speed limit. The door gap can be wider than MAX_STEP.
  } else if (distance > MAX_STEP) {
    const ratio = MAX_STEP / distance;
    cx = fromX + dx * ratio;
    cy = fromY + dy * ratio;
  }

  if (layout) {
    const steps = Math.max(1, Math.ceil(Math.hypot(cx - fromX, cy - fromY) / 8));
    for (let i = 1; i <= steps; i += 1) {
      const px = fromX + ((cx - fromX) * i) / steps;
      const py = fromY + ((cy - fromY) * i) / steps;
      if (obstacleAt(layout.obstacles, px, py, AVATAR_RADIUS)) {
        return { allowed: false, x: fromX, y: fromY, roomId: fromRoomId, reason: 'OBSTACLE' };
      }
    }
  }

  return { allowed: true, x: cx, y: cy, roomId: room.id };
}

export interface WorldAuthInput {
  role: Role;
  membershipStatus: string | null;
  workspace: Workspace | undefined;
  orgId: string;
}

export function authorizeWorldConnection(input: WorldAuthInput): { ok: true } | { ok: false; reason: string } {
  if (!input.workspace || input.workspace.organizationId !== input.orgId) {
    return { ok: false, reason: 'WORKSPACE_NOT_FOUND' };
  }
  if (input.membershipStatus !== 'active' && input.role !== 'super_admin') {
    return { ok: false, reason: 'MEMBERSHIP_INACTIVE' };
  }
  if (!hasPermission(input.role, 'world:connect')) {
    return { ok: false, reason: 'ROLE_NOT_ALLOWED' };
  }
  return { ok: true };
}
