import { z } from 'zod';

const timestampSchema = z.iso.datetime({ offset: true });

/** FR-44: whole stars, one to five. */
export const MAX_STARS = 5;
const starsSchema = z.number().int().min(1).max(MAX_STARS);

export const recipeRatingSchema = z.strictObject({
  id: z.guid(),
  household_id: z.guid(),
  user_id: z.guid(),
  recipe_id: z.guid(),
  stars: starsSchema,
  deleted_at: timestampSchema.nullable().optional(),
});

/** A rating changes its stars or is cleared; it never moves to another recipe or person. */
export const recipeRatingPatchSchema = z.strictObject({
  id: z.guid(),
  stars: starsSchema.optional(),
  deleted_at: timestampSchema.nullable().optional(),
});

export const RECIPE_RATING_CLIENT_FIELDS = [
  'household_id',
  'user_id',
  'recipe_id',
  'stars',
  'deleted_at',
] as const;

export type RecipeRating = z.infer<typeof recipeRatingSchema>;

/** What the household sees: the average to one decimal, or null with no ratings. */
export type RatingSummary = { average: number | null; count: number };

/** A recipe's totals row (recipe_rating_totals), or none when it was never rated. */
export function ratingSummary(
  totals: { stars_total: number; ratings_count: number } | null | undefined,
): RatingSummary {
  const count = totals?.ratings_count ?? 0;
  if (!totals || count <= 0) return { average: null, count: 0 };
  return { average: Math.round((totals.stars_total / count) * 10) / 10, count };
}

/** The same summary from rating rows; cleared ones do not count. The database's recount does this. */
export function summarizeRatings(
  ratings: readonly { stars: number; deleted_at?: string | null }[],
): RatingSummary {
  const live = ratings.filter((rating) => !rating.deleted_at);
  return ratingSummary({
    stars_total: live.reduce((sum, rating) => sum + rating.stars, 0),
    ratings_count: live.length,
  });
}

/** "4.3 · 6 ratings", "5.0 · 1 rating", or "Not rated yet." */
export function ratingText(summary: RatingSummary): string {
  if (summary.average === null) return 'Not rated yet.';
  return `${summary.average.toFixed(1)} · ${summary.count} ${summary.count === 1 ? 'rating' : 'ratings'}`;
}

/** The same for screen readers: "Average 4.3 from 6 ratings", or "Not rated yet". */
export function ratingSpoken(summary: RatingSummary): string {
  if (summary.average === null) return 'Not rated yet';
  return `Average ${summary.average.toFixed(1)} from ${summary.count} ${summary.count === 1 ? 'rating' : 'ratings'}`;
}

/** Tapping your current rating clears it; any other star sets it. */
export function nextRating(current: number | null, tapped: number): number | null {
  return current === tapped ? null : tapped;
}

/** "Rate 1 star", "Rate 3 stars". */
export function rateLabel(stars: number): string {
  return `Rate ${stars} ${stars === 1 ? 'star' : 'stars'}`;
}
