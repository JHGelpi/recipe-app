import { describe, expect, it } from 'vitest';
import { tagsForTab, toListItems } from './listItems';
import type { ListRow } from './rows';

const row = (id: string, tags: string[] = []): ListRow => ({
  id,
  title: id.toUpperCase(),
  tags,
  ingredients: [],
  starred: false,
});
const rows = new Map([
  ['a', row('a', ['dinner'])],
  ['b', row('b', ['quick', 'dinner'])],
  ['c', row('c', ['snack'])],
]);

describe('toListItems', () => {
  it('keeps the search order, marks stars from the favorites set, and skips unknown ids', () => {
    expect(toListItems(['c', 'x', 'a'], rows, new Set(['a']), false)).toEqual([
      { id: 'c', title: 'C', tags: ['snack'], starred: false },
      { id: 'a', title: 'A', tags: ['dinner'], starred: true },
    ]);
  });

  it('keeps only starred recipes on the Favorites tab, in order', () => {
    expect(
      toListItems(['b', 'c', 'a'], rows, new Set(['a', 'b']), true).map((item) => item.id),
    ).toEqual(['b', 'a']);
  });
});

describe('tagsForTab', () => {
  it('lists the distinct tags of the tab’s recipes, alphabetically', () => {
    expect(tagsForTab(rows, new Set(['b']), false)).toEqual(['dinner', 'quick', 'snack']);
    expect(tagsForTab(rows, new Set(['b']), true)).toEqual(['dinner', 'quick']);
  });
});
