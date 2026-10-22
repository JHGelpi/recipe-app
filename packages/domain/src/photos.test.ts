import { describe, expect, it } from 'vitest';
import {
  DISH_EDGE,
  fitWithin,
  importPutSchema,
  isRetryable,
  PAGE_EDGE,
  PHOTO_CLIENT_FIELDS,
  photoPatchSchema,
  photoPutSchema,
  recipeSchema,
  RECIPE_CLIENT_FIELDS,
} from './index';

const H = '00000000-0000-0000-0000-00000000000a';
const ID = '11111111-1111-4111-8111-111111111111';
const IMPORT = '22222222-2222-4222-8222-222222222222';
const RECIPE = '33333333-3333-4333-8333-333333333333';
const page = {
  id: ID,
  household_id: H,
  kind: 'page',
  import_id: IMPORT,
  position: 1,
  media_type: 'image/jpeg',
  bytes: 400_000,
  width: 1568,
  height: 1176,
};

describe('fitWithin', () => {
  it('scales a full-size phone photo to the long edge, keeping the shape', () => {
    expect(fitWithin(4032, 3024, PAGE_EDGE)).toEqual({ width: 1568, height: 1176 });
    expect(fitWithin(3024, 4032, DISH_EDGE)).toEqual({ width: 900, height: 1200 });
  });

  it('never enlarges, and never rounds a side to zero', () => {
    expect(fitWithin(800, 600, PAGE_EDGE)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(10_000, 1, 1000)).toEqual({ width: 1000, height: 1 });
  });
});

describe('photoPutSchema', () => {
  it('accepts a page of an import and a dish photo of a recipe', () => {
    expect(photoPutSchema.safeParse(page).success).toBe(true);
    const dish = { ...page, kind: 'dish', recipe_id: RECIPE };
    delete (dish as Partial<typeof dish>).import_id;
    delete (dish as Partial<typeof dish>).position;
    expect(photoPutSchema.safeParse(dish).success).toBe(true);
  });

  it('refuses a page without an import or position, and a dish photo with them', () => {
    expect(photoPutSchema.safeParse({ ...page, import_id: undefined }).success).toBe(false);
    expect(photoPutSchema.safeParse({ ...page, position: 9 }).success).toBe(false);
    expect(photoPutSchema.safeParse({ ...page, kind: 'dish' }).success).toBe(false);
  });

  it('refuses another type, too many bytes or pixels, and server-owned fields', () => {
    expect(photoPutSchema.safeParse({ ...page, media_type: 'image/png' }).success).toBe(false);
    expect(photoPutSchema.safeParse({ ...page, bytes: 3_000_001 }).success).toBe(false);
    expect(photoPutSchema.safeParse({ ...page, width: 4001 }).success).toBe(false);
    expect(photoPutSchema.safeParse({ ...page, uploaded_at: '2026-10-17T00:00:00Z' }).success).toBe(
      false,
    );
  });
});

describe('photoPatchSchema', () => {
  it('moves a photo to a recipe or dismisses it, and nothing else', () => {
    expect(photoPatchSchema.safeParse({ id: ID, recipe_id: RECIPE }).success).toBe(true);
    expect(photoPatchSchema.safeParse({ id: ID, deleted_at: '2026-10-17T00:00:00Z' }).success).toBe(
      true,
    );
    expect(photoPatchSchema.safeParse({ id: ID }).success).toBe(false);
    expect(photoPatchSchema.safeParse({ id: ID, position: 2 }).success).toBe(false);
    expect(photoPatchSchema.safeParse({ id: ID, uploaded_at: null }).success).toBe(false);
  });

  it('lists exactly the fields the phone may upload', () => {
    expect([...PHOTO_CLIENT_FIELDS].sort()).toEqual(
      [
        'bytes',
        'cook_log_id',
        'deleted_at',
        'height',
        'household_id',
        'import_id',
        'kind',
        'media_type',
        'position',
        'recipe_id',
        'width',
      ].sort(),
    );
  });
});

describe('photo imports and recipe photos', () => {
  it('accepts a photo import with no text or link', () => {
    expect(
      importPutSchema.safeParse({ id: ID, household_id: H, source_type: 'photo' }).success,
    ).toBe(true);
    expect(
      importPutSchema.safeParse({ id: ID, household_id: H, source_type: 'photo', source_text: 'x' })
        .success,
    ).toBe(false);
  });

  it('treats unreadable photos as worth another try', () => {
    expect(isRetryable('photo_unreadable')).toBe(true);
  });

  it('gives a recipe an optional dish photo the phone may upload', () => {
    expect(
      recipeSchema.safeParse({ id: RECIPE, household_id: H, title: 'Soup', photo_id: ID }).success,
    ).toBe(true);
    expect(
      recipeSchema.safeParse({ id: RECIPE, household_id: H, title: 'Soup', photo_id: 'nope' })
        .success,
    ).toBe(false);
    expect(RECIPE_CLIENT_FIELDS).toContain('photo_id');
  });
});
