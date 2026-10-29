import { normalizeSearchText } from './search';

/** FR-49: the recipe list's orders; A–Z is the default. */
export const RECIPE_SORTS = ['az', 'za', 'highest', 'lowest', 'recent', 'quickest'] as const;
export type RecipeSort = (typeof RECIPE_SORTS)[number];
export const DEFAULT_RECIPE_SORT: RecipeSort = 'az';

export const RECIPE_SORT_LABELS: Record<RecipeSort, string> = {
  az: 'A–Z',
  za: 'Z–A',
  highest: 'Highest rated',
  lowest: 'Lowest rated',
  recent: 'Recently added',
  quickest: 'Quickest',
};

/** What sorting needs from a list item. */
export type SortableRecipe = {
  id: string;
  title: string;
  /** The household average as shown (one decimal), or null when unrated. */
  rating: { average: number | null; count: number };
  /** Prep plus cook, or null when neither is known. */
  totalMinutes: number | null;
  /** When it was added to the household (ms); null before the server has stamped it. */
  addedAt: number | null;
};

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

type Keyed<T> = { item: T; title: string };

/** Missing values last, whichever way the rest run. */
function lastIfNull(a: number | null, b: number | null): number | null {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return null;
}

function byKey<T extends SortableRecipe>(order: RecipeSort): (a: Keyed<T>, b: Keyed<T>) => number {
  switch (order) {
    case 'az':
      return () => 0;
    case 'za':
      return (a, b) => compare(b.title, a.title);
    case 'highest':
    case 'lowest': {
      const sign = order === 'highest' ? -1 : 1;
      return ({ item: a }, { item: b }) => {
        const missing = lastIfNull(a.rating.average, b.rating.average);
        if (missing !== null) return missing;
        return (
          sign * ((a.rating.average ?? 0) - (b.rating.average ?? 0)) ||
          b.rating.count - a.rating.count
        );
      };
    }
    case 'recent':
      // Not yet stamped means just added here: newest of all.
      return ({ item: a }, { item: b }) => {
        const [x, y] = [a.addedAt ?? Infinity, b.addedAt ?? Infinity];
        return x === y ? 0 : x > y ? -1 : 1;
      };
    case 'quickest':
      return ({ item: a }, { item: b }) => {
        const missing = lastIfNull(a.totalMinutes, b.totalMinutes);
        if (missing !== null) return missing;
        return (a.totalMinutes ?? 0) - (b.totalMinutes ?? 0);
      };
  }
}

/**
 * FR-49: the recipes in the chosen order. Titles compare ignoring case and
 * accents, as search does; every order ends A→Z, then by id, so the list never
 * jumps between renders.
 */
export function sortRecipes<T extends SortableRecipe>(
  recipes: readonly T[],
  order: RecipeSort,
): T[] {
  const first = byKey<T>(order);
  const keyed = recipes.map((item) => ({ item, title: normalizeSearchText(item.title) }));
  keyed.sort(
    (a, b) =>
      first(a, b) ||
      (order === 'za' ? 0 : compare(a.title, b.title)) ||
      compare(a.item.id, b.item.id),
  );
  return keyed.map(({ item }) => item);
}
