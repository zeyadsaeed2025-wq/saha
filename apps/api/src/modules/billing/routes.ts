import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { inOrg, store } from '../../common/store.js';
import {
  asyncRoute, getAuth, logAudit, requireOrg, requirePermission, scopedUserIds,
} from '../../common/middleware.js';
import { badRequest } from '../../common/errors.js';
import type { Subscription } from '../../domain/types.js';
import { getEntitlements, type Entitlements } from './entitlements.js';
import { ensurePlans } from './plans.js';

export const billingRouter = Router({ mergeParams: true });

billingRouter.use(requireOrg);

type SerializableEntitlements = Pick<
  Entitlements, 'planId' | 'planName' | 'status' | 'limits' | 'usage' | 'remaining' | 'features'
>;

/** Strips the allow/assert closures so entitlements can be returned as JSON. */
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

const subscribeSchema = z.object({
  planId: z.string().min(1).max(120),
  interval: z.enum(['monthly', 'annual']).optional(),
});

const cancelSchema = z.object({
  atPeriodEnd: z.boolean().optional(),
});

billingRouter.get('/overview', requirePermission('billing:read'), (req, res) => {
  const orgId = req.params.orgId!;
  const result = store.read((state) => {
    const subscriptions = inOrg(state.subscriptions, orgId);
    const active = subscriptions.filter((item) => item.status !== 'cancelled')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    return {
      entitlements: serializeEntitlements(getEntitlements(state, orgId)),
      subscription: active ?? subscriptions[0] ?? null,
      invoices: inOrg(state.invoices, orgId),
    };
  });
  res.json(result);
});

billingRouter.get('/plans', requirePermission('billing:read'), asyncRoute(async (_req, res) => {
  const plans = await store.mutate((draft) => {
    ensurePlans(draft);
    return draft.plans.filter((plan) => plan.status === 'active');
  });
  res.json({ plans });
}));

billingRouter.post('/subscribe', requirePermission('billing:manage'), asyncRoute(async (req, res) => {
  const parsed = subscribeSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest('A planId is required');
  const auth = getAuth(req)!;
  const orgId = req.params.orgId!;

  const subscription = await store.mutate((draft) => {
    ensurePlans(draft);
    const plan = draft.plans.find((item) => item.id === parsed.data.planId && item.status === 'active');
    if (!plan) throw badRequest('Unknown or inactive plan', 'UNKNOWN_PLAN');

    const now = new Date();
    const interval = parsed.data.interval ?? plan.interval;
    const periodDays = interval === 'annual' ? 365 : 30;
    const existing = inOrg(draft.subscriptions, orgId)[0];
    const next: Subscription = existing ?? {
      id: randomUUID(),
      organizationId: orgId,
      planId: plan.id,
      interval,
      status: 'trialing',
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
    next.status = 'trialing';
    next.trialEndsAt = new Date(now.getTime() + 14 * 86_400_000).toISOString();
    next.currentPeriodStart = now.toISOString();
    next.currentPeriodEnd = new Date(now.getTime() + periodDays * 86_400_000).toISOString();
    next.cancelAtPeriodEnd = false;
    next.graceUntil = null;
    next.updatedAt = now.toISOString();
    if (!existing) draft.subscriptions.push(next);

    logAudit(draft, auth, 'billing.subscription_started', next.id, {
      planId: plan.id,
      interval,
      // A trial is local state only; no payment is collected or implied.
      paymentCollected: false,
    });
    return next;
  });
  res.json({ subscription });
}));

billingRouter.post('/cancel', requirePermission('billing:manage'), asyncRoute(async (req, res) => {
  const parsed = cancelSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw badRequest('Invalid cancellation request');
  const auth = getAuth(req)!;
  const subscription = await store.mutate((draft) => {
    const current = inOrg(draft.subscriptions, req.params.orgId!)[0];
    if (!current) throw badRequest('No subscription found for this organization', 'NO_SUBSCRIPTION');
    const atPeriodEnd = parsed.data.atPeriodEnd !== false;
    current.cancelAtPeriodEnd = atPeriodEnd;
    current.updatedAt = new Date().toISOString();
    logAudit(draft, auth, 'billing.cancel_scheduled', current.id, { atPeriodEnd });
    return current;
  });
  // Access is intentionally unchanged: cancellation only takes effect at period end.
  res.json({ subscription });
}));

billingRouter.get('/export', requirePermission('billing:read'), (req, res) => {
  const auth = getAuth(req)!;
  const orgId = req.params.orgId!;
  const visibleUserIds = scopedUserIds(auth, orgId);
  const result = store.read((state) => {
    const scheduledById = new Map(inOrg(state.scheduledSessions, orgId).map((item) => [item.id, item]));
    const usersById = new Map(state.users.map((user) => [user.id, user]));
    return {
      exportedAt: new Date().toISOString(),
      organization: state.organizations.find((org) => org.id === orgId) ?? null,
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
      workspaces: inOrg(state.workspaces, orgId).map((workspace) => ({
        id: workspace.id,
        name: workspace.name,
        description: workspace.description,
        createdAt: workspace.createdAt,
      })),
      attendanceSessions: inOrg(state.attendanceSessions, orgId)
        .filter((item) => !visibleUserIds || visibleUserIds.has(item.userId))
        .map((item) => ({
          id: item.id,
          userId: item.userId,
          scheduledSessionId: item.scheduledSessionId,
          title: scheduledById.get(item.scheduledSessionId)?.title ?? '',
          status: item.status,
          firstJoin: item.firstJoin,
          lastLeave: item.lastLeave,
          confirmedConnectedSeconds: item.confirmedConnectedSeconds,
          createdAt: item.createdAt,
        })),
      invoices: inOrg(state.invoices, orgId).map((invoice) => ({
        id: invoice.id,
        subscriptionId: invoice.subscriptionId,
        amountCents: invoice.amountCents,
        currency: invoice.currency,
        status: invoice.status,
        periodStart: invoice.periodStart,
        periodEnd: invoice.periodEnd,
        createdAt: invoice.createdAt,
      })),
    };
  });
  res.json(result);
});

billingRouter.get('/invoices', requirePermission('billing:read'), (req, res) => {
  const invoices = store.read((state) => inOrg(state.invoices, req.params.orgId!));
  res.json({ invoices });
});
