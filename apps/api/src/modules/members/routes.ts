import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { store, findInOrg } from '../../common/store.js';
import { hashPassword, normalizePhone, randomToken, roleRank } from '../../common/security.js';
import { asyncRoute, getAuth, logAudit, requireOrg, requirePermission } from '../../common/middleware.js';
import { badRequest, conflict } from '../../common/errors.js';
import { getEntitlements } from '../billing/entitlements.js';
import type { Role } from '../../domain/types.js';

export const membersRouter = Router({ mergeParams: true });

membersRouter.use(requireOrg);

membersRouter.get('/', requirePermission('member:read'), (req, res) => {
  const members = store.read((state) => state.memberships
    .filter((m) => m.organizationId === req.params.orgId)
    .map((m) => {
      const user = state.users.find((u) => u.id === m.userId);
      return user && {
        id: m.id, userId: user.id, name: user.name, phone: user.phone,
        role: m.role, team: m.team, status: m.status, joinedAt: m.joinedAt,
      };
    })
    .filter(Boolean));
  res.json({ members });
});

const addSchema = z.object({
  phone: z.string().min(8),
  name: z.string().min(2).max(80),
  role: z.enum(['org_admin', 'mentor', 'student']),
  team: z.string().min(1).max(60).default('General'),
});

membersRouter.post('/', requirePermission('member:manage'), asyncRoute(async (req, res) => {
  const parsed = addSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest('Name, phone, role and team are required');
  const phone = normalizePhone(parsed.data.phone);
  const auth = getAuth(req)!;
  if (roleRank[parsed.data.role] > roleRank[auth.role]) throw badRequest('You cannot assign a higher role than your own');
  const result = await store.mutate((draft) => {
    const existing = draft.memberships.find((m) => m.organizationId === req.params.orgId
      && draft.users.find((u) => u.id === m.userId)?.phone === phone);
    if (existing) throw conflict('This phone is already a member', 'DUPLICATE_MEMBER');
    getEntitlements(draft, req.params.orgId!).assert('members', 1);
    let user = draft.users.find((u) => u.phone === phone);
    const temporaryPassword = user ? null : randomToken(12);
    if (!user) {
      user = {
        id: randomUUID(), phone, name: parsed.data.name,
        passwordHash: hashPassword(temporaryPassword!), status: 'active',
        verifiedAt: null, createdAt: new Date().toISOString(),
      };
      draft.users.push(user);
    }
    const membership = {
      id: randomUUID(), organizationId: req.params.orgId!, userId: user.id,
      role: parsed.data.role, team: parsed.data.team, status: 'active' as const,
      joinedAt: new Date().toISOString(),
    };
    draft.memberships.push(membership);
    logAudit(draft, auth, 'member.added', membership.id, { phone, role: membership.role });
    return { membership, temporaryPassword };
  });
  res.status(201).json({ member: result.membership, temporaryPassword: result.temporaryPassword,
    notice: result.temporaryPassword ? 'Share this one-time temporary password securely; it will not be shown again.' : null });
}));

membersRouter.patch('/:id', requirePermission('member:manage'), asyncRoute(async (req, res) => {
  const parsed = z.object({
    role: z.enum(['org_admin', 'mentor', 'student']).optional(),
    team: z.string().min(1).max(60).optional(),
    status: z.enum(['active', 'suspended']).optional(),
  }).safeParse(req.body);
  if (!parsed.success) throw badRequest('Invalid member update');
  const auth = getAuth(req)!;
  if (parsed.data.role && roleRank[parsed.data.role] > roleRank[auth.role]) throw badRequest('You cannot assign a higher role than your own');
  const membership = await store.mutate((draft) => {
    const target = findInOrg(draft.memberships, req.params.orgId, req.params.id);
    if (!target) throw badRequest('Member not found', 'NOT_FOUND');
    if (target.userId === auth.user.id && parsed.data.role && parsed.data.role !== 'org_admin') {
      throw badRequest('You cannot change your own admin role');
    }
    if (parsed.data.role) target.role = parsed.data.role;
    if (parsed.data.team) target.team = parsed.data.team;
    if (parsed.data.status) target.status = parsed.data.status;
    logAudit(draft, auth, 'member.updated', target.id, parsed.data);
    return target;
  });
  res.json({ membership });
}));

membersRouter.delete('/:id', requirePermission('member:manage'), asyncRoute(async (req, res) => {
  const auth = getAuth(req)!;
  await store.mutate((draft) => {
    const target = findInOrg(draft.memberships, req.params.orgId, req.params.id);
    if (!target) throw badRequest('Member not found', 'NOT_FOUND');
    if (target.userId === auth.user.id) throw badRequest('You cannot remove yourself');
    draft.memberships = draft.memberships.filter((m) => m.id !== target.id);
    logAudit(draft, auth, 'member.removed', target.id, {});
  });
  res.json({ ok: true });
}));
