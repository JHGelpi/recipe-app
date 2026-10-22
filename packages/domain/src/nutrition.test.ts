import { describe, expect, it } from 'vitest';
import {
  cleanNutrition,
  formatNutrition,
  nutritionFromJsonLd,
  nutritionSchema,
  parseNutritionInput,
} from './nutrition';

describe('nutritionSchema (FR-43)', () => {
  it('takes any subset of non-negative values within limits', () => {
    expect(nutritionSchema.safeParse({ calories: 420 }).success).toBe(true);
    expect(
      nutritionSchema.safeParse({ calories: 420, protein_g: 30.5, carbs_g: 0, fat_g: null })
        .success,
    ).toBe(true);
  });

  it('refuses negatives, huge values, unknown keys, and an empty object', () => {
    for (const bad of [
      { calories: -1 },
      { calories: 10001 },
      { protein_g: 1001 },
      { fiber_g: 3 },
      {},
      { calories: null },
      { calories: Number.NaN },
    ]) {
      expect(nutritionSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('cleanNutrition', () => {
  it('keeps sensible numbers, rounds to one decimal, drops the rest, and is null when empty', () => {
    expect(
      cleanNutrition({ calories: '420', protein_g: 30.04, carbs_g: -2, fat_g: 'lots' }),
    ).toEqual({ calories: 420, protein_g: 30 });
    expect(cleanNutrition({ calories: null, protein_g: undefined })).toBeNull();
    expect(cleanNutrition('420 kcal')).toBeNull();
    expect(cleanNutrition(null)).toBeNull();
    expect(cleanNutrition({ calories: 99999 })).toBeNull();
  });
});

describe('parseNutritionInput (the editor)', () => {
  it('reads blank fields as none, and says which field is wrong', () => {
    expect(parseNutritionInput({ calories: '', protein_g: ' ', carbs_g: '', fat_g: '' })).toEqual({
      ok: true,
      value: null,
    });
    expect(
      parseNutritionInput({ calories: '420', protein_g: '30.5', carbs_g: '', fat_g: '12' }),
    ).toEqual({ ok: true, value: { calories: 420, protein_g: 30.5, fat_g: 12 } });
    expect(parseNutritionInput({ calories: 'abc', protein_g: '', carbs_g: '', fat_g: '' })).toEqual(
      { ok: false, field: 'calories', message: 'Calories must be a number from 0 to 10000' },
    );
    expect(
      parseNutritionInput({ calories: '', protein_g: '-1', carbs_g: '', fat_g: '' }),
    ).toMatchObject({ ok: false, field: 'protein_g' });
  });
});

describe('nutritionFromJsonLd', () => {
  it('maps schema.org NutritionInformation, units and all', () => {
    expect(
      nutritionFromJsonLd({
        '@type': 'NutritionInformation',
        calories: '240 calories',
        proteinContent: '12 g',
        carbohydrateContent: '30.5g',
        fatContent: '8 grams',
        fiberContent: '4 g',
      }),
    ).toEqual({ calories: 240, protein_g: 12, carbs_g: 30.5, fat_g: 8 });
  });

  it('converts kilojoules and milligrams, takes numbers, and ignores what it cannot read', () => {
    expect(nutritionFromJsonLd({ calories: '1046 kJ', proteinContent: '500 mg' })).toEqual({
      calories: 250,
      protein_g: 0.5,
    });
    expect(nutritionFromJsonLd({ calories: 310 })).toEqual({ calories: 310 });
    expect(nutritionFromJsonLd([{ calories: '100 kcal' }])).toEqual({ calories: 100 });
    expect(nutritionFromJsonLd({ calories: 'some' })).toBeNull();
    expect(nutritionFromJsonLd(undefined)).toBeNull();
  });
});

describe('formatNutrition', () => {
  it('lists what is known, per serving', () => {
    expect(formatNutrition({ calories: 420, protein_g: 30, carbs_g: 45.5, fat_g: 12 })).toEqual([
      '420 kcal',
      '30 g protein',
      '45.5 g carbs',
      '12 g fat',
    ]);
    expect(formatNutrition({ fat_g: 3 })).toEqual(['3 g fat']);
    expect(formatNutrition(null)).toEqual([]);
  });
});
