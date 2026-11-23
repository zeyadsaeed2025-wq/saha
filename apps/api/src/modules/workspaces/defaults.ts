import { randomUUID } from 'node:crypto';
import type { Role, Room, Workspace } from '../../domain/types.js';

const EVERYONE: Role[] = ['guest', 'student', 'mentor', 'org_admin', 'super_admin'];
const MEMBERS: Role[] = ['student', 'mentor', 'org_admin', 'super_admin'];
const LEADERS: Role[] = ['mentor', 'org_admin', 'super_admin'];
const ADMINS: Role[] = ['org_admin', 'super_admin'];

/** A Gather-inspired default floor plan: distinct zones connected by visible doors. */
export function createDefaultWorkspace(organizationId: string): { workspace: Workspace; rooms: Room[] } {
  const workspace: Workspace = {
    id: randomUUID(),
    organizationId,
    name: 'Main Office',
    description: 'A warm, navigable floor with lobby, focus, meeting and social zones',
    width: 1400,
    height: 900,
    createdAt: new Date().toISOString(),
  };

  const make = (
    name: string,
    kind: Room['kind'],
    privacy: Room['privacy'],
    bounds: Room['bounds'],
    color: string,
    allowedRoles: Role[],
    capacity: number,
  ): Room => ({
    id: randomUUID(),
    workspaceId: workspace.id,
    organizationId,
    name,
    kind,
    privacy,
    bounds,
    color,
    allowedRoles,
    capacity,
  });

  const rooms: Room[] = [
    make('Reception', 'lobby', 'public', { x: 40, y: 40, w: 280, h: 220 }, '#dcefe9', EVERYONE, 12),
    make('Open Workspace', 'open', 'public', { x: 350, y: 40, w: 470, h: 300 }, '#e6ecf8', EVERYONE, 30),
    make('Meeting Room', 'meeting', 'private', { x: 850, y: 40, w: 510, h: 300 }, '#f4dfe1', LEADERS, 10),
    make('Focus Rooms', 'focus', 'public', { x: 40, y: 290, w: 280, h: 280 }, '#eae7f6', MEMBERS, 16),
    make('Private Offices', 'private', 'private', { x: 350, y: 370, w: 470, h: 220 }, '#f7ead9', ADMINS, 6),
    make('Collaboration Area', 'collaboration', 'public', { x: 850, y: 370, w: 510, h: 220 }, '#e3f2dc', EVERYONE, 22),
    make('Lounge', 'social', 'public', { x: 40, y: 600, w: 580, h: 280 }, '#fdeadd', EVERYONE, 20),
    make('Study Hall', 'study', 'public', { x: 650, y: 620, w: 710, h: 260 }, '#e8eef8', MEMBERS, 28),
  ];

  return { workspace, rooms };
}
