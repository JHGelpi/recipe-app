import { useQuery } from '@powersync/react';
import { LIST_RECIPES_SQL, type RecipeListItem } from './repository';

/** Live list of the household's recipes from the local database. */
export function useRecipes() {
  return useQuery<RecipeListItem>(LIST_RECIPES_SQL);
}
