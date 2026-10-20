import { describe, expect, it } from 'vitest';
import { palettes } from './palettes';
import { shadow } from './spacing';

describe('shadow (final review 1)', () => {
  // react-native-web drops shadowOpacity when the color is a var(), so the color carries it.
  it('keeps its softness in the color, not in shadowOpacity', () => {
    expect(shadow.shadowOpacity).toBe(1);
    expect(palettes.dark.shadow).toBe('rgba(0, 0, 0, 0.35)');
    expect(palettes.light.shadow).toMatch(/^rgba\(.+, 0\.\d+\)$/);
  });
});
