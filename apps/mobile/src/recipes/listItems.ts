import {
  RECIPE_SORT_LABELS,
  ratingSummary,
  sortRecipes,
  type RatingSummary,
  type RecipeSort,
} from '@recipe-app/domain';
import type { ListRow } from './rows';

export type ListItem = {
  id: string;
  title: string;
  tags: string[];
  starred: boolean;
  photoId: string | null;
  totalMinutes: number | null;
  /** FR-49: for Recently added. */
  addedAt: number | null;
  /** FR-44: the household average, from recipe_rating_totals. */
  rating: RatingSummary;
};

export type RatingTotalsRow = { id: string; stars_total: number; ratings_count: number };

/** Each rated recipe's summary by recipe id, the same way the recipe screen works it out. */
export function ratingsByRecipe(totals: readonly RatingTotalsRow[]): Map<string, RatingSummary> {
  return new Map(totals.map((row) => [row.id, ratingSummary(row)]));
}

const UNRATED = ratingSummary(null);

/**
 * Search results as list items. Stars come from the user's favorites set and
 * ratings from the household's totals, so a tap on either recomputes only
 * this, never the search index.
 */
export function toListItems(
  ids: string[],
  rows: Map<string, ListRow>,
  starred: Set<string>,
  favoritesOnly: boolean,
  ratings: Map<string, RatingSummary>,
): ListItem[] {
  return ids.flatMap((id) => {
    const row = rows.get(id);
    if (!row || (favoritesOnly && !starred.has(id))) return [];
    return [
      {
        id,
        title: row.title,
        tags: row.tags,
        starred: starred.has(id),
        photoId: row.photoId,
        totalMinutes: row.totalMinutes,
        addedAt: row.addedAt,
        rating: ratings.get(id) ?? UNRATED,
      },
    ];
  });
}

/** How many recipes the tab holds before any search or filter. */
export function countForTab(
  rows: Map<string, ListRow>,
  starred: Set<string>,
  favoritesOnly: boolean,
): number {
  if (!favoritesOnly) return rows.size;
  let count = 0;
  for (const id of rows.keys()) if (starred.has(id)) count += 1;
  return count;
}

/** The distinct tags of the current tab's recipes, alphabetically. */
export function tagsForTab(
  rows: Map<string, ListRow>,
  starred: Set<string>,
  favoritesOnly: boolean,
): string[] {
  const tags = new Set<string>();
  for (const row of rows.values()) {
    if (favoritesOnly && !starred.has(row.id)) continue;
    for (const tag of row.tags) tags.add(tag);
  }
  return [...tags].sort();
}

/** FR-49: search text keeps best match first; otherwise the chosen sort applies. */
export function isSearching(query: string): boolean {
  return query.trim() !== '';
}

export function orderListItems(items: ListItem[], query: string, sort: RecipeSort): ListItem[] {
  return isSearching(query) ? items : sortRecipes(items, sort);
}

/** "Sort: Highest rated", or "Sort: Best match" while there's search text. */
export function sortLabel(query: string, sort: RecipeSort): string {
  return `Sort: ${isSearching(query) ? 'Best match' : RECIPE_SORT_LABELS[sort]}`;
}
