import type { DbState, Plan, PlanLimits } from '../../domain/types.js';
import { DEFAULT_FEATURES, DEFAULT_LIMITS } from './entitlements.js';

export interface CatalogPlan {
  id: string;
  name: string;
  description: string;
  interval: 'monthly' | 'annual';
  priceCents: number;
  limits: PlanLimits;
  features: string[];
}

const FREE_LIMITS: PlanLimits = {
  ...DEFAULT_LIMITS,
  members: 25,
  rooms: 10,
  workspaces: 2,
  concurrentUsers: 10,
  recordingMinutes: 300,
  storageGb: 2,
  meetingsPerMonth: 60,
};

const PRO_LIMITS: PlanLimits = {
  ...DEFAULT_LIMITS,
  members: 250,
  rooms: 100,
  workspaces: 20,
  concurrentUsers: 100,
  recordingMinutes: 10_000,
  storageGb: 200,
  meetingsPerMonth: 5_000,
};

const SCHOOL_LIMITS: PlanLimits = {
  ...DEFAULT_LIMITS,
  members: 2_000,
  rooms: 500,
  workspaces: 100,
  concurrentUsers: 500,
  recordingMinutes: 60_000,
  storageGb: 2_000,
  meetingsPerMonth: 50_000,
};

/**
 * Honest local catalog. Prices are displayed only: subscribing starts a real
 * local trial and never charges a card or claims a payment provider is active.
 */
export const PLAN_CATALOG: CatalogPlan[] = [
  {
    id: 'plan-free',
    name: 'Free',
    description: 'A small virtual office for a single class or team.',
    interval: 'monthly',
    priceCents: 0,
    limits: FREE_LIMITS,
    features: ['25 members', '10 rooms', '2 workspaces', '60 meetings / month'],
  },
  {
    id: 'plan-pro',
    name: 'Pro',
    description: 'Capacity and reporting for a growing school or organization.',
    interval: 'monthly',
    priceCents: 9_900,
    limits: PRO_LIMITS,
    features: ['250 members', '100 rooms', '20 workspaces', '5,000 meetings / month', 'Advanced reports'],
  },
  {
    id: 'plan-school',
    name: 'School',
    description: 'District-scale limits for multi-campus deployments.',
    interval: 'monthly',
    priceCents: 39_900,
    limits: SCHOOL_LIMITS,
    features: ['2,000 members', '500 rooms', '100 workspaces', '50,000 meetings / month', 'Priority support'],
  },
];

/** Inserts missing catalog plans into a mutation draft. Safe to call repeatedly. */
export function ensurePlans(draft: DbState): void {
  const now = new Date().toISOString();
  for (const entry of PLAN_CATALOG) {
    if (draft.plans.some((plan) => plan.id === entry.id)) continue;
    const plan: Plan = {
      id: entry.id,
      name: entry.name,
      description: entry.description,
      interval: entry.interval,
      priceCents: entry.priceCents,
      currency: 'USD',
      features: [...entry.features],
      featureKeys: [...DEFAULT_FEATURES],
      limits: { ...entry.limits },
      status: 'active',
      createdAt: now,
    };
    draft.plans.push(plan);
  }
}
