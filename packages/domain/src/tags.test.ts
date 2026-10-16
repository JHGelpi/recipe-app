import { describe, expect, it } from 'vitest';
import { normalizeTags } from './tags';

describe('normalizeTags', () => {
  it('splits on commas, trims, lowercases, collapses spaces, and de-duplicates in order', () => {
    expect(normalizeTags(' Dinner, Quick  Meals,dinner,, ,Soup ')).toEqual([
      'dinner',
      'quick meals',
      'soup',
    ]);
  });

  it('returns an empty list for empty input', () => {
    expect(normalizeTags('')).toEqual([]);
  });
});
