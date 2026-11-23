import { describe, expect, it } from 'vitest';
import { emptyState, type DbState } from '../domain/types.js';
import { getEntitlements } from '../modules/billing/entitlements.js';
import { worldRegistry, type WorldParticipant } from '../modules/world/registry.js';

function stateWithPlan(concurrentUsers: number): DbState {
  const state = emptyState();
  state.plans.push({
    id: 'plan-tiny', name: 'Tiny', description: 'test plan', interval: 'monthly',
    priceCents: 100, currency: 'EGP', features: [], status: 'active',
    limits: { ...getEntitlements(state, 'org-1').limits, concurrentUsers },
    createdAt: '2026-11-23T00:00:00.000Z',
  });
  state.subscriptions.push({
    id: 'sub-1', organizationId: 'org-1', planId: 'plan-tiny', status: 'active',
    trialEndsAt: null, currentPeriodStart: '2026-11-01T00:00:00.000Z',
    currentPeriodEnd: '2026-12-01T00:00:00.000Z', cancelAtPeriodEnd: false,
    graceUntil: null, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z',
  });
  return state;
}

function addLive(userId: string, organizationId: string): void {
  const socket = { readyState: 1, OPEN: 1, send: () => undefined } as unknown as WorldParticipant['socket'];
  worldRegistry.add({
    socket, userId, organizationId, name: userId, role: 'student',
    workspaceId: 'ws-1', roomId: 'room-1', x: 0, y: 0, color: '#0e7c7b',
    appearance: { character: 'standard', outfitColor: '#0e7c7b', accessory: null },
    connectedAt: 1, lastSeen: 1,
  });
}

describe('X-ACC-01 concurrent-user entitlement gate', () => {
  it('counts only live world connections in the owning organization', () => {
    const state = stateWithPlan(2);
    addLive('user-1', 'org-1');
    addLive('user-2', 'org-2');
    const entitlements = getEntitlements(state, 'org-1');
    expect(entitlements.usage.concurrentUsers).toBe(1);
    expect(entitlements.allow('concurrentUsers', 1)).toBe(true);
    addLive('user-3', 'org-1');
    expect(getEntitlements(state, 'org-1').allow('concurrentUsers', 1)).toBe(false);
    try {
      getEntitlements(state, 'org-1').assert('concurrentUsers', 1);
      throw new Error('expected QUOTA_EXCEEDED');
    } catch (error) {
      expect((error as { code?: string }).code).toBe('QUOTA_EXCEEDED');
    }
    for (const id of ['user-1', 'user-2', 'user-3']) worldRegistry.remove(id);
  });
});
