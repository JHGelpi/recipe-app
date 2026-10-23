import { describe, expect, it } from 'vitest';
import { ratingsByRecipe, tagsForTab, toListItems } from './listItems';
import type { ListRow } from './rows';

const row = (id: string, tags: string[] = []): ListRow => ({
  id,
  title: id.toUpperCase(),
  tags,
  ingredients: [],
  starred: false,
  photoId: null,
  totalMinutes: id === 'a' ? 45 : null,
});
const rows = new Map([
  ['a', row('a', ['dinner'])],
  ['b', row('b', ['quick', 'dinner'])],
  ['c', row('c', ['snack'])],
]);

const unrated = { average: null, count: 0 };

describe('toListItems', () => {
  it('keeps the search order, marks stars from the favorites set, and skips unknown ids', () => {
    expect(toListItems(['c', 'x', 'a'], rows, new Set(['a']), false, new Map())).toEqual([
      {
        id: 'c',
        title: 'C',
        tags: ['snack'],
        starred: false,
        photoId: null,
        totalMinutes: null,
        rating: unrated,
      },
      {
        id: 'a',
        title: 'A',
        tags: ['dinner'],
        starred: true,
        photoId: null,
        totalMinutes: 45,
        rating: unrated,
      },
    ]);
  });

  it('keeps only starred recipes on the Favorites tab, in order', () => {
    expect(
      toListItems(['b', 'c', 'a'], rows, new Set(['a', 'b']), true, new Map()).map(
        (item) => item.id,
      ),
    ).toEqual(['b', 'a']);
  });

  it('gives each row its household average; unrated and all-cleared recipes have none (FR-44)', () => {
    const ratings = ratingsByRecipe([
      { id: 'a', stars_total: 26, ratings_count: 6 },
      // Every rating cleared: the totals row stays, at zero.
      { id: 'b', stars_total: 0, ratings_count: 0 },
    ]);
    const items = toListItems(['a', 'b', 'c'], rows, new Set(['a']), false, ratings);
    expect(items.map((item) => item.rating)).toEqual([
      { average: 4.3, count: 6 },
      unrated,
      unrated,
    ]);
    // The Favorites tab carries them the same way.
    expect(toListItems(['a'], rows, new Set(['a']), true, ratings)[0]?.rating).toEqual({
      average: 4.3,
      count: 6,
    });
  });
});

describe('tagsForTab', () => {
  it('lists the distinct tags of the tab’s recipes, alphabetically', () => {
    expect(tagsForTab(rows, new Set(['b']), false)).toEqual(['dinner', 'quick', 'snack']);
    expect(tagsForTab(rows, new Set(['b']), true)).toEqual(['dinner', 'quick']);
  });
});
