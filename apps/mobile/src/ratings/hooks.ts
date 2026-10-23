import { useQuery } from '@powersync/react';
import { ratingSummary, type RatingSummary } from '@recipe-app/domain';
import { useMemo } from 'react';
import { MY_RATING_SQL, RATING_TOTALS_SQL } from './repository';

/** FR-44: your own rating (null when none) and the household's average. */
export function useRating(
  recipeId: string,
  userId: string,
): { mine: number | null; summary: RatingSummary } {
  const { data: mine } = useQuery<{ stars: number }>(MY_RATING_SQL, [recipeId, userId]);
  const { data: totals } = useQuery<{ stars_total: number; ratings_count: number }>(
    RATING_TOTALS_SQL,
    [recipeId],
  );
  const total = totals[0];
  const summary = useMemo(() => ratingSummary(total), [total]);
  return { mine: mine[0]?.stars ?? null, summary };
}
