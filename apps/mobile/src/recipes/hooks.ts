import { useQuery } from '@powersync/react';
import { buildSearchIndex, searchRecipes } from '@recipe-app/domain';
import { useMemo } from 'react';
import {
  LIST_FAVORITES_SQL,
  LIST_RECIPES_SQL,
  RECIPE_SQL,
  STARRED_SQL,
  TAGS_SQL,
  TRASH_SQL,
} from './repository';
import { listRowFrom, parseTimestamp, rowToRecipe, TRASH_DAYS, type RecipeRecord } from './rows';

export type ListItem = { id: string; title: string; tags: string[]; starred: boolean };
export type TrashItem = { id: string; title: string; deleted_at: string };

function tagsOf(value: unknown): string[] {
  return listRowFrom({ id: '', title: '', tags: value }).tags;
}

/**
 * The current tab's recipes matching the search, best first, live from the
 * local database. The index is rebuilt only when the rows change, never per
 * keystroke.
 */
export function useRecipeSearch(
  userId: string,
  favoritesOnly: boolean,
  query: string,
  selectedTags: string[],
): { items: ListItem[]; total: number; tags: string[] } {
  const { data } = useQuery<Record<string, unknown>>(
    favoritesOnly ? LIST_FAVORITES_SQL : LIST_RECIPES_SQL,
    [userId],
  );
  const rows = useMemo(() => data.map(listRowFrom), [data]);
  const index = useMemo(() => buildSearchIndex(rows), [rows]);
  const byId = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows]);
  const tags = useMemo(() => [...new Set(rows.flatMap((row) => row.tags))].sort(), [rows]);
  const items = useMemo(
    () =>
      searchRecipes(index, query, selectedTags).flatMap((id) => {
        const row = byId.get(id);
        return row ? [{ id: row.id, title: row.title, tags: row.tags, starred: row.starred }] : [];
      }),
    [index, byId, query, selectedTags],
  );
  return { items, total: rows.length, tags };
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
