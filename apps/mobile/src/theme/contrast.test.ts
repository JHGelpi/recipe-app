import { describe, expect, it } from 'vitest';
import { contrast } from './contrast';
import { palettes, TEXT_PAIRS, type Theme } from './palettes';

describe('contrast (WCAG 2)', () => {
  it('is 21 for black on white and 1 for a color on itself', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 1);
    expect(contrast('#FFFFFF', '#000000')).toBeCloseTo(21, 1);
    expect(contrast('#1A1F2C', '#1A1F2C')).toBeCloseTo(1, 5);
  });

  describe.each(['dark', 'light'] as Theme[])('the %s palette (NFR-11)', (theme) => {
    it.each(TEXT_PAIRS)('%s text on %s passes AA (4.5:1)', (text, background) => {
      expect(contrast(palettes[theme][text], palettes[theme][background])).toBeGreaterThanOrEqual(
        4.5,
      );
    });
  });
});
