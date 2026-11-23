import type { AvatarConfig } from '../../domain/types.js';

/** The subset of avatar configuration that the world renderer consumes. */
export interface AvatarAppearance {
  character: string;
  outfitColor: string;
  accessory: string | null;
}

interface AvatarState {
  avatarConfigs: AvatarConfig[];
}

export const DEFAULT_APPEARANCE: AvatarAppearance = {
  character: 'standard',
  outfitColor: '#0e7c7b',
  accessory: null,
};

/**
 * Resolves a tenant-scoped avatar appearance. Invalid persisted values fall
 * back to the default instead of reaching the renderer unchecked.
 */
export function resolveAvatarAppearance(
  state: AvatarState,
  userId: string,
  organizationId: string,
): AvatarAppearance {
  const stored = state.avatarConfigs.find(
    (item) => item.userId === userId && item.organizationId === organizationId,
  );
  if (!stored) return { ...DEFAULT_APPEARANCE };
  return {
    character: typeof stored.character === 'string' && stored.character.length > 0
      ? stored.character.slice(0, 40)
      : DEFAULT_APPEARANCE.character,
    outfitColor: /^#[0-9a-fA-F]{6}$/.test(stored.outfitColor)
      ? stored.outfitColor
      : DEFAULT_APPEARANCE.outfitColor,
    accessory: stored.accessory === null || typeof stored.accessory === 'string'
      ? (stored.accessory?.slice(0, 120) ?? null)
      : null,
  };
}
