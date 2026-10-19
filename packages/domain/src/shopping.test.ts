import { describe, expect, it } from 'vitest';
import type { Ingredient } from './ingredients';
import {
  addRows,
  aisleFor,
  itemKey,
  shoppingItemPutSchema,
  shoppingLines,
  typedRow,
  type ShoppingRow,
} from './shopping';

let n = 0;
function row(over: Partial<ShoppingRow>): ShoppingRow {
  n += 1;
  return {
    id: `r${n}`,
    item: 'onion',
    item_key: 'onion',
    quantity: null,
    quantity_max: null,
    unit: null,
    note: null,
    aisle: 'produce',
    recipe_id: null,
    recipe_title: null,
    checked_at: null,
    created_at: `2026-10-18T10:00:${String(n).padStart(2, '0')}Z`,
    updated_at: `2026-10-18T10:00:${String(n).padStart(2, '0')}Z`,
    ...over,
  };
}

describe('itemKey', () => {
  it.each([
    ['Onions', 'onion'],
    ['  red   onions ', 'red onion'],
    ['berries', 'berry'],
    ['tomatoes', 'tomato'],
    ['glass', 'glass'],
    ['hummus', 'hummus'],
    ['asparagus', 'asparagus'],
    ['couscous', 'couscous'],
    ['molasses', 'molasses'],
    ['eggs', 'egg'],
  ])('%s → %s', (input, key) => expect(itemKey(input)).toBe(key));
});

describe('aisleFor', () => {
  it('matches the whole key, then its last word, then falls back to other', () => {
    expect(aisleFor('onion', new Map())).toBe('produce');
    expect(aisleFor('red onion', new Map())).toBe('produce');
    expect(aisleFor('milk', new Map())).toBe('dairy');
    expect(aisleFor('paper towel', new Map())).toBe('household');
    expect(aisleFor('zzz unknown', new Map())).toBe('other');
  });
  it('a household choice beats the guess', () => {
    expect(aisleFor('onion', new Map([['onion', 'frozen']]))).toBe('frozen');
  });
});

describe('shoppingLines', () => {
  it('merges counts by item and lists each recipe once', () => {
    const lines = shoppingLines([
      row({ quantity: 1, recipe_id: 'a', recipe_title: 'Soup' }),
      row({ item: 'onions', quantity: 2, recipe_id: 'b', recipe_title: 'Stew' }),
      row({ quantity: 1, recipe_id: 'a', recipe_title: 'Soup' }),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      item: 'onion',
      amount: '4',
      handAdded: false,
      checked: false,
      recipes: [
        { id: 'a', title: 'Soup' },
        { id: 'b', title: 'Stew' },
      ],
    });
    expect(lines[0]!.rowIds).toHaveLength(3);
  });

  it('adds US and metric volumes in the first row’s unit', () => {
    const [line] = shoppingLines([
      row({ item: 'milk', item_key: 'milk', aisle: 'dairy', quantity: 1, unit: 'cup' }),
      row({ item: 'milk', item_key: 'milk', aisle: 'dairy', quantity: 200, unit: 'ml' }),
    ]);
    expect(line!.amount).toBe('1⅞ cups'); // 436.6 ml = 1.85 cups → nearest eighth
  });

  it('adds weights, keeps other units apart, and joins kinds in a fixed order', () => {
    const [line] = shoppingLines([
      row({ item: 'tomatoes', item_key: 'tomato', quantity: 1, unit: 'can' }),
      row({ item: 'tomatoes', item_key: 'tomato', quantity: 200, unit: 'g' }),
      row({ item: 'tomatoes', item_key: 'tomato', quantity: 2 }),
      row({ item: 'tomatoes', item_key: 'tomato', quantity: 300, unit: 'g' }),
      row({ item: 'tomatoes', item_key: 'tomato' }),
    ]);
    expect(line!.amount).toBe('2 + 500 g + 1 can + to taste');
  });

  it('adds both ends of ranges', () => {
    const [line] = shoppingLines([row({ quantity: 1, quantity_max: 2 }), row({ quantity: 1 })]);
    expect(line!.amount).toBe('2–3');
  });

  it('shows no amount when no row has one', () => {
    expect(
      shoppingLines([row({ item: 'salt', item_key: 'salt', aisle: 'spices' })])[0]!.amount,
    ).toBe('');
  });

  it('is ticked only when every row is', () => {
    const ticked = '2026-10-18T11:00:00Z';
    expect(
      shoppingLines([row({ checked_at: ticked }), row({ checked_at: ticked })])[0]!.checked,
    ).toBe(true);
    expect(shoppingLines([row({ checked_at: ticked }), row({})])[0]!.checked).toBe(false);
  });

  it('takes the aisle of the most recently updated row and sorts by aisle, then item', () => {
    const lines = shoppingLines([
      row({ item: 'milk', item_key: 'milk', aisle: 'dairy', updated_at: '2026-10-18T09:00:00Z' }),
      row({ item: 'milk', item_key: 'milk', aisle: 'frozen', updated_at: '2026-10-18T12:00:00Z' }),
      row({ item: 'basil', item_key: 'basil', aisle: 'produce' }),
      row({ item: 'apple', item_key: 'apple', aisle: 'produce' }),
    ]);
    expect(lines.map((line) => [line.item, line.aisle])).toEqual([
      ['apple', 'produce'],
      ['basil', 'produce'],
      ['milk', 'frozen'],
    ]);
  });

  it('marks typed items as hand added', () => {
    expect(shoppingLines([row({})])[0]!.handAdded).toBe(true);
  });
});

const ing = (over: Partial<Ingredient>): Ingredient => ({
  id: 'i',
  raw: '',
  quantity: null,
  quantity_max: null,
  unit: null,
  item: '',
  note: null,
  heading: false,
  ...over,
});

describe('addRows', () => {
  const recipe = {
    id: 'rec1',
    title: 'Soup',
    ingredients: [
      ing({ id: 'h', raw: 'For the soup', heading: true }),
      ing({ id: 'a', raw: '2 onions, diced', quantity: 2, item: 'onions', note: 'diced' }),
      ing({ id: 'b', raw: '1 cup stock', quantity: 1, unit: 'cup', item: 'stock' }),
      ing({ id: 'c', raw: 'Salt and pepper to taste' }),
    ],
  };

  it('scales the chosen lines, skips headings, and works out aisles', () => {
    const rows = addRows(recipe, 2, new Set(['h', 'a', 'b']), new Map());
    expect(rows).toEqual([
      expect.objectContaining({
        item: 'onions',
        item_key: 'onion',
        quantity: 4,
        note: 'diced',
        aisle: 'produce',
        recipe_id: 'rec1',
        recipe_title: 'Soup',
      }),
      expect.objectContaining({ item: 'stock', quantity: 2, unit: 'cup', aisle: 'pantry' }),
    ]);
  });

  it('uses the raw text when the item is empty', () => {
    const [only] = addRows(recipe, 1, new Set(['c']), new Map());
    expect(only).toMatchObject({ item: 'Salt and pepper to taste', quantity: null });
    expect(only!.item_key).toBe('salt and pepper to taste');
  });
});

it('typedRow reads the amount and refuses blank or over-long text', () => {
  expect(typedRow('2 lemons', new Map())).toMatchObject({
    item: 'lemons',
    item_key: 'lemon',
    quantity: 2,
    aisle: 'produce',
    recipe_id: null,
  });
  expect(typedRow('   ', new Map())).toBeNull();
  expect(typedRow('x'.repeat(201), new Map())).toBeNull();
});

it('the put schema refuses a bad aisle and a 201-character item', () => {
  const base = {
    id: '00000000-0000-4000-8000-000000000001',
    household_id: '00000000-0000-4000-8000-000000000002',
    item: 'onion',
    item_key: 'onion',
    aisle: 'produce',
  };
  expect(shoppingItemPutSchema.safeParse(base).success).toBe(true);
  expect(shoppingItemPutSchema.safeParse({ ...base, aisle: 'garden' }).success).toBe(false);
  expect(shoppingItemPutSchema.safeParse({ ...base, item: 'x'.repeat(201) }).success).toBe(false);
});
