import { describe, expect, it } from 'vitest';
import { authorizeWorldConnection, validateMovement } from '../modules/world/logic.js';
import { buildOfficeLayout, type OfficeLayout } from '../modules/world/layout.js';
import { createDefaultWorkspace } from '../modules/workspaces/defaults.js';
import type { Role, Room, Workspace } from '../domain/types.js';

// Pure authorization/movement logic on local fixtures. No store, no network,
// no PostgreSQL: these tests do not verify any database behavior.
const workspace: Workspace = {
  id: 'ws-1',
  organizationId: 'org-1',
  name: 'Main Office',
  description: 'test floor',
  width: 1200,
  height: 760,
  createdAt: '2026-03-02T00:00:00.000Z',
};

const room = (overrides: Partial<Room> = {}): Room => ({
  id: 'room-1',
  workspaceId: workspace.id,
  organizationId: workspace.organizationId,
  name: 'Reception',
  kind: 'reception',
  privacy: 'public',
  bounds: { x: 40, y: 40, w: 300, h: 200 },
  color: '#ffffff',
  allowedRoles: ['guest', 'student', 'mentor', 'org_admin'],
  capacity: 12,
  ...overrides,
});

const neighbour = room({
  id: 'room-2',
  name: 'Open Workspace',
  kind: 'open',
  bounds: { x: 360, y: 40, w: 300, h: 200 },
});

describe('validateMovement (local logic; not PostgreSQL)', () => {
  it('rejects unknown rooms and rooms from another workspace or organization', () => {
    expect(validateMovement({ x: 100, y: 100, roomId: 'missing' }, workspace, [room()], 'student')).toEqual({
      allowed: false, x: 0, y: 0, roomId: '', reason: 'UNKNOWN_ROOM',
    });
    expect(validateMovement(
      { x: 100, y: 100, roomId: 'room-2' },
      workspace,
      [room({ id: 'room-2', workspaceId: 'ws-other' })],
      'student',
    ).reason).toBe('UNKNOWN_ROOM');
    expect(validateMovement(
      { x: 100, y: 100, roomId: 'room-3' },
      workspace,
      [room({ id: 'room-3', organizationId: 'org-other' })],
      'student',
    ).reason).toBe('UNKNOWN_ROOM');
  });

  it('enforces allowedRoles for both private and public rooms', () => {
    const privateRoom = room({
      id: 'private-1', name: 'Meeting Room', privacy: 'private',
      bounds: { x: 370, y: 370, w: 420, h: 350 }, allowedRoles: ['mentor', 'org_admin'],
    });

    const denied = validateMovement({ x: 400, y: 400, roomId: privateRoom.id }, workspace, [privateRoom], 'student');
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toBe('ROOM_FORBIDDEN');
    expect(denied.roomId).toBe(privateRoom.id);

    const allowed = validateMovement({ x: 400, y: 400, roomId: privateRoom.id }, workspace, [privateRoom], 'mentor');
    expect(allowed).toEqual({ allowed: true, x: 400, y: 400, roomId: privateRoom.id });

    const publicRestricted = room({ id: 'public-1', allowedRoles: ['mentor'] });
    expect(validateMovement({ x: 100, y: 100, roomId: 'public-1' }, workspace, [publicRestricted], 'student').reason)
      .toBe('ROOM_FORBIDDEN');
    expect(validateMovement({ x: 100, y: 100, roomId: 'public-1' }, workspace, [publicRestricted], 'super_admin').allowed)
      .toBe(true);
  });

  it('clamps coordinates inside the room with a 12px margin', () => {
    expect(validateMovement({ x: -500, y: -500, roomId: 'room-1' }, workspace, [room()], 'guest')).toEqual({
      allowed: true, x: 52, y: 52, roomId: 'room-1',
    });
    expect(validateMovement({ x: 5000, y: 5000, roomId: 'room-1' }, workspace, [room()], 'guest')).toEqual({
      allowed: true, x: 328, y: 228, roomId: 'room-1',
    });
  });

  it('rejects non-finite coordinates and rooms outside the map', () => {
    expect(validateMovement({ x: Number.NaN, y: 100, roomId: 'room-1' }, workspace, [room()], 'student').reason)
      .toBe('INVALID_COORDINATES');
    expect(validateMovement({ x: 100, y: Number.POSITIVE_INFINITY, roomId: 'room-1' }, workspace, [room()], 'student').reason)
      .toBe('INVALID_COORDINATES');

    const strayRoom = room({ id: 'stray', bounds: { x: 1300, y: 700, w: 100, h: 100 } });
    const outside = validateMovement({ x: 1300, y: 700, roomId: 'stray' }, workspace, [strayRoom], 'student');
    expect(outside.allowed).toBe(false);
    expect(outside.reason).toBe('OUT_OF_BOUNDS');
    expect(outside.x).toBe(0);
    expect(outside.y).toBe(0);
  });

  it('limits each authoritative step to 30px from the confirmed position', () => {
    const decision = validateMovement(
      { x: 200, y: 100, roomId: 'room-1', fromX: 100, fromY: 100, fromRoomId: 'room-1' },
      workspace,
      [room()],
      'student',
    );
    expect(decision).toEqual({ allowed: true, x: 130, y: 100, roomId: 'room-1' });
  });

  it('allows room changes only through a generated door', () => {
    const rooms = [room(), neighbour];
    const layout = buildOfficeLayout(workspace, rooms);
    const portal = layout.portals[0];
    expect(portal).toBeDefined();
    expect(portal.fromRoomId).toBe('room-1');
    expect(portal.toRoomId).toBe('room-2');

    const throughDoor = validateMovement(
      {
        x: portal.to.x, y: portal.to.y, roomId: portal.toRoomId,
        fromX: portal.from.x, fromY: portal.from.y, fromRoomId: portal.fromRoomId,
      },
      workspace,
      rooms,
      'student',
      layout,
    );
    expect(throughDoor).toEqual({ allowed: true, x: portal.to.x, y: portal.to.y, roomId: 'room-2' });

    const wrongDoor = validateMovement(
      { x: portal.to.x, y: portal.to.y, roomId: portal.toRoomId, fromX: 100, fromY: 100, fromRoomId: 'room-1' },
      workspace,
      rooms,
      'student',
      layout,
    );
    expect(wrongDoor.reason).toBe('USE_DOOR');

    const isolated = room({ id: 'isolated', bounds: { x: 700, y: 40, w: 200, h: 200 } });
    const noDoor = validateMovement(
      { x: 720, y: 100, roomId: 'isolated', fromX: 300, fromY: 100, fromRoomId: 'room-1' },
      workspace,
      [room(), isolated],
      'student',
      buildOfficeLayout(workspace, [room(), isolated]),
    );
    expect(noDoor.reason).toBe('NO_DOOR');
  });

  it('rejects movement that sweeps through a solid obstacle', () => {
    const layout: OfficeLayout = {
      roomId: 'room-1',
      decor: [],
      obstacles: [{ x: 100, y: 100, w: 40, h: 40 }],
      portals: [],
    };
    const decision = validateMovement(
      { x: 130, y: 120, roomId: 'room-1', fromX: 80, fromY: 120, fromRoomId: 'room-1' },
      workspace,
      [room()],
      'student',
      layout,
    );
    expect(decision).toEqual({ allowed: false, x: 80, y: 120, roomId: 'room-1', reason: 'OBSTACLE' });
  });
});

describe('buildOfficeLayout (deterministic local generator; not PostgreSQL)', () => {
  it('produces identical decor and doors on every call', () => {
    const rooms = [room(), neighbour];
    expect(buildOfficeLayout(workspace, rooms)).toEqual(buildOfficeLayout(workspace, rooms));
  });

  it('ignores rooms from other workspaces and organizations', () => {
    const foreign = [
      room({ id: 'foreign-ws', workspaceId: 'ws-other' }),
      room({ id: 'foreign-org', organizationId: 'org-other' }),
    ];
    const layout = buildOfficeLayout(workspace, foreign);
    expect(layout.decor).toEqual([]);
    expect(layout.obstacles).toEqual([]);
    expect(layout.portals).toEqual([]);
  });
});

describe('createDefaultWorkspace (local seed data)', () => {
  it('creates a connected eight-room floor with role-gated zones', () => {
    const { workspace: seeded, rooms } = createDefaultWorkspace('org-1');
    expect(seeded.width).toBe(1400);
    expect(seeded.height).toBe(900);
    expect(rooms).toHaveLength(8);
    expect(new Set(rooms.map((item) => item.id)).size).toBe(8);
    expect(rooms.every((item) => item.workspaceId === seeded.id && item.organizationId === 'org-1')).toBe(true);
    expect(rooms.find((item) => item.name === 'Private Offices')?.allowedRoles).not.toContain('student');
    expect(rooms.find((item) => item.name === 'Reception')?.allowedRoles).toContain('guest');
    const layout = buildOfficeLayout(seeded, rooms);
    expect(layout.portals.length).toBeGreaterThan(3);
    expect(layout.decor.some((item) => item.kind === 'door')).toBe(true);
  });
});

describe('authorizeWorldConnection (local logic; not PostgreSQL)', () => {
  it('requires a workspace in the same organization', () => {
    expect(authorizeWorldConnection({
      role: 'student', membershipStatus: 'active', workspace: undefined, orgId: 'org-1',
    })).toEqual({ ok: false, reason: 'WORKSPACE_NOT_FOUND' });
    expect(authorizeWorldConnection({
      role: 'student', membershipStatus: 'active', workspace, orgId: 'org-other',
    })).toEqual({ ok: false, reason: 'WORKSPACE_NOT_FOUND' });
  });

  it('requires active membership unless the user is a super admin', () => {
    expect(authorizeWorldConnection({
      role: 'student', membershipStatus: 'suspended', workspace, orgId: 'org-1',
    })).toEqual({ ok: false, reason: 'MEMBERSHIP_INACTIVE' });
    expect(authorizeWorldConnection({
      role: 'super_admin', membershipStatus: null, workspace, orgId: 'org-1',
    })).toEqual({ ok: true });
  });

  it('requires a role with the world:connect permission', () => {
    expect(authorizeWorldConnection({
      role: 'student' as Role, membershipStatus: 'active', workspace, orgId: 'org-1',
    })).toEqual({ ok: true });
    expect(authorizeWorldConnection({
      role: 'unknown' as Role, membershipStatus: 'active', workspace, orgId: 'org-1',
    })).toEqual({ ok: false, reason: 'ROLE_NOT_ALLOWED' });
  });
});
