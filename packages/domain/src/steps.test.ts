import { describe, expect, it } from 'vitest';
import { stepsFromText, stepsToText } from './steps';

let counter = 0;
const newId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

describe('stepsFromText', () => {
  it('makes one step per non-empty line', () => {
    expect(stepsFromText('Mix.\n\nBake.', [], newId).map((step) => step.text)).toEqual([
      'Mix.',
      'Bake.',
    ]);
  });

  it.each([
    ['1. Preheat the oven', 'Preheat the oven'],
    ['2) Mix', 'Mix'],
    ['Step 3: Bake', 'Bake'],
    ['step 4 - Cool', 'Cool'],
    ['350 degrees is hot', '350 degrees is hot'],
  ])('strips numbering from %j', (line, text) => {
    expect(stepsFromText(line, [], newId)[0]?.text).toBe(text);
  });

  it('keeps ids of unchanged steps', () => {
    const first = stepsFromText('Mix\nBake', [], newId);
    const second = stepsFromText('Mix\nBake longer', first, newId);
    expect(second[0]?.id).toBe(first[0]?.id);
    expect(second[1]?.id).not.toBe(first[1]?.id);
  });

  it('round-trips through stepsToText', () => {
    expect(stepsToText(stepsFromText('1. Mix\n2. Bake', [], newId))).toBe('Mix\nBake');
  });
});
