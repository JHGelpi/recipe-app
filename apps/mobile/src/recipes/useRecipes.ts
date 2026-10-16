import { useQuery } from '@powersync/react';

export type RecipeListItem = { id: string; title: string };

// Temporary until Task 5 replaces the list screen with hooks.ts.
const SQL =
  'select id, title from recipes where deleted_at is null order by title collate nocase, id';

/** Live list of the household's recipes from the local database. */
export function useRecipes() {
  return useQuery<RecipeListItem>(SQL);
}
