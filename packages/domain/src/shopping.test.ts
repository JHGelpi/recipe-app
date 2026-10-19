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
    ['peaches', 'peach'],
    ['radishes', 'radish'],
    ['boxes', 'box'],
    ['glasses', 'glass'],
    ['leaves', 'leaf'],
    ['bay leaves', 'bay leaf'],
    ['loaves', 'loaf'],
    ['halves', 'half'],
    ['cookies', 'cookie'],
    ['pies', 'pie'],
    ['brownies', 'brownie'],
    ['olives', 'olive'],
    ['cloves', 'clove'],
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

  it('merges rows not yet synced, which have no server timestamps, as the newest', () => {
    const lines = shoppingLines([
      row({ item: 'onion', quantity: 1, created_at: '2026-10-18T09:00:00Z' }),
      row({ item: 'onions', quantity: 2, aisle: 'frozen', created_at: null, updated_at: null }),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ item: 'onion', amount: '3', aisle: 'frozen' });
  });

  it('the household’s aisle choice wins over the rows’ own aisle (review I4)', () => {
    const lines = shoppingLines(
      [
        row({
          item: 'lemons',
          item_key: 'lemon',
          aisle: 'frozen',
          updated_at: '2026-10-18T09:00:00Z',
        }),
        row({ item: 'lemon', item_key: 'lemon', aisle: 'produce', updated_at: null }),
      ],
      new Map([['lemon', 'frozen']]),
    );
    expect(lines[0]!.aisle).toBe('frozen');
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

  it('keeps rows within what the server accepts (review I5)', () => {
    const big = {
      id: '00000000-0000-4000-8000-000000000003',
      title: 'Feast',
      ingredients: [
        ing({
          id: 'f',
          // Cans: a unit that never steps up, so the scaled amount stays too big.
          raw: '1000 cans tomatoes',
          quantity: 1000,
          unit: 'can',
          item: 'tomatoes',
          note: 'n'.repeat(300),
        }),
      ],
    };
    const [only] = addRows(big, 250, new Set(['f']), new Map());
    expect(only!.note).toHaveLength(200);
    expect(only!.quantity).toBeNull();
    expect(
      shoppingItemPutSchema.safeParse({
        id: '00000000-0000-4000-8000-000000000001',
        household_id: '00000000-0000-4000-8000-000000000002',
        ...only,
      }).success,
    ).toBe(true);
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

describe('bug batch (spec §2)', () => {
  it('a partly ticked line counts only what is still to buy', () => {
    const [line] = shoppingLines([
      row({ quantity: 2, checked_at: '2026-10-18T11:00:00Z' }),
      row({ quantity: 1 }),
    ]);
    expect(line!.checked).toBe(false);
    expect(line!.amount).toBe('1');
  });

  it('a fully ticked line shows its whole amount', () => {
    const [line] = shoppingLines([
      row({ quantity: 2, checked_at: '2026-10-18T11:00:00Z' }),
      row({ quantity: 1, checked_at: '2026-10-18T11:00:00Z' }),
    ]);
    expect(line!.amount).toBe('3');
  });

  it('a quantity of 0 shows no amount', () => {
    expect(shoppingLines([row({ quantity: 0 })])[0]!.amount).toBe('');
  });

  it('rows made at the same moment take the name of the lowest id', () => {
    const at = '2026-10-18T10:00:00Z';
    const lines = shoppingLines([
      row({ id: 'b', item: 'Onions', created_at: at }),
      row({ id: 'a', item: 'onion', created_at: at }),
    ]);
    expect(lines[0]!.item).toBe('onion');
  });

  it('a typed amount with no item keeps its text as the item, with no amount', () => {
    const typed = typedRow('2 cups', new Map())!;
    expect(typed).toMatchObject({ item: '2 cups', quantity: null, unit: null });
  });

  it('matches the last two words before the last word', () => {
    expect(aisleFor(itemKey('red bell peppers'), new Map())).toBe('produce');
    expect(aisleFor(itemKey('fresh lemon juice'), new Map())).toBe('produce');
    expect(aisleFor(itemKey('garlic cloves'), new Map())).toBe('produce');
    expect(aisleFor(itemKey('olives'), new Map())).toBe('pantry');
    expect(aisleFor(itemKey('egg yolks'), new Map())).toBe('dairy');
  });

  it('adds what the sheet shows: converted units', () => {
    const milk: Ingredient = {
      id: '11111111-1111-4111-8111-111111111111',
      raw: '1 cup milk',
      quantity: 1,
      quantity_max: null,
      unit: 'cup',
      item: 'milk',
      note: null,
      heading: false,
    };
    const [added] = addRows(
      { id: 'r', title: 'T', ingredients: [milk] },
      1,
      new Set([milk.id]),
      new Map(),
      'metric',
    );
    expect(added).toMatchObject({ unit: 'ml' });
    expect(added!.quantity).toBeCloseTo(236.588, 2);
  });

  it('adds a pinch where the sheet shows one', () => {
    const salt: Ingredient = {
      id: '22222222-2222-4222-8222-222222222222',
      raw: '⅛ tsp salt',
      quantity: 0.125,
      quantity_max: null,
      unit: 'tsp',
      item: 'salt',
      note: null,
      heading: false,
    };
    // Halved, ⅛ tsp is 1/16 tsp: the sheet shows "a pinch of salt".
    const [added] = addRows(
      { id: 'r', title: 'T', ingredients: [salt] },
      0.5,
      new Set([salt.id]),
      new Map(),
      'as_written',
    );
    expect(added).toMatchObject({ quantity: 1, unit: 'pinch' });
  });
});
