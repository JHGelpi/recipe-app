import { describe, expect, it } from 'vitest';
import { buildSearchIndex, normalizeSearchText, searchRecipes, type SearchSource } from './search';

const RECIPES: SearchSource[] = [
  {
    id: 'tikka',
    title: 'Chicken Tikka',
    ingredients: ['1 lb chicken thighs', '1 cup yogurt'],
    tags: ['dinner', 'spicy'],
  },
  {
    id: 'rice',
    title: 'Fried rice',
    ingredients: ['2 cups rice', '1 cup chicken stock'],
    tags: ['dinner', 'quick'],
  },
  { id: 'both', title: 'Chicken and rice', ingredients: ['1 onion'], tags: ['quick'] },
  {
    id: 'pancakes',
    title: 'Pancakes',
    ingredients: ['1 (14 oz) can milk', '2 eggs'],
    tags: ['breakfast'],
  },
  {
    id: 'poppers',
    title: 'Jalapeño poppers',
    ingredients: ['6 jalapeños', 'salt', 'pepper'],
    tags: ['snack'],
  },
  { id: 'bread', title: 'Quickbread', ingredients: ['3 cups flour'], tags: ['quickbread'] },
];
const index = buildSearchIndex(RECIPES);
const search = (query: string, tags: string[] = []) => searchRecipes(index, query, tags);

describe('normalizeSearchText', () => {
  it('lowercases, removes accents, and collapses whitespace', () => {
    expect(normalizeSearchText('  Jalapeño   POPPERS ')).toBe('jalapeno poppers');
    expect(normalizeSearchText('Crème\tBrûlée')).toBe('creme brulee');
  });
});

describe('searchRecipes matching', () => {
  it('finds part of a word in the title, ingredients, or tags', () => {
    expect(search('tikk')).toEqual(['tikka']);
    expect(search('yog')).toEqual(['tikka']);
    expect(search('breakf')).toEqual(['pancakes']);
  });

  it('ignores case and accents in both directions', () => {
    expect(search('JALAPENO')).toEqual(['poppers']);
    expect(search('jalapeño')).toEqual(['poppers']);
  });

  it('requires every word, in any fields', () => {
    expect(search('rice chick').sort()).toEqual(['both', 'rice']);
    expect(search('chicken yogurt')).toEqual(['tikka']);
    expect(search('chicken zebra')).toEqual([]);
  });

  it('accepts one- and two-letter words', () => {
    expect(search('q')).toContain('rice');
    expect(search('eg')).toEqual(['pancakes']);
  });

  it('does not match across two ingredient lines', () => {
    // "salt" and "pepper" are separate lines; "tpep" would only match if joined.
    expect(search('tpep')).toEqual([]);
  });

  it('treats pattern characters as plain text', () => {
    expect(search('(14')).toEqual(['pancakes']);
    expect(() => search('c++ .* ? [')).not.toThrow();
    expect(search('c++')).toEqual([]);
  });

  it('returns nothing, quickly, for a long pasted query', () => {
    const long = 'lorem ipsum dolor '.repeat(500);
    const started = performance.now();
    expect(search(long)).toEqual([]);
    expect(performance.now() - started).toBeLessThan(100);
  });

  it('treats an empty or whitespace-only query as no words: everything, alphabetically', () => {
    const all = ['both', 'tikka', 'rice', 'poppers', 'pancakes', 'bread'];
    expect(search('')).toEqual(all);
    expect(search('   ')).toEqual(all);
  });
});

describe('searchRecipes tags', () => {
  it('matches selected tags exactly, all of them required', () => {
    expect(search('', ['quick']).sort()).toEqual(['both', 'rice']);
    expect(search('', ['dinner', 'quick'])).toEqual(['rice']);
    expect(search('', ['quick'])).not.toContain('bread'); // "quickbread" is a different tag
  });

  it('combines tags with words', () => {
    expect(search('chicken', ['quick']).sort()).toEqual(['both', 'rice']);
    expect(search('tikka', ['quick'])).toEqual([]);
  });
});

describe('searchRecipes ranking', () => {
  it('lists title matches before ingredient matches', () => {
    expect(search('chicken')).toEqual(['both', 'tikka', 'rice']);
  });

  it('ranks a match at the start of a word above one in the middle', () => {
    const local = buildSearchIndex([
      { id: 'middle', title: 'Spicken', ingredients: [], tags: [] },
      { id: 'start', title: 'Ickle pie', ingredients: [], tags: [] },
    ]);
    expect(searchRecipes(local, 'ick', [])).toEqual(['start', 'middle']);
  });

  it('breaks ties by title', () => {
    const local = buildSearchIndex([
      { id: 'b', title: 'Beef soup', ingredients: [], tags: [] },
      { id: 'a', title: 'Apple soup', ingredients: [], tags: [] },
    ]);
    expect(searchRecipes(local, 'soup', [])).toEqual(['a', 'b']);
  });

  it('finds a recipe with no readable ingredients by its title', () => {
    const local = buildSearchIndex([{ id: 'x', title: 'Mystery stew', ingredients: [], tags: [] }]);
    expect(searchRecipes(local, 'stew', [])).toEqual(['x']);
  });
});

describe('speed (NFR-6: under 300 ms over 2,000 recipes on a phone)', () => {
  it('builds and searches 2,000 recipes well inside the budget', () => {
    const words = [
      'chicken',
      'beef',
      'rice',
      'onion',
      'garlic',
      'tomato',
      'basil',
      'flour',
      'sugar',
      'butter',
    ];
    const many: SearchSource[] = Array.from({ length: 2000 }, (_, n) => ({
      id: `r${n}`,
      title: `Recipe ${n} ${words[n % 10]}`,
      ingredients: Array.from(
        { length: 10 },
        (_, k) => `${k + 1} cups ${words[(n + k) % 10]}, chopped`,
      ),
      tags: [words[n % 10] ?? 'x', 'dinner', `tag${n % 7}`],
    }));
    let started = performance.now();
    const big = buildSearchIndex(many);
    expect(performance.now() - started).toBeLessThan(1000);
    started = performance.now();
    searchRecipes(big, 'chick rice garl', ['dinner']);
    expect(performance.now() - started).toBeLessThan(100);
  });
});
