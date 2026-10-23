import { describe, expect, it } from 'vitest';
import { DUPLICATE_SOURCES_SQL, existingRecipeFrom, findLocalDuplicates } from './duplicates';

const line = (item: string, quantity: number) => ({
  id: crypto.randomUUID(),
  raw: `${quantity} cup ${item}`,
  quantity,
  quantity_max: null,
  unit: 'cup',
  item,
  note: null,
  heading: false,
});
const FOUR = [line('flour', 2), line('sugar', 1), line('milk', 1), line('oats', 3)];

const rows: Record<string, unknown>[] = [
  { id: 'a', title: 'Banana Bread', source_url: null, ingredients: '[]', deleted_at: null },
  {
    id: 'b',
    title: 'Porridge',
    source_url: 'https://example.com/porridge',
    ingredients: JSON.stringify(FOUR),
    deleted_at: '2026-10-20T10:00:00Z',
  },
  // An odd row still takes part by what it can read.
  { id: 'c', title: 'Odd', source_url: 7, ingredients: 'not json', deleted_at: null },
];

const fakeDb = (seen: string[] = []) => ({
  getAll: async <T>(sql: string) => {
    seen.push(sql);
    return rows as T[];
  },
});

describe('existingRecipeFrom (FR-14)', () => {
  it('reads ingredient lines from the JSON column and marks the Trash', () => {
    const recipe = existingRecipeFrom(rows[1]!);
    expect(recipe.trashed).toBe(true);
    expect(recipe.ingredients).toHaveLength(4);
    expect(recipe.ingredients?.[0]).toEqual({
      item: 'flour',
      quantity: 2,
      quantity_max: null,
      unit: 'cup',
      heading: false,
    });
  });

  it('an unreadable column reads as empty', () => {
    expect(existingRecipeFrom(rows[2]!)).toEqual({
      id: 'c',
      title: 'Odd',
      source_url: null,
      ingredients: [],
      trashed: false,
    });
  });
});

describe('findLocalDuplicates (FR-14)', () => {
  it('checks every local recipe, the Trash too', async () => {
    const seen: string[] = [];
    const matches = await findLocalDuplicates(fakeDb(seen), {
      title: 'Overnight oats',
      ingredients: [...FOUR].reverse(),
    });
    expect(seen).toEqual([DUPLICATE_SOURCES_SQL]);
    expect(matches).toEqual([{ id: 'b', title: 'Porridge', reason: 'ingredients', trashed: true }]);
  });

  it('a recipe being edited never matches itself', async () => {
    expect(await findLocalDuplicates(fakeDb(), { title: 'banana bread' }, { selfId: 'a' })).toEqual(
      [],
    );
  });

  it('a check that fails finds nothing, so the save goes ahead', async () => {
    const broken = {
      getAll: async () => {
        throw new Error('database closed');
      },
    };
    expect(await findLocalDuplicates(broken, { title: 'Banana Bread' })).toEqual([]);
  });
});
