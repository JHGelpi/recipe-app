import { useCallback, useState } from 'react';
import type { RecipeRecord } from '../recipes/rows';
import { clearPlace, fitPlace, freshPlace, readPlace, writePlace, type CookPlace } from './place';

const store = () => globalThis.localStorage;

/**
 * The cook's place for a recipe, shared by the recipe screen and cook mode
 * through localStorage. Each change is saved at once, so a lock or reload
 * comes back to the same ticks, step, servings and units.
 */
export function useCookPlace(recipe: RecipeRecord): {
  place: CookPlace;
  update(change: Partial<CookPlace>): void;
  reset(): void;
} {
  const [place, setPlace] = useState<CookPlace>(() => {
    const saved = store() ? readPlace(store(), recipe.id, Date.now()) : null;
    return fitPlace(saved ?? freshPlace(recipe.servings, Date.now()), recipe);
  });
  const update = useCallback(
    (change: Partial<CookPlace>) => {
      setPlace((current) => {
        const next = { ...current, ...change, at: Date.now() };
        if (store()) writePlace(store(), recipe.id, next);
        return next;
      });
    },
    [recipe.id],
  );
  const reset = useCallback(() => {
    if (store()) clearPlace(store(), recipe.id);
    setPlace(freshPlace(recipe.servings, Date.now()));
  }, [recipe.id, recipe.servings]);
  return { place, update, reset };
}
