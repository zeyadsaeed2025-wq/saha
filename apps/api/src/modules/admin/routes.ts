import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { inOrg, store } from '../../common/store.js';
import {
  asyncRoute, getAuth, logAudit, requireAuth, requirePermission, setAuth,
} from '../../common/middleware.js';
import { badRequest, conflict, notFound } from '../../common/errors.js';
import { revokeWorldCredentials } from '../../common/security.js';
import type { Plan, Subscription } from '../../domain/types.js';
import {
  DEFAULT_LIMITS, FEATURE_KEYS, getEntitlements, type Entitlements,
} from '../billing/entitlements.js';
import { ensurePlans } from '../billing/plans.js';

export const adminRouter = Router();

adminRouter.use(requireAuth);
// Cross-org admin routes do not use requireOrg, so the super-admin role must be
// resolved here instead of relying on the org-scoped middleware.
adminRouter.use((req, _res, next) => {
  const auth = getAuth(req);
  if (!auth) return next();
  const isSuper = auth.user.id === 'super-admin-seed' || store.read((state) =>
    state.memberships.some((membership) => membership.userId === auth.user.id
      && membership.status === 'active' && membership.role === 'super_admin'));
  if (isSuper && auth.role !== 'super_admin') setAuth(req, { ...auth, role: 'super_admin' });
  next();
});
adminRouter.use(requirePermission('admin:access'));

type SerializableEntitlements = Pick<
  Entitlements, 'planId' | 'planName' | 'status' | 'limits' | 'usage' | 'remaining' | 'features'
>;

function serializeEntitlements(entitlements: Entitlements): SerializableEntitlements {
  return {
    planId: entitlements.planId,
    planName: entitlements.planName,
    status: entitlements.status,
    limits: entitlements.limits,
    usage: entitlements.usage,
    remaining: entitlements.remaining,
    features: entitlements.features,
  };
}

function entitlementsSummary(entitlements: Entitlements) {
  return {
    planName: entitlements.planName,
    status: entitlements.status,
    usage: {
      members: entitlements.usage.members,
      rooms: entitlements.usage.rooms,
      meetingsPerMonth: entitlements.usage.meetingsPerMonth,
    },
    remaining: {
      members: entitlements.remaining.members,
      rooms: entitlements.remaining.rooms,
    },
  };
}

const statusSchema = z.object({ status: z.enum(['active', 'suspended']) });
const planSchema = z.object({ planId: z.string().min(1).max(120) });

const planLimitsSchema = z.object({
  members: z.number().int().min(0),
  rooms: z.number().int().min(0),
  workspaces: z.number().int().min(0),
  concurrentUsers: z.number().int().min(0),
  recordingMinutes: z.number().int().min(0),
  storageGb: z.number().int().min(0),
  meetingsPerMonth: z.number().int().min(0),
}).partial();

const planWriteSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(500).default(''),
  interval: z.enum(['monthly', 'annual']).default('monthly'),
  priceCents: z.number().int().min(0).default(0),
  limits: planLimitsSchema.default({}),
  featureKeys: z.array(z.enum([...FEATURE_KEYS])).max(FEATURE_KEYS.length).default([]),
  status: z.enum(['active', 'archived']).default('active'),
});
const planPatchSchema = planWriteSchema.partial();

/** Full platform plan catalog, including archived plans for auditability. */
adminRouter.get('/plans', asyncRoute(async (_req, res) => {
  const plans = await store.mutate((draft) => {
    ensurePlans(draft);
    return draft.plans;
  });
  res.json({ plans });
}));

adminRouter.post('/plans', asyncRoute(async (req, res) => {
  const parsed = planWriteSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest('Invalid plan payload');
  const auth = getAuth(req)!;
  const input = parsed.data;
  const plan: Plan = {
    id: `plan-${randomUUID()}`,
    name: input.name,
    description: input.description,
    interval: input.interval,
    priceCents: input.priceCents,
    currency: 'USD',
    features: [...input.featureKeys],
    featureKeys: [...input.featureKeys],
    limits: { ...DEFAULT_LIMITS, ...input.limits },
    status: input.status,
    createdAt: new Date().toISOString(),
  };
  await store.mutate((draft) => {
    draft.plans.push(plan);
    logAudit(draft, auth, 'admin.plan_created', plan.id, {
      planId: plan.id, interval: plan.interval, featureKeys: plan.featureKeys,
    });
  });
  res.status(201).json({ plan });
}));

adminRouter.patch('/plans/:id', asyncRoute(async (req, res) => {
  const parsed = planPatchSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest('Invalid plan update');
  const auth = getAuth(req)!;
  const planId = req.params.id!;
  const input = parsed.data;
  const plan = await store.mutate((draft) => {
    const target = draft.plans.find((item) => item.id === planId);
    if (!target) throw notFound('Plan not found');
    if (input.name !== undefined) target.name = input.name;
    if (input.description !== undefined) target.description = input.description;
    if (input.interval !== undefined) target.interval = input.interval;
    if (input.priceCents !== undefined) target.priceCents = input.priceCents;
    if (input.limits !== undefined) target.limits = { ...target.limits, ...input.limits };
    if (input.featureKeys !== undefined) {
      target.featureKeys = [...input.featureKeys];
      target.features = [...input.featureKeys];
    }
    if (input.status !== undefined) target.status = input.status;
    logAudit(draft, auth, 'admin.plan_updated', planId, { fields: Object.keys(input) });
    return target;
  });
  res.json({ plan });
}));

adminRouter.post('/plans/:id/status', asyncRoute(async (req, res) => {
  const parsed = z.object({ status: z.enum(['active', 'archived']) }).safeParse(req.body);
  if (!parsed.success) throw badRequest('Status must be active or archived');
  const auth = getAuth(req)!;
  const planId = req.params.id!;
  if (parsed.data.status === 'archived') {
    const inUse = store.read((state) => state.subscriptions.some(
      (subscription) => subscription.planId === planId && subscription.status !== 'cancelled'));
    if (inUse) throw conflict('Plan is assigned to an active subscription', 'PLAN_IN_USE');
  }
  const plan = await store.mutate((draft) => {
    const target = draft.plans.find((item) => item.id === planId);
    if (!target) throw notFound('Plan not found');
    target.status = parsed.data.status;
    logAudit(draft, auth, 'admin.plan_status', planId, { status: target.status });
    return target;
  });
  res.json({ plan });
}));

adminRouter.get('/organizations', (req, res) => {
  const now = Date.now();
  const organizations = store.read((state) => state.organizations.map((org) => ({
    id: org.id,
    name: org.name,
    slug: org.slug,
    status: org.status,
    createdAt: org.createdAt,
    memberCount: inOrg(state.memberships, org.id).filter((member) => member.status === 'active').length,
    activeSessions: state.authSessions.filter((session) => session.activeOrgId === org.id
      && !session.revokedAt && new Date(session.expiresAt).getTime() > now).length,
    entitlements: entitlementsSummary(getEntitlements(state, org.id)),
  })));
  res.json({ organizations });
});

adminRouter.get('/organizations/:orgId', asyncRoute(async (req, res) => {
  const orgId = req.params.orgId!;
  const result = store.read((state) => {
    const organization = state.organizations.find((org) => org.id === orgId);
    if (!organization) return null;
    const usersById = new Map(state.users.map((user) => [user.id, user]));
    return {
      organization,
      entitlements: serializeEntitlements(getEntitlements(state, orgId)),
      members: inOrg(state.memberships, orgId).map((membership) => {
        const user = usersById.get(membership.userId);
        return {
          id: membership.id,
          userId: membership.userId,
          name: user?.name ?? '',
          phone: user?.phone ?? '',
          role: membership.role,
          team: membership.team,
          status: membership.status,
          joinedAt: membership.joinedAt,
        };
      }),
      auditLogs: state.auditLogs
        .filter((log) => log.organizationId === orgId)
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, 20),
    };
  });
  if (!result) throw notFound('Organization not found');
  res.json(result);
}));

adminRouter.patch('/organizations/:orgId/status', asyncRoute(async (req, res) => {
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest('Status must be active or suspended');
  const auth = getAuth(req)!;
  const orgId = req.params.orgId!;
  const result = await store.mutate((draft) => {
    const organization = draft.organizations.find((org) => org.id === orgId);
    if (!organization) throw notFound('Organization not found');
    organization.status = parsed.data.status;

    let sessionsRevoked = 0;
    if (parsed.data.status === 'suspended') {
      const at = new Date().toISOString();
      for (const session of draft.authSessions) {
        if (session.activeOrgId !== orgId) continue;
        revokeWorldCredentials(draft, session.id, at);
        if (!session.revokedAt) {
          session.revokedAt = at;
          sessionsRevoked += 1;
        }
      }
    }
    logAudit(draft, { ...auth, orgId }, 'admin.organization_status', orgId, {
      status: parsed.data.status,
      sessionsRevoked,
    });
    return { organization, sessionsRevoked };
  });
  res.json(result);
}));

adminRouter.post('/organizations/:orgId/plan', asyncRoute(async (req, res) => {
  const parsed = planSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest('A planId is required');
  const auth = getAuth(req)!;
  const orgId = req.params.orgId!;
  const subscription = await store.mutate((draft) => {
    ensurePlans(draft);
    if (!draft.organizations.some((org) => org.id === orgId)) throw notFound('Organization not found');
    const plan = draft.plans.find((item) => item.id === parsed.data.planId && item.status === 'active');
    if (!plan) throw badRequest('Unknown or inactive plan', 'UNKNOWN_PLAN');

    const now = new Date();
    const interval = plan.interval;
    const periodDays = interval === 'annual' ? 365 : 30;
    const existing = inOrg(draft.subscriptions, orgId)[0];
    const next: Subscription = existing ?? {
      id: randomUUID(),
      organizationId: orgId,
      planId: plan.id,
      interval,
      status: 'active',
      trialEndsAt: null,
      currentPeriodStart: now.toISOString(),
      currentPeriodEnd: now.toISOString(),
      cancelAtPeriodEnd: false,
      graceUntil: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    next.planId = plan.id;
    next.interval = interval;
    next.status = 'active';
    next.trialEndsAt = null;
    next.currentPeriodStart = now.toISOString();
    next.currentPeriodEnd = new Date(now.getTime() + periodDays * 86_400_000).toISOString();
    next.cancelAtPeriodEnd = false;
    next.graceUntil = null;
    next.updatedAt = now.toISOString();
    if (!existing) draft.subscriptions.push(next);

    logAudit(draft, { ...auth, orgId }, 'admin.plan_assigned', next.id, {
      planId: plan.id, interval, billingEffect: 'local plan assignment only; no charge',
    });
    return next;
  });
  res.json({ subscription });
}));

adminRouter.get('/audit', requirePermission('audit:read'), (req, res) => {
  const orgFilter = typeof req.query.orgId === 'string' ? req.query.orgId : '';
  const actionFilter = typeof req.query.action === 'string' ? req.query.action : '';
  const requested = Number(req.query.limit);
  const limit = Number.isFinite(requested) && requested > 0
    ? Math.min(100, Math.floor(requested))
    : 100;
  const logs = store.read((state) => state.auditLogs
    .filter((log) => (!orgFilter || log.organizationId === orgFilter)
      && (!actionFilter || log.action === actionFilter))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit));
  res.json({ logs });
});

adminRouter.get('/support/:orgId', asyncRoute(async (req, res) => {
  const orgId = req.params.orgId!;
  const result = store.read((state) => {
    const organization = state.organizations.find((org) => org.id === orgId);
    if (!organization) return null;
    return {
      organization,
      memberCount: inOrg(state.memberships, orgId).filter((member) => member.status === 'active').length,
      attendanceSessions: inOrg(state.attendanceSessions, orgId).length,
      meetings: inOrg(state.meetings, orgId).length,
      recordings: inOrg(state.recordings, orgId).length,
      entitlements: entitlementsSummary(getEntitlements(state, orgId)),
      impersonation: {
        available: false,
        reason: 'Impersonation requires explicit owner approval and a separate audited token flow.',
      },
    };
  });
  if (!result) throw notFound('Organization not found');
  res.json(result);
}));
