import { describe, expect, it } from 'vitest';
import {
  nextRating,
  rateLabel,
  ratingSummary,
  ratingRowText,
  ratingSpoken,
  ratingText,
  recipeRatingPatchSchema,
  recipeRatingSchema,
  summarizeRatings,
} from './ratings';

const id = '0b9a3f5e-2c4d-4e6f-8a1b-3c5d7e9f1a2b';
const rating = {
  id,
  household_id: '22222222-2222-4222-8222-222222222222',
  user_id: '00000000-0000-0000-0000-0000000000a1',
  recipe_id: '6f1c2f0e-8f0a-4a3b-9d5e-2b7c1a9e4d13',
  stars: 4,
};

describe('recipeRatingSchema (FR-44)', () => {
  it('accepts whole stars from 1 to 5 only', () => {
    expect(recipeRatingSchema.safeParse(rating).success).toBe(true);
    expect(recipeRatingSchema.safeParse({ ...rating, stars: 1 }).success).toBe(true);
    expect(recipeRatingSchema.safeParse({ ...rating, stars: 5 }).success).toBe(true);
    for (const stars of [0, 6, 3.5, '4', null]) {
      expect(recipeRatingSchema.safeParse({ ...rating, stars }).success).toBe(false);
    }
  });

  it('patches stars or deleted_at, never the recipe or the person', () => {
    expect(recipeRatingPatchSchema.safeParse({ id, stars: 2 }).success).toBe(true);
    expect(
      recipeRatingPatchSchema.safeParse({ id, deleted_at: '2026-11-01T10:00:00.000Z' }).success,
    ).toBe(true);
    expect(recipeRatingPatchSchema.safeParse({ id, recipe_id: rating.recipe_id }).success).toBe(
      false,
    );
    expect(recipeRatingPatchSchema.safeParse({ id, user_id: rating.user_id }).success).toBe(false);
  });
});

describe('the household average (FR-44)', () => {
  it('with no ratings, there is no average', () => {
    expect(summarizeRatings([])).toEqual({ average: null, count: 0 });
    expect(ratingSummary(null)).toEqual({ average: null, count: 0 });
    expect(ratingText(ratingSummary(undefined))).toBe('Not rated yet.');
  });

  it('one rating is the average', () => {
    const summary = summarizeRatings([{ stars: 5 }]);
    expect(summary).toEqual({ average: 5, count: 1 });
    expect(ratingText(summary)).toBe('5.0 · 1 rating');
  });

  it('cleared ratings do not count', () => {
    const cleared = '2026-11-01T10:00:00.000Z';
    expect(summarizeRatings([{ stars: 2, deleted_at: cleared }])).toEqual({
      average: null,
      count: 0,
    });
    expect(summarizeRatings([{ stars: 2, deleted_at: cleared }, { stars: 4 }])).toEqual({
      average: 4,
      count: 1,
    });
    // A totals row whose ratings were all cleared.
    expect(ratingSummary({ stars_total: 0, ratings_count: 0 })).toEqual({
      average: null,
      count: 0,
    });
  });

  it('mixed ratings average to one decimal', () => {
    const summary = summarizeRatings([5, 4, 4, 5, 4, 4].map((stars) => ({ stars })));
    expect(summary).toEqual({ average: 4.3, count: 6 });
    expect(ratingText(summary)).toBe('4.3 · 6 ratings');
    expect(ratingSpoken(summary)).toBe('Average 4.3 from 6 ratings');
    expect(ratingSpoken(summarizeRatings([]))).toBe('Not rated yet');
    expect(ratingSummary({ stars_total: 7, ratings_count: 3 })).toEqual({ average: 2.3, count: 3 });
    expect(ratingSummary({ stars_total: 9, ratings_count: 2 }).average).toBe(4.5);
  });

  it('the list row shows the average with its count, or Not rated', () => {
    expect(ratingRowText({ average: 4.3, count: 6 })).toBe('4.3 (6)');
    expect(ratingRowText({ average: 5, count: 1 })).toBe('5.0 (1)');
    expect(ratingRowText(ratingSummary({ stars_total: 0, ratings_count: 0 }))).toBe('Not rated');
  });
});

describe('rating controls (FR-44)', () => {
  it('tapping your current rating clears it; another star sets it', () => {
    expect(nextRating(null, 3)).toBe(3);
    expect(nextRating(3, 5)).toBe(5);
    expect(nextRating(3, 3)).toBeNull();
  });

  it('names each star', () => {
    expect(rateLabel(1)).toBe('Rate 1 star');
    expect(rateLabel(3)).toBe('Rate 3 stars');
  });
});
