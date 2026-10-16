import { useQuery } from '@powersync/react';
import { useMemo } from 'react';
import {
  LIST_FAVORITES_SQL,
  LIST_RECIPES_SQL,
  RECIPE_SQL,
  STARRED_SQL,
  TAGS_SQL,
  TRASH_SQL,
} from './repository';
import { parseTimestamp, rowToRecipe, TRASH_DAYS, type RecipeRecord } from './rows';

export type ListItem = { id: string; title: string; tags: string[]; starred: boolean };
export type TrashItem = { id: string; title: string; deleted_at: string };

function tagsOf(value: unknown): string[] {
  return (
    rowToRecipe({
      id: '00000000-0000-0000-0000-000000000000',
      household_id: '00000000-0000-0000-0000-000000000000',
      title: 'x',
      tags: value,
    })?.tags ?? []
  );
}

/** The household's recipes, or the user's favorites, live from the local database. */
export function useRecipeList(userId: string, favoritesOnly: boolean): ListItem[] {
  const { data } = useQuery<{ id: string; title: string; tags: unknown; starred: unknown }>(
    favoritesOnly ? LIST_FAVORITES_SQL : LIST_RECIPES_SQL,
    [userId],
  );
  return useMemo(
    () =>
      data.map((row) => ({
        id: row.id,
        title: row.title,
        tags: tagsOf(row.tags),
        starred: Boolean(row.starred),
      })),
    [data],
  );
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
