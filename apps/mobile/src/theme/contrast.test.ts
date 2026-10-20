import { describe, expect, it } from 'vitest';
import { contrast } from './contrast';
import { NON_TEXT_PAIRS, palettes, TEXT_PAIRS, type Theme } from './palettes';

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

    // WCAG 1.4.11: checkbox borders, step dots and field edges must be seen.
    it.each(NON_TEXT_PAIRS)('the %s control on %s passes 3:1', (control, background) => {
      expect(
        contrast(palettes[theme][control], palettes[theme][background]),
      ).toBeGreaterThanOrEqual(3);
    });
  });
});
