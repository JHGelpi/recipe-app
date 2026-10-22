import { describe, expect, it } from 'vitest';
import { createRecipe, restoreRecipe, setFavorite, trashRecipe, updateRecipe } from './repository';
import type { RecipeValues } from './form';

type Call = { sql: string; params: unknown[] };

function fakeDb(existingFavorite: { id: string } | null = null) {
  const calls: Call[] = [];
  return {
    calls,
    db: {
      execute: async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        return { rowsAffected: 1 } as never;
      },
      getOptional: async () => existingFavorite as never,
    },
  };
}

const member = { userId: 'u1', householdId: 'h1', role: 'member' as const };
const viewer = { ...member, role: 'viewer' as const };
const values: RecipeValues = {
  title: 'Bread',
  servings: 2,
  prep_minutes: null,
  cook_minutes: 30,
  ingredients: [],
  steps: [],
  tags: ['bread'],
  notes: '',
  nutrition: null,
};

describe('recipe writes', () => {
  it('creates a recipe with JSON text columns and the household id', async () => {
    const { db, calls } = fakeDb();
    const id = await createRecipe(db, member, values);
    expect(calls[0]?.sql).toMatch(/^insert into recipes/);
    expect(calls[0]?.params).toEqual([
      id,
      'h1',
      'Bread',
      2,
      null,
      30,
      '[]',
      '[]',
      '["bread"]',
      '',
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it('updates every field but never deleted_at', async () => {
    const { db, calls } = fakeDb();
    await updateRecipe(db, member, 'r1', values);
    expect(calls[0]?.sql).not.toMatch(/deleted_at/);
    expect(calls[0]?.params.at(-1)).toBe('r1');
  });

  it('trashes and restores through deleted_at', async () => {
    const { db, calls } = fakeDb();
    await trashRecipe(db, member, 'r1');
    await restoreRecipe(db, member, 'r1');
    expect(calls[0]?.sql).toBe('update recipes set deleted_at = ? where id = ?');
    expect(typeof calls[0]?.params[0]).toBe('string');
    expect(calls[1]?.params).toEqual([null, 'r1']);
  });

  it('refuses every recipe write for a viewer', async () => {
    const { db } = fakeDb();
    await expect(createRecipe(db, viewer, values)).rejects.toThrow();
    await expect(updateRecipe(db, viewer, 'r1', values)).rejects.toThrow();
    await expect(trashRecipe(db, viewer, 'r1')).rejects.toThrow();
    await expect(restoreRecipe(db, viewer, 'r1')).rejects.toThrow();
  });
});

describe('setFavorite', () => {
  it('inserts a new favorite row the first time', async () => {
    const { db, calls } = fakeDb(null);
    await setFavorite(db, viewer, 'r1', true);
    expect(calls[0]?.sql).toMatch(/^insert into favorites/);
    expect(calls[0]?.params.slice(1)).toEqual(['h1', 'u1', 'r1']);
  });

  it('un-stars and re-stars the existing row', async () => {
    const { db, calls } = fakeDb({ id: 'f1' });
    await setFavorite(db, viewer, 'r1', false);
    await setFavorite(db, viewer, 'r1', true);
    expect(calls[0]?.sql).toBe('update favorites set deleted_at = ? where id = ?');
    expect(typeof calls[0]?.params[0]).toBe('string');
    expect(calls[1]?.params).toEqual([null, 'f1']);
  });

  it('does nothing when un-starring a recipe that was never starred', async () => {
    const { db, calls } = fakeDb(null);
    await setFavorite(db, viewer, 'r1', false);
    expect(calls).toHaveLength(0);
  });
});

describe('setFavorite double taps', () => {
  it('a fast double tap on the star makes one favorite row', async () => {
    // A fake that sees its own inserts, as the local database does.
    const calls: Call[] = [];
    let inserted = false;
    const db = {
      execute: async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        if (sql.startsWith('insert into favorites')) inserted = true;
        return { rowsAffected: 1 } as never;
      },
      // The read sees the table as it was when asked, then takes a moment.
      getOptional: async () => {
        const seen = inserted;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return (seen ? { id: 'f1' } : null) as never;
      },
    };
    await Promise.all([
      setFavorite(db, member, 'recipe-1', true),
      setFavorite(db, member, 'recipe-1', true),
    ]);
    expect(calls.filter((c) => c.sql.startsWith('insert into favorites'))).toHaveLength(1);
  });
});
