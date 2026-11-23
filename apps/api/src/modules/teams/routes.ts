import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { store, findInOrg } from '../../common/store.js';
import { asyncRoute, getAuth, logAudit, requireOrg, requirePermission } from '../../common/middleware.js';
import { badRequest, conflict } from '../../common/errors.js';

export const teamsRouter = Router({ mergeParams: true });

teamsRouter.use(requireOrg);

const teamSchema = z.object({
  name: z.string().min(2).max(80),
  description: z.string().max(240).default(''),
  leadUserId: z.string().uuid().nullable().optional(),
});

teamsRouter.get('/', requirePermission('team:read'), (req, res) => {
  const teams = store.read((state) => {
    const orgId = req.params.orgId!;
    return state.teams.filter((t) => t.organizationId === orgId).map((team) => ({
      ...team,
      leadName: state.users.find((u) => u.id === team.leadUserId)?.name ?? null,
      memberCount: state.memberships.filter((m) => m.organizationId === orgId && m.team === team.name && m.status === 'active').length,
    }));
  });
  res.json({ teams });
});

teamsRouter.post('/', requirePermission('team:manage'), asyncRoute(async (req, res) => {
  const parsed = teamSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest('A team name of at least 2 characters is required');
  const auth = getAuth(req)!;
  const created = await store.mutate((draft) => {
    const orgId = req.params.orgId!;
    if (draft.teams.some((t) => t.organizationId === orgId && t.name.toLowerCase() === parsed.data.name.toLowerCase())) {
      throw conflict('A team with this name already exists', 'DUPLICATE_TEAM');
    }
    if (parsed.data.leadUserId) {
      const lead = draft.memberships.find((m) => m.organizationId === orgId && m.userId === parsed.data.leadUserId && m.status === 'active');
      if (!lead) throw badRequest('The team lead must be an active member of this organization', 'NOT_FOUND');
    }
    const team = {
      id: randomUUID(), organizationId: orgId, name: parsed.data.name,
      description: parsed.data.description, leadUserId: parsed.data.leadUserId ?? null,
      createdAt: new Date().toISOString(),
    };
    draft.teams.push(team);
    logAudit(draft, auth, 'team.created', team.id, { name: team.name });
    return team;
  });
  res.status(201).json({ team: created });
}));

teamsRouter.patch('/:id', requirePermission('team:manage'), asyncRoute(async (req, res) => {
  const parsed = teamSchema.partial().safeParse(req.body);
  if (!parsed.success) throw badRequest('Invalid team update');
  const auth = getAuth(req)!;
  const updated = await store.mutate((draft) => {
    const team = findInOrg(draft.teams, req.params.orgId, req.params.id);
    if (!team) throw badRequest('Team not found', 'NOT_FOUND');
    const previousName = team.name;
    if (parsed.data.name && draft.teams.some((t) => t.organizationId === team.organizationId
      && t.id !== team.id && t.name.toLowerCase() === parsed.data.name!.toLowerCase())) {
      throw conflict('A team with this name already exists', 'DUPLICATE_TEAM');
    }
    if (parsed.data.leadUserId) {
      const lead = draft.memberships.find((m) => m.organizationId === team.organizationId
        && m.userId === parsed.data.leadUserId && m.status === 'active');
      if (!lead) throw badRequest('The team lead must be an active member of this organization', 'NOT_FOUND');
    }
    if (parsed.data.name) team.name = parsed.data.name;
    if (parsed.data.description !== undefined) team.description = parsed.data.description;
    if (parsed.data.leadUserId !== undefined) team.leadUserId = parsed.data.leadUserId;
    if (team.name !== previousName) {
      for (const membership of draft.memberships) {
        if (membership.organizationId === team.organizationId && membership.team === previousName) {
          membership.team = team.name;
        }
      }
    }
    logAudit(draft, auth, 'team.updated', team.id, parsed.data);
    return team;
  });
  res.json({ team: updated });
}));

teamsRouter.delete('/:id', requirePermission('team:manage'), asyncRoute(async (req, res) => {
  const auth = getAuth(req)!;
  await store.mutate((draft) => {
    const team = findInOrg(draft.teams, req.params.orgId, req.params.id);
    if (!team) throw badRequest('Team not found', 'NOT_FOUND');
    if (draft.memberships.some((m) => m.organizationId === team.organizationId && m.team === team.name && m.status === 'active')) {
      throw badRequest('Move or remove the team members before deleting this team', 'TEAM_NOT_EMPTY');
    }
    draft.teams = draft.teams.filter((t) => t.id !== team.id);
    logAudit(draft, auth, 'team.deleted', team.id, { name: team.name });
  });
  res.json({ ok: true });
}));

teamsRouter.post('/:id/members', requirePermission('team:manage'), asyncRoute(async (req, res) => {
  const parsed = z.object({ membershipId: z.string().uuid() }).safeParse(req.body);
  if (!parsed.success) throw badRequest('A membership id is required');
  const auth = getAuth(req)!;
  const updated = await store.mutate((draft) => {
    const team = findInOrg(draft.teams, req.params.orgId, req.params.id);
    if (!team) throw badRequest('Team not found', 'NOT_FOUND');
    const membership = findInOrg(draft.memberships, req.params.orgId, parsed.data.membershipId);
    if (!membership) throw badRequest('Member not found', 'NOT_FOUND');
    const previous = membership.team;
    membership.team = team.name;
    logAudit(draft, auth, 'team.member_moved', team.id, { membershipId: membership.id, from: previous, to: team.name });
    return membership;
  });
  res.json({ membership: updated });
}));
