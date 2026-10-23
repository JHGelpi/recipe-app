import { describe, expect, it } from 'vitest';
import {
  changedReasons,
  duplicateMessage,
  editDuplicateMessage,
  findDuplicates,
  ingredientsKey,
  sourceUrlKey,
  titleKey,
  type ExistingRecipe,
  type MatchIngredient,
} from './duplicates';

type Line = MatchIngredient & { note: string | null; raw: string };

const line = (
  item: string,
  quantity: number | null = 1,
  unit: string | null = 'cup',
  extra: Partial<Line> = {},
): Line => ({
  item,
  quantity,
  quantity_max: null,
  unit,
  heading: false,
  note: null,
  raw: `${quantity ?? ''} ${unit ?? ''} ${item}`,
  ...extra,
});

const FOUR = [line('flour', 2), line('sugar'), line('butter', 0.5), line('eggs', 2, null)];

const recipe = (id: string, extra: Partial<ExistingRecipe> = {}): ExistingRecipe => ({
  id,
  title: `Recipe ${id}`,
  source_url: null,
  ingredients: [],
  trashed: false,
  ...extra,
});

describe('titleKey (FR-14)', () => {
  it('ignores case, extra spaces and punctuation', () => {
    expect(titleKey("Mom's  Chili!")).toBe(titleKey('moms chili'));
    expect(titleKey('  Crème   brûlée ')).toBe('crème brûlée');
    expect(titleKey('Chili')).not.toBe(titleKey('Chilli'));
  });

  it('a title of only punctuation has no key', () => {
    expect(titleKey('!!!')).toBeNull();
  });
});

describe('sourceUrlKey (FR-14)', () => {
  it('treats scheme, www, host case, fragment and trailing slash as the same page', () => {
    const key = sourceUrlKey('https://example.com/recipes/chili');
    for (const url of [
      'http://example.com/recipes/chili',
      'https://www.example.com/recipes/chili/',
      'https://EXAMPLE.com/recipes/chili#comments',
      ' https://www.Example.com/recipes/chili/#top ',
    ]) {
      expect(sourceUrlKey(url)).toBe(key);
    }
  });

  it('drops tracking parameters and keeps the rest', () => {
    expect(
      sourceUrlKey('https://example.com/r?id=7&utm_source=fb&utm_medium=x&fbclid=a&gclid=b'),
    ).toBe(sourceUrlKey('https://example.com/r?id=7'));
    expect(sourceUrlKey('https://example.com/r?id=7')).not.toBe(
      sourceUrlKey('https://example.com/r?id=8'),
    );
  });

  it('a path is still a path, and no link or an odd one has no key', () => {
    expect(sourceUrlKey('https://example.com/a')).not.toBe(sourceUrlKey('https://example.com/b'));
    expect(sourceUrlKey(null)).toBeNull();
    expect(sourceUrlKey('')).toBeNull();
    expect(sourceUrlKey('not a link')).toBeNull();
    expect(sourceUrlKey('ftp://example.com/a')).toBeNull();
  });
});

describe('ingredientsKey (FR-14)', () => {
  it('the same items and amounts match in any order; notes and raw text are ignored', () => {
    const reordered = [
      line('Eggs', 2, null, { note: 'beaten', raw: 'two eggs, beaten' }),
      line('butter', 0.5),
      line('  FLOUR ', 2),
      line('sugar'),
    ];
    expect(ingredientsKey(reordered)).toBe(ingredientsKey(FOUR));
  });

  it('a different amount, range or unit does not match', () => {
    expect(ingredientsKey([...FOUR.slice(0, 3), line('eggs', 3, null)])).not.toBe(
      ingredientsKey(FOUR),
    );
    expect(ingredientsKey([...FOUR.slice(0, 3), line('eggs', 2, 'tbsp')])).not.toBe(
      ingredientsKey(FOUR),
    );
    expect(
      ingredientsKey([...FOUR.slice(0, 3), line('eggs', 2, null, { quantity_max: 3 })]),
    ).not.toBe(ingredientsKey(FOUR));
  });

  it('headings are ignored and do not count toward the four lines', () => {
    const heading = line('For the cake', null, null, { heading: true });
    expect(ingredientsKey([heading, ...FOUR])).toBe(ingredientsKey(FOUR));
    expect(ingredientsKey([heading, ...FOUR.slice(0, 3)])).toBeNull();
  });

  it('three lines take no part; four do', () => {
    expect(ingredientsKey(FOUR.slice(0, 3))).toBeNull();
    expect(ingredientsKey(FOUR)).not.toBeNull();
  });

  it('a repeated item counts each time it appears', () => {
    const twice = [line('salt', 1, 'tsp'), line('salt', 1, 'tsp'), ...FOUR.slice(0, 3)];
    const once = [line('salt', 1, 'tsp'), ...FOUR.slice(0, 3), line('pepper', 1, 'tsp')];
    expect(ingredientsKey(twice)).not.toBe(ingredientsKey(once));
    expect(ingredientsKey(twice)).not.toBe(ingredientsKey([line('salt', 1, 'tsp'), ...FOUR]));
  });
});

describe('findDuplicates (FR-14)', () => {
  const household = [
    recipe('name', { title: "Mom's Chili" }),
    recipe('link', { source_url: 'https://www.example.com/chili/' }),
    recipe('food', { ingredients: FOUR }),
    recipe('trash', { title: 'Lemon Bars', trashed: true }),
  ];

  it('finds a match on any one of the three, links first, then ingredients, then name', () => {
    const matches = findDuplicates(
      { title: 'moms chili', source_url: 'http://example.com/chili', ingredients: FOUR },
      household,
    );
    expect(matches.map((match) => [match.id, match.reason])).toEqual([
      ['link', 'link'],
      ['food', 'ingredients'],
      ['name', 'title'],
    ]);
    expect(duplicateMessage(matches)).toBe(
      'You already have “Recipe link” (same link) and 2 others.',
    );
  });

  it('a recipe matching on several counts appears once, by its strongest', () => {
    const both = [recipe('x', { title: 'Chili', ingredients: FOUR })];
    expect(findDuplicates({ title: 'chili', ingredients: FOUR }, both)).toEqual([
      { id: 'x', title: 'Chili', reason: 'ingredients', trashed: false },
    ]);
  });

  it('recipes in the Trash match, and the warning says so', () => {
    const matches = findDuplicates({ title: 'lemon bars' }, household);
    expect(matches).toEqual([{ id: 'trash', title: 'Lemon Bars', reason: 'title', trashed: true }]);
    expect(duplicateMessage(matches)).toBe(
      'You already have “Lemon Bars” in the Trash (same name).',
    );
  });

  it('a recipe never matches itself', () => {
    expect(findDuplicates({ title: "Mom's Chili" }, household, { selfId: 'name' })).toEqual([]);
  });

  it('no link and short lists never match on those', () => {
    const linkless = [recipe('a'), recipe('b', { ingredients: FOUR.slice(0, 3) })];
    expect(
      findDuplicates({ title: 'New', source_url: null, ingredients: FOUR.slice(0, 3) }, linkless),
    ).toEqual([]);
  });

  it('checks only the reasons asked for', () => {
    expect(
      findDuplicates({ title: "Mom's Chili", ingredients: FOUR }, household, {
        only: ['ingredients'],
      }).map((match) => match.id),
    ).toEqual(['food']);
  });
});

describe('an edit (FR-14)', () => {
  const before = { title: 'Banana Bread', source_url: null, ingredients: FOUR };

  it('checks only the fields it changed', () => {
    expect(changedReasons(before, { ...before, title: 'banana bread!' })).toEqual([]);
    expect(changedReasons(before, { ...before, title: 'Banana Loaf' })).toEqual(['title']);
    expect(changedReasons(before, { ...before, ingredients: [...FOUR].reverse() })).toEqual([]);
    expect(changedReasons(before, { ...before, ingredients: [...FOUR, line('walnuts')] })).toEqual([
      'ingredients',
    ]);
  });

  it('asks in its own words', () => {
    expect(
      editDuplicateMessage([{ id: 'b', title: 'Banana Bread', reason: 'title', trashed: false }]),
    ).toBe('“Banana Bread” already has this name. Save anyway?');
    expect(editDuplicateMessage([])).toBeNull();
  });
});
