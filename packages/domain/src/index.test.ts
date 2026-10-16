import { describe, expect, it } from 'vitest';
import { recipePatchSchema, recipeSchema, recipeTitleSchema, TITLE_MAX } from './index';

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
