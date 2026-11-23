import { AppError } from '../../common/errors.js';
import type { DbState, PlanLimits } from '../../domain/types.js';
import { worldRegistry } from '../world/registry.js';

export type UsageMetric =
  | 'members' | 'rooms' | 'workspaces' | 'concurrentUsers'
  | 'recordingMinutes' | 'storageGb' | 'meetingsPerMonth';

export const FEATURE_KEYS = [
  'media', 'recording', 'integrations', 'ai', 'customization', 'publicApi',
] as const;
export type FeatureKey = typeof FEATURE_KEYS[number];

/** Baseline capabilities. Existing plans without featureKeys keep current behavior. */
export const DEFAULT_FEATURES: FeatureKey[] = [...FEATURE_KEYS];

export const USAGE_METRICS: UsageMetric[] = [
  'members', 'rooms', 'workspaces', 'concurrentUsers',
  'recordingMinutes', 'storageGb', 'meetingsPerMonth',
];

/**
 * Generous built-in defaults so an organization without an explicit plan still
 * has enforceable quotas. These are product defaults, not a fake subscription.
 */
export const DEFAULT_LIMITS: PlanLimits = {
  members: 100,
  rooms: 50,
  workspaces: 10,
  concurrentUsers: 50,
  recordingMinutes: 3_000,
  storageGb: 50,
  meetingsPerMonth: 1_000,
};

export interface Entitlements {
  planId: string | null;
  planName: string;
  status: string;
  limits: PlanLimits;
  usage: Record<UsageMetric, number>;
  remaining: Record<UsageMetric, number>;
  features: FeatureKey[];
  allow: (metric: UsageMetric, delta?: number) => boolean;
  assert: (metric: UsageMetric, delta?: number) => void;
}

function currentUsage(state: DbState, orgId: string, metric: UsageMetric): number {
  switch (metric) {
    case 'members':
      return state.memberships.filter((m) => m.organizationId === orgId && m.status === 'active').length;
    case 'rooms':
      return state.rooms.filter((r) => state.workspaces.some((w) => w.id === r.workspaceId && w.organizationId === orgId)).length;
    case 'workspaces':
      return state.workspaces.filter((w) => w.organizationId === orgId).length;
    case 'meetingsPerMonth': {
      const month = new Date().toISOString().slice(0, 7);
      return state.meetings.filter((m) => m.organizationId === orgId && m.createdAt.startsWith(month)).length;
    }
    case 'concurrentUsers':
      // A live gauge, not a metered total: ADR-002 keeps presence in one
      // process, so the registry is the authoritative concurrent-user count.
      return worldRegistry.all().filter((participant) => participant.organizationId === orgId).length;
    case 'recordingMinutes':
    case 'storageGb':
      return state.usageRecords
        .filter((r) => r.organizationId === orgId && r.metric === metric)
        .reduce((sum, r) => sum + r.value, 0);
    default:
      return 0;
  }
}

/** Feature keys enabled for an organization by its effective plan. Read-only. */
export function featuresFor(state: DbState, orgId: string): FeatureKey[] {
  const subscription = state.subscriptions.find((s) => s.organizationId === orgId
    && s.status !== 'cancelled');
  const plan = subscription ? state.plans.find((p) => p.id === subscription.planId) : null;
  const configured = plan && subscription && subscription.status !== 'past_due'
    ? plan.featureKeys ?? DEFAULT_FEATURES
    : DEFAULT_FEATURES;
  return FEATURE_KEYS.filter((key) => configured.includes(key));
}

export function hasFeature(state: DbState, orgId: string, feature: FeatureKey): boolean {
  return featuresFor(state, orgId).includes(feature);
}

/** Call inside a store.mutate draft when a write depends on a plan capability. */
export function assertFeature(state: DbState, orgId: string, feature: FeatureKey): void {
  if (!hasFeature(state, orgId, feature)) {
    throw new AppError(403, 'FEATURE_NOT_ENABLED',
      `The current plan does not include the ${feature} feature`, { feature });
  }
}

/** Resolves the effective plan and usage for an organization. Read-only. */
export function getEntitlements(state: DbState, orgId: string): Entitlements {
  const subscription = state.subscriptions.find((s) => s.organizationId === orgId
    && s.status !== 'cancelled');
  const plan = subscription ? state.plans.find((p) => p.id === subscription.planId) : null;
  const limits = plan && subscription && subscription.status !== 'past_due'
    ? plan.limits
    : DEFAULT_LIMITS;
  const usage = {} as Record<UsageMetric, number>;
  const remaining = {} as Record<UsageMetric, number>;
  for (const metric of USAGE_METRICS) {
    usage[metric] = currentUsage(state, orgId, metric);
    remaining[metric] = Math.max(0, limits[metric] - usage[metric]);
  }
  const allow = (metric: UsageMetric, delta = 1) => usage[metric] + delta <= limits[metric];
  const assert = (metric: UsageMetric, delta = 1) => {
    if (!allow(metric, delta)) {
      throw new AppError(403, 'QUOTA_EXCEEDED',
        `The ${metric} limit for this plan has been reached`, { metric, limit: limits[metric], usage: usage[metric] });
    }
  };
  return {
    planId: plan?.id ?? null,
    planName: plan?.name ?? 'Default plan',
    status: subscription?.status ?? 'none',
    limits,
    usage,
    remaining,
    features: featuresFor(state, orgId),
    allow,
    assert,
  };
}

/** Adds a metered usage value. Call from within a store.mutate draft. */
export function addUsage(draft: DbState, orgId: string, metric: UsageMetric, value: number, at = new Date().toISOString()): void {
  draft.usageRecords.push({ id: `usage-${orgId}-${metric}-${at}-${Math.round(value * 1000)}`, organizationId: orgId, metric, value, at });
}
