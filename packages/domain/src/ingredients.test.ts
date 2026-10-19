import { describe, expect, it } from 'vitest';
import {
  ingredientsFromText,
  ingredientsToText,
  parseIngredientLine,
  type Ingredient,
} from './ingredients';

type Case = [string, Partial<ReturnType<typeof parseIngredientLine>>];

const CASES: Case[] = [
  ['2 1/2 cups flour, sifted', { quantity: 2.5, unit: 'cup', item: 'flour', note: 'sifted' }],
  ['½ tsp salt', { quantity: 0.5, unit: 'tsp', item: 'salt', note: null }],
  ['1½ cups milk', { quantity: 1.5, unit: 'cup', item: 'milk' }],
  ['1.5 lb chicken thighs', { quantity: 1.5, unit: 'lb', item: 'chicken thighs' }],
  [
    '2-3 cloves garlic, minced',
    { quantity: 2, quantity_max: 3, unit: 'clove', item: 'garlic', note: 'minced' },
  ],
  ['2 – 3 cloves garlic', { quantity: 2, quantity_max: 3, unit: 'clove' }],
  ['2 to 3 tbsp oil', { quantity: 2, quantity_max: 3, unit: 'tbsp', item: 'oil' }],
  ['1 T butter', { quantity: 1, unit: 'tbsp', item: 'butter' }],
  ['1 t vanilla', { quantity: 1, unit: 'tsp', item: 'vanilla' }],
  ['1 Tbsp. sugar', { quantity: 1, unit: 'tbsp', item: 'sugar' }],
  ['3 eggs', { quantity: 3, unit: null, item: 'eggs' }],
  ['2 large eggs, beaten', { quantity: 2, unit: null, item: 'large eggs', note: 'beaten' }],
  ['1 cup of rice', { quantity: 1, unit: 'cup', item: 'rice' }],
  ['4 oz cream cheese', { quantity: 4, unit: 'oz', item: 'cream cheese' }],
  ['2 lbs ground beef', { quantity: 2, unit: 'lb', item: 'ground beef' }],
  ['500 g pasta', { quantity: 500, unit: 'g', item: 'pasta' }],
  ['250 ml stock', { quantity: 250, unit: 'ml', item: 'stock' }],
  ['1 l water', { quantity: 1, unit: 'l', item: 'water' }],
  ['1 can diced tomatoes', { quantity: 1, unit: 'can', item: 'diced tomatoes' }],
  ['2 pkg yeast', { quantity: 2, unit: 'package', item: 'yeast' }],
  ['1 stick butter, softened', { quantity: 1, unit: 'stick', item: 'butter', note: 'softened' }],
  ['3 slices bacon', { quantity: 3, unit: 'slice', item: 'bacon' }],
  ['1 pinch nutmeg', { quantity: 1, unit: 'pinch', item: 'nutmeg' }],
  ['2 dashes hot sauce', { quantity: 2, unit: 'dash', item: 'hot sauce' }],
  ['1 qt buttermilk', { quantity: 1, unit: 'quart', item: 'buttermilk' }],
  ['1 pint cream', { quantity: 1, unit: 'pint', item: 'cream' }],
  ['1 gallon water', { quantity: 1, unit: 'gallon', item: 'water' }],
  ['1 kg potatoes', { quantity: 1, unit: 'kg', item: 'potatoes' }],
  ['3 c flour', { quantity: 3, unit: 'cup', item: 'flour' }],
  ['2 carrots, diced', { quantity: 2, unit: null, item: 'carrots', note: 'diced' }],
  ['.5 cup sugar', { quantity: 0.5, unit: 'cup', item: 'sugar' }],
  ['1/3 cup honey', { quantity: 1 / 3, unit: 'cup', item: 'honey' }],
  [
    '1 (14 oz, drained) can beans, rinsed',
    { quantity: 1, item: '(14 oz, drained) can beans', note: 'rinsed' },
  ],
  ['2 cups', { quantity: 2, unit: 'cup', item: '' }],
  ['salt to taste', { quantity: null, unit: null, item: 'salt to taste', note: null }],
  ['Salt, to taste', { quantity: null, item: 'Salt', note: 'to taste' }],
  ['For the sauce:', { quantity: null, item: 'For the sauce', heading: true }],
  ['  3   eggs  ', { raw: '3 eggs', quantity: 3, item: 'eggs' }],
  ['1/0 cup water', { quantity: null, unit: null, item: '1/0 cup water' }],
];

describe('parseIngredientLine', () => {
  it.each(CASES)('parses %j', (raw, expected) => {
    expect(parseIngredientLine(raw)).toMatchObject(expected);
  });

  it('keeps the typed text, trimmed and with single spaces', () => {
    expect(parseIngredientLine('2 1/2 cups flour, sifted').raw).toBe('2 1/2 cups flour, sifted');
  });

  it('marks only lines ending in a colon without a quantity as headings', () => {
    expect(parseIngredientLine('For the sauce:').heading).toBe(true);
    expect(parseIngredientLine('2 cups sauce:').heading).toBe(false);
    expect(parseIngredientLine('flour').heading).toBe(false);
  });

  it('never throws on odd input', () => {
    for (const raw of ['', ':', '-', '½', '1 -', 'to', '()', ',,,']) {
      expect(() => parseIngredientLine(raw)).not.toThrow();
    }
  });
});

describe('ingredientsFromText', () => {
  let counter = 0;
  const newId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

  it('makes one ingredient per non-empty line', () => {
    const list = ingredientsFromText('2 cups flour\n\n  \n1 egg\n', [], newId);
    expect(list.map((ingredient) => ingredient.raw)).toEqual(['2 cups flour', '1 egg']);
  });

  it('keeps an unchanged line whole, and a changed line keeps only its id', () => {
    const first = ingredientsFromText('2 cups flour\n1 egg', [], newId);
    const second = ingredientsFromText('2 cups flour\n2 eggs', first, newId);
    expect(second[0]).toBe(first[0]);
    expect(second[1]?.id).toBe(first[1]?.id);
    expect(second[1]).toMatchObject({ raw: '2 eggs', quantity: 2 });
  });

  it('keeps distinct ids for the same line typed twice, across an edit', () => {
    const first = ingredientsFromText('1 egg\n1 egg', [], newId);
    expect(first[0]?.id).not.toBe(first[1]?.id);
    const second = ingredientsFromText('1 egg\n1 cup milk\n1 egg', first, newId);
    expect([second[0]?.id, second[2]?.id].sort()).toEqual([first[0]?.id, first[1]?.id].sort());
  });

  it('round-trips through ingredientsToText', () => {
    const list: Ingredient[] = ingredientsFromText('2 cups flour\nFor the top:\n1 egg', [], newId);
    expect(ingredientsToText(list)).toBe('2 cups flour\nFor the top:\n1 egg');
  });
});

it('keeps an unchanged line exactly as it was read before, not re-read', () => {
  const previous = [
    {
      id: 'a',
      raw: '2 cups flour, sifted',
      quantity: 2,
      quantity_max: null,
      unit: 'cup' as const,
      item: 'bread flour',
      note: 'sifted',
      heading: false,
    },
  ];
  const result = ingredientsFromText('2 cups flour, sifted\n1 egg', previous, () => 'new');
  expect(result[0]).toEqual(previous[0]);
  expect(result[1]).toMatchObject({ id: 'new', raw: '1 egg', item: 'egg' });
});

describe('review fixes: amounts the parser missed (Important 4)', () => {
  it('reads a whole number and a separate vulgar fraction', () => {
    expect(parseIngredientLine('1 ½ cups (360ml) milk')).toMatchObject({
      quantity: 1.5,
      unit: 'cup',
      item: '(360ml) milk',
    });
  });

  it('reads a metric unit glued to its number, keeping the typed line', () => {
    expect(parseIngredientLine('250g butter')).toMatchObject({
      raw: '250g butter',
      quantity: 250,
      unit: 'g',
      item: 'butter',
    });
    expect(parseIngredientLine('1.5kg potatoes')).toMatchObject({
      quantity: 1.5,
      unit: 'kg',
      item: 'potatoes',
    });
    expect(parseIngredientLine('2 large eggs')).toMatchObject({
      quantity: 2,
      unit: null,
      item: 'large eggs',
    });
  });
});

describe('review fixes: an edited line keeps its id (Important 3)', () => {
  it('gives a changed line the id of the line it replaced, with a fresh reading', () => {
    let n = 0;
    const newId = () => `new-${++n}`;
    const before = ingredientsFromText('1 cup buttermilk\n2 eggs', [], newId);
    const after = ingredientsFromText('2 cups buttermilk\n2 eggs', before, newId);
    expect(after.map((i) => i.id)).toEqual(before.map((i) => i.id));
    expect(after[0]).toMatchObject({ raw: '2 cups buttermilk', quantity: 2 });
    const added = ingredientsFromText('2 cups buttermilk\n2 eggs\n1 tsp salt', after, newId);
    expect(added[2]?.id).toMatch(/^new-/);
  });
});

describe('the fraction slash (bug batch spec §2)', () => {
  it('reads it like a slash', () => {
    expect(parseIngredientLine('1⁄2 cup milk')).toMatchObject({ quantity: 0.5, unit: 'cup', item: 'milk', raw: '1⁄2 cup milk' });
    expect(parseIngredientLine('1 1⁄2 cups milk')).toMatchObject({ quantity: 1.5, unit: 'cup' });
  });
});
