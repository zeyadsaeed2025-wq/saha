import type { Role } from '../types.js';

type ClientPermission =
  | 'org:update' | 'member:manage' | 'workspace:manage' | 'schedule:manage'
  | 'attendance:correct' | 'report:read' | 'report:export' | 'invitation:manage' | 'link:manage'
  | 'team:read' | 'team:manage' | 'guest:manage' | 'meeting:manage' | 'recording:read'
  | 'message:read' | 'message:send' | 'notification:read' | 'billing:manage'
  | 'plan:manage' | 'admin:access' | 'audit:read' | 'integration:manage' | 'customization:manage';

const adminPermissions: ClientPermission[] = [
  'org:update', 'member:manage', 'workspace:manage', 'schedule:manage', 'attendance:correct',
  'report:read', 'report:export', 'invitation:manage', 'link:manage', 'team:read', 'team:manage',
  'guest:manage', 'meeting:manage', 'recording:read', 'message:read', 'message:send',
  'notification:read', 'billing:manage', 'plan:manage', 'admin:access', 'audit:read',
  'integration:manage', 'customization:manage',
];

const matrix: Record<Role, ClientPermission[]> = {
  super_admin: adminPermissions,
  org_admin: adminPermissions,
  mentor: ['schedule:manage', 'report:read', 'team:read', 'meeting:manage', 'message:read', 'message:send', 'notification:read'],
  student: ['message:read', 'message:send', 'notification:read'],
  guest: [],
};

/** UI-only visibility helper. The server remains authoritative for all permissions. */
export const can = (role: Role | undefined, permission: ClientPermission): boolean =>
  role ? matrix[role].includes(permission) : false;
