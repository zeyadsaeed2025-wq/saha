import { describe, expect, it } from 'vitest';
import { appearanceKey, DEFAULT_APPEARANCE, readAppearance } from './appearance.js';

describe('world avatar appearance payloads', () => {
  it('falls back safely for missing or malformed values', () => {
    expect(readAppearance(undefined)).toEqual(DEFAULT_APPEARANCE);
    expect(readAppearance({ outfitColor: 'red; drop table', character: 7, accessory: {} })).toEqual(DEFAULT_APPEARANCE);
  });

  it('preserves valid tenant-configured values and detects changes', () => {
    const first = readAppearance({ character: 'tall', outfitColor: '#123abc', accessory: 'glasses' });
    expect(first).toEqual({ character: 'tall', outfitColor: '#123abc', accessory: 'glasses' });
    const second = readAppearance({ ...first, accessory: null });
    expect(appearanceKey(first)).not.toBe(appearanceKey(second));
    expect(appearanceKey(first)).toBe(appearanceKey(readAppearance(first)));
  });
});
