import { describe, expect, it } from 'vitest';
import { RECIPE_SORTS, sortRecipes, type RecipeSort, type SortableRecipe } from './recipeSort';

const DAY = 24 * 60 * 60 * 1000;

function recipe(
  id: string,
  title: string,
  extra: Partial<Omit<SortableRecipe, 'id' | 'title'>> = {},
): SortableRecipe {
  return {
    id,
    title,
    rating: { average: null, count: 0 },
    totalMinutes: null,
    addedAt: null,
    ...extra,
  };
}

const ids = (list: SortableRecipe[], order: RecipeSort) =>
  sortRecipes(list, order).map((r) => r.id);

describe('sortRecipes titles (FR-49)', () => {
  const list = [
    recipe('c', 'crêpes'),
    recipe('a', 'Apple pie'),
    recipe('b', 'banana bread'),
    recipe('e', 'Éclairs'),
  ];

  it('A–Z ignores case and accents', () => {
    expect(ids(list, 'az')).toEqual(['a', 'b', 'c', 'e']);
  });

  it('Z–A is the reverse', () => {
    expect(ids(list, 'za')).toEqual(['e', 'c', 'b', 'a']);
  });

  it('keeps recipes with the same title in a steady order', () => {
    const same = [recipe('y', 'Soup'), recipe('x', 'soup')];
    expect(ids(same, 'az')).toEqual(['x', 'y']);
    expect(ids(same, 'za')).toEqual(['x', 'y']);
  });

  it('does not change the list it is given', () => {
    const copy = [...list];
    sortRecipes(list, 'za');
    expect(list).toEqual(copy);
  });
});

describe('sortRecipes ratings', () => {
  const list = [
    recipe('unrated-b', 'Bread'),
    recipe('four-few', 'Dal', { rating: { average: 4, count: 1 } }),
    recipe('four-many', 'Curry', { rating: { average: 4, count: 6 } }),
    recipe('five', 'Tart', { rating: { average: 5, count: 2 } }),
    recipe('two', 'Gruel', { rating: { average: 2, count: 3 } }),
    recipe('unrated-a', 'Aioli'),
    recipe('four-many-a', 'Bao', { rating: { average: 4, count: 6 } }),
  ];

  it('Highest rated: average high first, then more ratings, then A–Z; unrated last', () => {
    expect(ids(list, 'highest')).toEqual([
      'five',
      'four-many-a',
      'four-many',
      'four-few',
      'two',
      'unrated-a',
      'unrated-b',
    ]);
  });

  it('Lowest rated: average low first, same tie-breaks, unrated still last', () => {
    expect(ids(list, 'lowest')).toEqual([
      'two',
      'four-many-a',
      'four-many',
      'four-few',
      'five',
      'unrated-a',
      'unrated-b',
    ]);
  });
});

describe('sortRecipes recently added', () => {
  it('newest first, ties A–Z; one not yet stamped by the server is newest', () => {
    const list = [
      recipe('old', 'Old', { addedAt: 1 * DAY }),
      recipe('new-b', 'B new', { addedAt: 3 * DAY }),
      recipe('new-a', 'A new', { addedAt: 3 * DAY }),
      recipe('mid', 'Mid', { addedAt: 2 * DAY }),
      recipe('local', 'Zed', { addedAt: null }),
    ];
    expect(ids(list, 'recent')).toEqual(['local', 'new-a', 'new-b', 'mid', 'old']);
  });
});

describe('sortRecipes quickest', () => {
  it('shortest total first, ties A–Z, no time last', () => {
    const list = [
      recipe('none-b', 'Broth'),
      recipe('slow', 'Stew', { totalMinutes: 180 }),
      recipe('prep-only', 'Salad', { totalMinutes: 10 }),
      recipe('ten-a', 'Avocado toast', { totalMinutes: 10 }),
      recipe('zero', 'Water', { totalMinutes: 0 }),
      recipe('none-a', 'Aioli'),
    ];
    expect(ids(list, 'quickest')).toEqual([
      'zero',
      'ten-a',
      'prep-only',
      'slow',
      'none-a',
      'none-b',
    ]);
  });
});

describe('speed (NFR-6: under 300 ms over 2,000 recipes)', () => {
  it('sorts 2,000 recipes every way well inside the budget', () => {
    const many = Array.from({ length: 2000 }, (_, n) =>
      recipe(`r${n}`, `Récipe ${(n * 7919) % 2000}`, {
        rating: n % 3 ? { average: (n % 50) / 10, count: n % 9 } : { average: null, count: 0 },
        totalMinutes: n % 4 ? n % 240 : null,
        addedAt: n % 5 ? n * 1000 : null,
      }),
    );
    for (const order of RECIPE_SORTS) {
      const started = performance.now();
      expect(sortRecipes(many, order)).toHaveLength(2000);
      expect(performance.now() - started).toBeLessThan(300);
    }
  });
});
