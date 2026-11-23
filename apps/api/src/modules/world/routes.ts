import { Router } from 'express';
import { store } from '../../common/store.js';
import { getAuth, requireOrg, requirePermission } from '../../common/middleware.js';
import { worldRegistry } from './registry.js';
import { buildOfficeLayout } from './layout.js';

export const worldRouter = Router({ mergeParams: true });

worldRouter.use(requireOrg);

worldRouter.get('/layout', requirePermission('world:connect'), (req, res) => {
  const auth = getAuth(req)!;
  const requestedWorkspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';
  const result = store.read((state) => {
    const workspace = state.workspaces.find((item) => (
      item.organizationId === req.params.orgId
      && (!requestedWorkspaceId || item.id === requestedWorkspaceId)
      && (!auth.isGuest || !auth.session.guestWorkspaceId || item.id === auth.session.guestWorkspaceId)
    ));
    if (!workspace) return null;
    return buildOfficeLayout(workspace, state.rooms.filter((room) => room.workspaceId === workspace.id));
  });
  if (!result) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Workspace not found' } });
  res.json(result);
});

worldRouter.get('/presence', requirePermission('world:connect'), (req, res) => {
  const auth = getAuth(req)!;
  const result = store.read((state) => {
    const requestedWorkspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';
    const workspaceIds = state.workspaces
      .filter((w) => w.organizationId === req.params.orgId)
      .filter((w) => (!requestedWorkspaceId || w.id === requestedWorkspaceId))
      .filter((w) => (!auth.isGuest || !auth.session.guestWorkspaceId || w.id === auth.session.guestWorkspaceId))
      .map((w) => w.id);
    const online = worldRegistry.all()
      .filter((p) => workspaceIds.includes(p.workspaceId))
      .map((p) => ({
        userId: p.userId,
        name: state.users.find((u) => u.id === p.userId)?.name ?? p.name,
        roomId: p.roomId,
        roomName: state.rooms.find((r) => r.id === p.roomId)?.name ?? '',
        x: p.x, y: p.y, color: p.color,
      }));
    const occupancy: Record<string, number> = {};
    for (const p of online) occupancy[p.roomId] = (occupancy[p.roomId] ?? 0) + 1;
    return { online, occupancy, count: online.length };
  });
  res.json(result);
});
