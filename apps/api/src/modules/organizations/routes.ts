import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { store } from '../../common/store.js';
import { asyncRoute, getAuth, logAudit, requireAuth, requireOrg, requirePermission } from '../../common/middleware.js';
import { badRequest, conflict } from '../../common/errors.js';
import { createDefaultWorkspace } from '../workspaces/defaults.js';

export const organizationsRouter = Router();

organizationsRouter.use(requireAuth);

organizationsRouter.get('/', (req, res) => {
  const auth = getAuth(req)!;
  const orgs = store.read((state) => state.memberships
    .filter((m) => m.userId === auth.user.id && m.status === 'active')
    .map((m) => {
      const org = state.organizations.find((o) => o.id === m.organizationId);
      return org && { ...org, role: m.role, team: m.team };
    })
    .filter(Boolean));
  res.json({ organizations: orgs });
});

organizationsRouter.post('/', asyncRoute(async (req, res) => {
  const parsed = z.object({
    name: z.string().min(2).max(80),
    timezone: z.string().min(3).default('UTC'),
  }).safeParse(req.body);
  if (!parsed.success) throw badRequest('Organization name and timezone are required');
  const { name, timezone } = parsed.data;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'organization';
  const auth = getAuth(req)!;
  const org = await store.mutate((draft) => {
    if (draft.organizations.some((o) => o.slug === slug)) throw conflict('An organization with this name already exists');
    const organization = {
      id: randomUUID(),
      name,
      slug,
      timezone,
      status: 'active' as const,
      settings: { graceMinutesDefault: 10, heartbeatSeconds: 60, verificationWindowMinutes: 15, demo: false },
      createdAt: new Date().toISOString(),
    };
    draft.organizations.push(organization);
    draft.memberships.push({
      id: randomUUID(), organizationId: organization.id, userId: auth.user.id,
      role: 'org_admin', team: 'Leadership', status: 'active', joinedAt: new Date().toISOString(),
    });
    const { workspace, rooms } = createDefaultWorkspace(organization.id);
    draft.workspaces.push(workspace);
    draft.rooms.push(...rooms);
    draft.authSessions.find((s) => s.id === auth.session.id)!.activeOrgId = organization.id;
    logAudit(draft, auth, 'organization.created', organization.id, { name });
    return organization;
  });
  res.status(201).json({ organization: org });
}));

organizationsRouter.get('/:orgId', requireOrg, requirePermission('org:read'), (req, res) => {
  const org = store.read((state) => state.organizations.find((o) => o.id === req.params.orgId));
  res.json({ organization: org });
});

organizationsRouter.patch('/:orgId', requireOrg, requirePermission('org:update'), asyncRoute(async (req, res) => {
  const parsed = z.object({
    name: z.string().min(2).max(80).optional(),
    timezone: z.string().min(3).optional(),
    graceMinutesDefault: z.number().min(0).max(120).optional(),
    heartbeatSeconds: z.number().min(10).max(600).optional(),
    verificationWindowMinutes: z.number().min(0).max(240).optional(),
  }).safeParse(req.body);
  if (!parsed.success) throw badRequest('Invalid organization settings');
  const auth = getAuth(req)!;
  const updated = await store.mutate((draft) => {
    const org = draft.organizations.find((o) => o.id === req.params.orgId)!;
    if (parsed.data.name) org.name = parsed.data.name;
    if (parsed.data.timezone) org.timezone = parsed.data.timezone;
    if (parsed.data.graceMinutesDefault !== undefined) org.settings.graceMinutesDefault = parsed.data.graceMinutesDefault;
    if (parsed.data.heartbeatSeconds !== undefined) org.settings.heartbeatSeconds = parsed.data.heartbeatSeconds;
    if (parsed.data.verificationWindowMinutes !== undefined) org.settings.verificationWindowMinutes = parsed.data.verificationWindowMinutes;
    logAudit(draft, auth, 'organization.updated', org.id, parsed.data);
    return org;
  });
  res.json({ organization: updated });
}));
