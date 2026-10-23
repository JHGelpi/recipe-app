import { useQuery } from '@powersync/react';
import { buildSearchIndex, searchRecipes } from '@recipe-app/domain';
import { useMemo, useRef } from 'react';
import { RATING_TOTALS_LIST_SQL } from '../ratings/repository';
import {
  ratingsByRecipe,
  tagsForTab,
  toListItems,
  type ListItem,
  type RatingTotalsRow,
} from './listItems';
import {
  LIST_RECIPES_SQL,
  RECIPE_PAGES_SQL,
  RECIPE_SQL,
  STARRED_IDS_SQL,
  STARRED_SQL,
  TAGS_SQL,
  TRASH_SQL,
} from './repository';
import { listRowsFrom } from './listRows';
import {
  listRowFrom,
  parseTimestamp,
  rowToRecipe,
  TRASH_DAYS,
  type ListRow,
  type RecipeRecord,
} from './rows';

export type TrashItem = { id: string; title: string; deleted_at: string };

function tagsOf(value: unknown): string[] {
  return listRowFrom({ id: '', title: '', tags: value }).tags;
}

export type { ListItem } from './listItems';

/**
 * The current tab's recipes matching the search, best first, live from the
 * local database. The index is rebuilt only when recipes change: favorites
 * and rating totals are separate queries, so a tap on either recomputes only
 * the visible items (NFR-6).
 */
export function useRecipeSearch(
  userId: string,
  favoritesOnly: boolean,
  query: string,
  selectedTags: string[],
): { items: ListItem[]; tags: string[] } {
  const { data: recipeRows } = useQuery<Record<string, unknown>>(LIST_RECIPES_SQL);
  const { data: starredRows } = useQuery<{ recipe_id: string }>(STARRED_IDS_SQL, [userId]);
  const { data: totalsRows } = useQuery<RatingTotalsRow>(RATING_TOTALS_LIST_SQL);
  // Rows whose columns did not change are reused, not parsed again (NFR-6).
  const cache = useRef(new Map<string, { stamp: string; row: ListRow }>());
  const rows = useMemo(() => listRowsFrom(recipeRows, cache.current), [recipeRows]);
  const index = useMemo(() => buildSearchIndex([...rows.values()]), [rows]);
  const starred = useMemo(() => new Set(starredRows.map((row) => row.recipe_id)), [starredRows]);
  const ratings = useMemo(() => ratingsByRecipe(totalsRows), [totalsRows]);
  const ids = useMemo(
    () => searchRecipes(index, query, selectedTags),
    [index, query, selectedTags],
  );
  const items = useMemo(
    () => toListItems(ids, rows, starred, favoritesOnly, ratings),
    [ids, rows, starred, favoritesOnly, ratings],
  );
  const tags = useMemo(
    () => tagsForTab(rows, starred, favoritesOnly),
    [rows, starred, favoritesOnly],
  );
  return { items, tags };
}

/** undefined while loading; null when missing or unreadable. */
export function useRecipe(
  id: string,
  userId: string,
): { recipe: RecipeRecord | null | undefined; starred: boolean } {
  const { data, isLoading } = useQuery<Record<string, unknown>>(RECIPE_SQL, [id]);
  const { data: stars } = useQuery<{ id: string }>(STARRED_SQL, [id, userId]);
  const row = data[0];
  const recipe = isLoading ? undefined : row ? rowToRecipe(row) : null;
  return { recipe, starred: stars.length > 0 };
}

/** Trash from the last 30 days, newest first. */
export function useTrash(): TrashItem[] {
  const { data } = useQuery<{ id: string; title: string; deleted_at: string }>(TRASH_SQL);
  return useMemo(() => {
    const cutoff = Date.now() - TRASH_DAYS * 24 * 60 * 60 * 1000;
    return data
      .map((row) => ({ row, at: parseTimestamp(row.deleted_at) ?? 0 }))
      .filter(({ at }) => at > cutoff)
      .sort((a, b) => b.at - a.at)
      .map(({ row }) => ({ id: row.id, title: row.title, deleted_at: row.deleted_at }));
  }, [data]);
}

/** Distinct tags on the household's recipes, alphabetically. */
export function useHouseholdTags(): string[] {
  const { data } = useQuery<{ tags: unknown }>(TAGS_SQL);
  return useMemo(() => [...new Set(data.flatMap((row) => tagsOf(row.tags)))].sort(), [data]);
}

/** FR-12: a photo-import recipe's original pages, in order. */
export function useRecipePages(recipeId: string): string[] {
  const { data } = useQuery<{ id: string }>(RECIPE_PAGES_SQL, [recipeId]);
  return useMemo(() => data.map((row) => row.id), [data]);
}
