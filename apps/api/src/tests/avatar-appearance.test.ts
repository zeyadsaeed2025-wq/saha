import { describe, expect, it } from 'vitest';
import type { AvatarConfig } from '../domain/types.js';
import { DEFAULT_APPEARANCE, resolveAvatarAppearance } from '../modules/customization/appearance.js';
import { worldRegistry, type WorldParticipant } from '../modules/world/registry.js';
import { broadcastAvatarAppearance } from '../modules/world/appearance.js';

const config = (overrides: Partial<AvatarConfig> = {}): AvatarConfig => ({
  userId: 'user-1',
  organizationId: 'org-1',
  character: 'tall',
  outfitColor: '#123abc',
  accessory: 'glasses',
  updatedAt: '2026-11-23T00:00:00.000Z',
  ...overrides,
});

describe('avatar appearance resolution (local state; no database)', () => {
  it('uses the default when no per-organization config exists', () => {
    expect(resolveAvatarAppearance({ avatarConfigs: [] }, 'user-1', 'org-1')).toEqual(DEFAULT_APPEARANCE);
  });

  it('never leaks a config from another tenant or another user', () => {
    const state = { avatarConfigs: [
      config({ organizationId: 'org-2' }),
      config({ userId: 'user-2' }),
    ] };
    expect(resolveAvatarAppearance(state, 'user-1', 'org-1')).toEqual(DEFAULT_APPEARANCE);
  });

  it('returns the stored appearance and sanitizes invalid colors', () => {
    expect(resolveAvatarAppearance({ avatarConfigs: [config()] }, 'user-1', 'org-1')).toEqual({
      character: 'tall', outfitColor: '#123abc', accessory: 'glasses',
    });
    expect(resolveAvatarAppearance({ avatarConfigs: [config({ outfitColor: 'javascript:alert(1)' })] }, 'user-1', 'org-1').outfitColor)
      .toBe(DEFAULT_APPEARANCE.outfitColor);
  });

  it('propagates appearance through presence payloads and live updates', () => {
    const sent: string[] = [];
    const socket = { readyState: 1, OPEN: 1, send: (value: string) => sent.push(value) } as unknown as WorldParticipant['socket'];
    worldRegistry.add({
      socket, userId: 'user-1', organizationId: 'org-1', name: 'Sara', role: 'student',
      workspaceId: 'ws-1', roomId: 'room-1', x: 10, y: 20, color: '#123abc',
      appearance: { character: 'tall', outfitColor: '#123abc', accessory: 'glasses' },
      connectedAt: 1, lastSeen: 1,
    });
    const snapshot = worldRegistry.snapshot('ws-1', 'room-1');
    expect(snapshot.participants[0]?.appearance).toEqual({
      character: 'tall', outfitColor: '#123abc', accessory: 'glasses',
    });
    broadcastAvatarAppearance('org-1', 'user-1', {
      character: 'round', outfitColor: '#abcdef', accessory: null,
    });
    const update = JSON.parse(sent[0]!) as { type: string; userId: string; appearance: { outfitColor: string } };
    expect(update.type).toBe('avatar_updated');
    expect(update.userId).toBe('user-1');
    expect(update.appearance.outfitColor).toBe('#abcdef');

    // A same-id user in another tenant must not receive another org's update.
    sent.length = 0;
    broadcastAvatarAppearance('org-2', 'user-1', DEFAULT_APPEARANCE);
    expect(sent).toHaveLength(0);
    worldRegistry.remove('user-1');
  });
});
