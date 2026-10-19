import { describe, expect, it } from 'vitest';
import { aisleChoiceId } from './choiceId';
import {
  addShoppingRows,
  clearList,
  clearTicked,
  moveToAisle,
  removeRows,
  setTicked,
} from './repository';

type Call = { sql: string; params: unknown[] };
function fakeDb(answers: { live?: number; choice?: { id: string } | null } = {}) {
  const calls: Call[] = [];
  return {
    calls,
    db: {
      execute: async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        return { rowsAffected: 1 } as never;
      },
      getOptional: async (sql: string) =>
        (sql.includes('count(*)')
          ? { live: answers.live ?? 0 }
          : (answers.choice ?? null)) as never,
    },
  };
}
const member = { userId: 'u1', householdId: 'h1', role: 'member' as const };
const viewer = { ...member, role: 'viewer' as const };
const onion = {
  item: 'onions',
  item_key: 'onion',
  quantity: 2,
  quantity_max: null,
  unit: null,
  note: null,
  aisle: 'produce' as const,
  recipe_id: 'r1',
  recipe_title: 'Soup',
};

describe('shopping list writes', () => {
  it('inserts each row with the household id', async () => {
    const { db, calls } = fakeDb();
    expect(await addShoppingRows(db, member, [onion])).toBe('added');
    expect(calls[0]!.sql).toMatch(/^insert into shopping_items/);
    expect(calls[0]!.params).toEqual(
      expect.arrayContaining(['h1', 'onions', 'onion', 2, 'produce', 'r1', 'Soup']),
    );
  });

  it('refuses to go past 500 live rows', async () => {
    const { db, calls } = fakeDb({ live: 499 });
    expect(await addShoppingRows(db, member, [onion, onion])).toBe('full');
    expect(calls).toHaveLength(0);
  });

  it('ticks, unticks, removes and clears with soft writes only', async () => {
    const { db, calls } = fakeDb();
    await setTicked(db, member, ['a', 'b'], true);
    await setTicked(db, member, ['a'], false);
    await removeRows(db, member, ['a']);
    await clearTicked(db, member);
    await clearList(db, member);
    expect(calls.map((c) => c.sql.split(' ').slice(0, 3).join(' '))).toEqual(
      Array(5).fill('update shopping_items set'),
    );
    expect(calls[0]!.params.slice(1)).toEqual(['a', 'b']);
    expect(calls[1]!.params[0]).toBeNull();
    expect(calls.every((c) => !/^delete/.test(c.sql))).toBe(true);
  });

  it('moving to an aisle writes the choice and moves the item’s rows', async () => {
    const { db, calls } = fakeDb({ choice: null });
    await moveToAisle(db, member, 'onion', 'frozen');
    expect(calls[0]!.sql).toMatch(/^insert into aisle_choices/);
    expect(calls[1]!.sql).toMatch(/^update shopping_items set aisle = \?/);
    const again = fakeDb({ choice: { id: 'c1' } });
    await moveToAisle(again.db, member, 'onion', 'dairy');
    expect(again.calls[0]!.sql).toMatch(/^update aisle_choices set aisle = \?/);
  });

  it('a new aisle choice uses the household-and-item id every phone computes (review I3)', async () => {
    const { db, calls } = fakeDb({ choice: null });
    await moveToAisle(db, member, 'lemon', 'frozen');
    expect(calls[0]!.params[0]).toBe(await aisleChoiceId('h1', 'lemon'));
  });

  it('viewers cannot change the list', async () => {
    const { db } = fakeDb();
    await expect(addShoppingRows(db, viewer, [onion])).rejects.toThrow(/Viewers/);
    await expect(setTicked(db, viewer, ['a'], true)).rejects.toThrow(/Viewers/);
    await expect(moveToAisle(db, viewer, 'onion', 'frozen')).rejects.toThrow(/Viewers/);
  });
});
