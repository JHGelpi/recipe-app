import { describe, expect, it } from 'vitest';
import {
  favoritePatchSchema,
  favoriteSchema,
  ingredientSchema,
  RECIPE_LIMITS,
  recipePatchSchema,
  recipeSchema,
  recipeTitleSchema,
  stepSchema,
  tagSchema,
  TITLE_MAX,
} from './index';

const id = '6f1c2f0e-8f0a-4a3b-9d5e-2b7c1a9e4d10';
const household_id = '00000000-0000-0000-0000-00000000000a';

describe('recipeTitleSchema', () => {
  it('trims surrounding whitespace', () => {
    expect(recipeTitleSchema.parse('  Pancakes  ')).toBe('Pancakes');
  });

  it('rejects an empty title', () => {
    expect(recipeTitleSchema.safeParse('').success).toBe(false);
  });

  it('rejects a whitespace-only title', () => {
    expect(recipeTitleSchema.safeParse('   ').success).toBe(false);
  });

  it('accepts a title of exactly the maximum length', () => {
    expect(recipeTitleSchema.safeParse('a'.repeat(TITLE_MAX)).success).toBe(true);
  });

  it('rejects a title one character over the maximum', () => {
    expect(recipeTitleSchema.safeParse('a'.repeat(TITLE_MAX + 1)).success).toBe(false);
  });
});

describe('recipeSchema', () => {
  it('accepts a valid recipe', () => {
    expect(recipeSchema.parse({ id, household_id, title: 'Pancakes' })).toEqual({
      id,
      household_id,
      title: 'Pancakes',
    });
  });

  it('accepts a seed-style id that is not a strict RFC UUID', () => {
    expect(recipeSchema.safeParse({ id: household_id, household_id, title: 'x' }).success).toBe(
      true,
    );
  });

  it('rejects unknown fields', () => {
    const result = recipeSchema.safeParse({ id, household_id, title: 'x', updated_by: id });
    expect(result.success).toBe(false);
  });

  it('rejects a household_id that is not a UUID', () => {
    expect(recipeSchema.safeParse({ id, household_id: 'nope', title: 'x' }).success).toBe(false);
  });

  it('accepts deleted_at as null or an ISO timestamp with offset', () => {
    expect(recipeSchema.safeParse({ id, household_id, title: 'x', deleted_at: null }).success).toBe(
      true,
    );
    expect(
      recipeSchema.safeParse({
        id,
        household_id,
        title: 'x',
        deleted_at: '2026-10-12T09:30:00.000Z',
      }).success,
    ).toBe(true);
  });

  it('rejects deleted_at that is not a timestamp', () => {
    expect(
      recipeSchema.safeParse({ id, household_id, title: 'x', deleted_at: 'yesterday' }).success,
    ).toBe(false);
  });
});

describe('recipePatchSchema', () => {
  it('accepts an id plus one field', () => {
    expect(recipePatchSchema.parse({ id, title: ' New ' })).toEqual({ id, title: 'New' });
  });

  it('rejects a patch with only an id', () => {
    expect(recipePatchSchema.safeParse({ id }).success).toBe(false);
  });

  it('rejects a patch without an id', () => {
    expect(recipePatchSchema.safeParse({ title: 'x' }).success).toBe(false);
  });

  it('rejects unknown fields', () => {
    expect(recipePatchSchema.safeParse({ id, updated_at: '2026-10-12T09:30:00Z' }).success).toBe(
      false,
    );
  });
});

const ingredient = {
  id: '6f1c2f0e-8f0a-4a3b-9d5e-2b7c1a9e4d11',
  raw: '2 cups flour',
  quantity: 2,
  quantity_max: null,
  unit: 'cup',
  item: 'flour',
  note: null,
  heading: false,
};
const step = { id: '6f1c2f0e-8f0a-4a3b-9d5e-2b7c1a9e4d12', text: 'Mix' };
const full = {
  id,
  household_id,
  title: 'Bread',
  servings: 4,
  prep_minutes: 15,
  cook_minutes: 40,
  ingredients: [ingredient],
  steps: [step],
  tags: ['bread'],
  notes: 'From Grandma',
};

describe('recipeSchema details', () => {
  it('accepts a full recipe', () => {
    expect(recipeSchema.safeParse(full).success).toBe(true);
  });

  it('still accepts a title-only recipe', () => {
    expect(recipeSchema.safeParse({ id, household_id, title: 'Soup' }).success).toBe(true);
  });

  it.each([
    ['servings', 0],
    ['servings', 1000],
    ['servings', 2.5],
    ['prep_minutes', -1],
    ['cook_minutes', 10001],
  ])('rejects %s = %s', (field, value) => {
    expect(recipeSchema.safeParse({ ...full, [field]: value }).success).toBe(false);
  });

  it.each([
    ['servings', 1],
    ['servings', 999],
    ['prep_minutes', 0],
    ['cook_minutes', 10000],
  ])('accepts %s = %s', (field, value) => {
    expect(recipeSchema.safeParse({ ...full, [field]: value }).success).toBe(true);
  });

  it('rejects more than the maximum number of ingredients, steps, and tags', () => {
    const many = <T>(item: T, count: number) => Array.from({ length: count }, () => item);
    expect(
      recipeSchema.safeParse({ ...full, ingredients: many(ingredient, RECIPE_LIMITS.ingredients) })
        .success,
    ).toBe(true);
    expect(
      recipeSchema.safeParse({
        ...full,
        ingredients: many(ingredient, RECIPE_LIMITS.ingredients + 1),
      }).success,
    ).toBe(false);
    expect(
      recipeSchema.safeParse({ ...full, steps: many(step, RECIPE_LIMITS.steps + 1) }).success,
    ).toBe(false);
    expect(
      recipeSchema.safeParse({ ...full, tags: many('x', RECIPE_LIMITS.tags + 1) }).success,
    ).toBe(false);
  });

  it('rejects notes over the limit', () => {
    expect(
      recipeSchema.safeParse({ ...full, notes: 'a'.repeat(RECIPE_LIMITS.notes + 1) }).success,
    ).toBe(false);
  });
});

describe('ingredientSchema', () => {
  it('rejects an unknown unit, a missing field, and an extra field', () => {
    expect(ingredientSchema.safeParse({ ...ingredient, unit: 'bucket' }).success).toBe(false);
    const missing = Object.fromEntries(
      Object.entries(ingredient).filter(([key]) => key !== 'heading'),
    );
    expect(ingredientSchema.safeParse(missing).success).toBe(false);
    expect(ingredientSchema.safeParse({ ...ingredient, extra: 1 }).success).toBe(false);
  });

  it('rejects an empty raw line and one over 500 characters', () => {
    expect(ingredientSchema.safeParse({ ...ingredient, raw: '' }).success).toBe(false);
    expect(ingredientSchema.safeParse({ ...ingredient, raw: 'a'.repeat(501) }).success).toBe(false);
  });
});

describe('stepSchema and tagSchema', () => {
  it('rejects an empty step and one over 2000 characters', () => {
    expect(stepSchema.safeParse({ ...step, text: '' }).success).toBe(false);
    expect(stepSchema.safeParse({ ...step, text: 'a'.repeat(2001) }).success).toBe(false);
  });

  it('accepts a tag of 40 characters and rejects 41 or an uppercase tag', () => {
    expect(tagSchema.safeParse('a'.repeat(40)).success).toBe(true);
    expect(tagSchema.safeParse('a'.repeat(41)).success).toBe(false);
    expect(tagSchema.safeParse('Dinner').success).toBe(false);
  });
});

describe('favoriteSchema', () => {
  const favorite = {
    id,
    household_id,
    user_id: '00000000-0000-0000-0000-0000000000a1',
    recipe_id: '6f1c2f0e-8f0a-4a3b-9d5e-2b7c1a9e4d13',
  };

  it('accepts a favorite and a patch that only sets deleted_at', () => {
    expect(favoriteSchema.safeParse(favorite).success).toBe(true);
    expect(
      favoritePatchSchema.safeParse({ id, deleted_at: '2026-10-17T10:00:00.000Z' }).success,
    ).toBe(true);
  });

  it('rejects a patch that moves the favorite to another recipe', () => {
    expect(favoritePatchSchema.safeParse({ id, recipe_id: favorite.recipe_id }).success).toBe(
      false,
    );
  });
});

describe('recipe source (FR-12, NFR-13)', () => {
  const base = {
    id: '11111111-1111-4111-8111-111111111111',
    household_id: '22222222-2222-4222-8222-222222222222',
    title: 'Soup',
  };

  it('accepts a source link, author and original text', () => {
    const parsed = recipeSchema.safeParse({
      ...base,
      source_url: 'https://example.com/soup',
      source_author: 'Jane Doe',
      source_text: 'Soup\n- 1 onion',
    });
    expect(parsed.success).toBe(true);
  });

  it('refuses a source link that is not http(s), and text over 20,000 characters', () => {
    expect(recipeSchema.safeParse({ ...base, source_url: 'javascript:alert(1)' }).success).toBe(
      false,
    );
    expect(recipeSchema.safeParse({ ...base, source_text: 'x'.repeat(20_001) }).success).toBe(
      false,
    );
  });
});
