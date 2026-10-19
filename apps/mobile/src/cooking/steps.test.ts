// apps/mobile/src/cooking/steps.test.ts
import { describe, expect, it } from 'vitest';
import { shownStep, stepsNote } from './steps';

describe('cook mode steps', () => {
  it('names the original servings', () => {
    expect(stepsNote(4)).toBe('Amounts in steps are for the original 4 servings');
    expect(stepsNote(null)).toBe('Amounts in steps are for the original recipe');
  });
  it('never shows a step past the last one', () => {
    expect(shownStep(5, 3)).toBe(2);
    expect(shownStep(1, 3)).toBe(1);
    expect(shownStep(4, 0)).toBe(0);
  });
});
