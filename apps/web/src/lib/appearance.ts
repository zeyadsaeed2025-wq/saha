/** Client-side view of the tenant-scoped avatar configuration consumed by the world. */
export interface AvatarAppearanceView {
  character: string;
  outfitColor: string;
  accessory: string | null;
}

export const DEFAULT_APPEARANCE: AvatarAppearanceView = {
  character: 'standard',
  outfitColor: '#0e7c7b',
  accessory: null,
};

/** Normalizes untrusted world payloads before they reach the Pixi renderer. */
export function readAppearance(value: unknown): AvatarAppearanceView {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const color = String(raw.outfitColor ?? '');
  return {
    character: typeof raw.character === 'string' && raw.character ? raw.character.slice(0, 40) : DEFAULT_APPEARANCE.character,
    outfitColor: /^#[0-9a-fA-F]{6}$/.test(color) ? color : DEFAULT_APPEARANCE.outfitColor,
    accessory: raw.accessory === null || typeof raw.accessory === 'string'
      ? (raw.accessory as string | null)?.slice(0, 120) ?? null
      : null,
  };
}

export function appearanceKey(appearance: AvatarAppearanceView): string {
  return `${appearance.character}|${appearance.outfitColor}|${appearance.accessory ?? ''}`;
}
