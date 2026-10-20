import { describe, expect, it } from 'vitest';
import { contrast, palettes, type Theme } from '../theme';
import { buttonTokens, chipTokens } from './variants';

// A variant with no fill sits on whatever is behind it: any of these.
const UNDERLAYS = ['bg', 'surface', 'raised'] as const;

describe.each(['dark', 'light'] as Theme[])(
  'variant colors pass AA in %s (UI spec §2)',
  (theme) => {
    const colors = palettes[theme];

    it.each(Object.entries(buttonTokens))('button %s', (_, token) => {
      for (const under of token.background ? [token.background] : UNDERLAYS) {
        expect(contrast(colors[token.text], colors[under])).toBeGreaterThanOrEqual(4.5);
      }
    });

    it.each(Object.entries(chipTokens))('chip %s', (_, token) => {
      expect(contrast(colors[token.text], colors[token.background])).toBeGreaterThanOrEqual(4.5);
    });
  },
);

it('accent and tag fills carry onAccent text, which each palette picks to suit them', () => {
  for (const token of [...Object.values(buttonTokens), ...Object.values(chipTokens)]) {
    if (token.background === 'accent' || token.background === 'tag') {
      expect(token.text).toBe('onAccent');
    }
  }
});
