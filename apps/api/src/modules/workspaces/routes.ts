import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { store, findInOrg } from '../../common/store.js';
import { asyncRoute, getAuth, logAudit, requireOrg, requirePermission } from '../../common/middleware.js';
import { badRequest } from '../../common/errors.js';
import { getEntitlements } from '../billing/entitlements.js';
import { createDefaultWorkspace } from './defaults.js';

export const workspacesRouter = Router({ mergeParams: true });

workspacesRouter.use(requireOrg);

workspacesRouter.get('/', requirePermission('workspace:read'), (req, res) => {
  const workspaces = store.read((state) => state.workspaces
    .filter((w) => w.organizationId === req.params.orgId)
    .map((w) => ({ ...w, roomCount: state.rooms.filter((r) => r.workspaceId === w.id).length })));
  res.json({ workspaces });
});

workspacesRouter.get('/:id', requirePermission('workspace:read'), (req, res) => {
  const result = store.read((state) => {
    const workspace = findInOrg(state.workspaces, req.params.orgId, req.params.id);
    if (!workspace) return null;
    return { workspace, rooms: state.rooms.filter((r) => r.workspaceId === workspace.id) };
  });
  if (!result) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Workspace not found' } });
  res.json(result);
});

workspacesRouter.post('/', requirePermission('workspace:manage'), asyncRoute(async (req, res) => {
  const parsed = z.object({ name: z.string().min(2).max(80), description: z.string().max(200).optional() }).safeParse(req.body);
  if (!parsed.success) throw badRequest('A workspace name is required');
  const auth = getAuth(req)!;
  const created = await store.mutate((draft) => {
    const { workspace, rooms } = createDefaultWorkspace(req.params.orgId!);
    const entitlements = getEntitlements(draft, req.params.orgId!);
    entitlements.assert('workspaces', 1);
    entitlements.assert('rooms', rooms.length);
    workspace.name = parsed.data.name;
    workspace.description = parsed.data.description ?? workspace.description;
    draft.workspaces.push(workspace);
    draft.rooms.push(...rooms);
    logAudit(draft, auth, 'workspace.created', workspace.id, { name: workspace.name });
    return { workspace, rooms };
  });
  res.status(201).json(created);
}));

workspacesRouter.patch('/:id/rooms/:roomId', requirePermission('workspace:manage'), asyncRoute(async (req, res) => {
  const parsed = z.object({
    privacy: z.enum(['public', 'private']).optional(),
    capacity: z.number().int().min(1).max(200).optional(),
    allowedRoles: z.array(z.enum(['guest', 'student', 'mentor', 'org_admin', 'super_admin'])).optional(),
  }).safeParse(req.body);
  if (!parsed.success) throw badRequest('Invalid room settings');
  const auth = getAuth(req)!;
  const room = await store.mutate((draft) => {
    const workspace = findInOrg(draft.workspaces, req.params.orgId, req.params.id);
    const target = workspace && draft.rooms.find((r) => r.id === req.params.roomId && r.workspaceId === workspace.id);
    if (!target) throw badRequest('Room not found', 'NOT_FOUND');
    if (parsed.data.privacy) target.privacy = parsed.data.privacy;
    if (parsed.data.capacity) target.capacity = parsed.data.capacity;
    if (parsed.data.allowedRoles) target.allowedRoles = parsed.data.allowedRoles;
    logAudit(draft, auth, 'room.updated', target.id, parsed.data);
    return target;
  });
  res.json({ room });
}));

export const createRoomId = () => randomUUID();
