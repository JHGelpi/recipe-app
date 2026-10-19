import { describe, expect, it } from 'vitest';
import type { RecipeValues } from '../recipes/form';
import {
  createImport,
  createPhotoImport,
  dismissImport,
  IMPORTS_SQL,
  saveImportedRecipe,
  sourceOf,
} from './repository';
import { importFromRow } from './rows';

type Call = { sql: string; params: unknown[] };

function fakeDb() {
  const calls: Call[] = [];
  const execute = async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    return { rowsAffected: 1 } as never;
  };
  const tx = { execute, getOptional: async () => null as never };
  return {
    calls,
    db: { ...tx, writeTransaction: async <T>(fn: (t: typeof tx) => Promise<T>) => fn(tx) },
  };
}

const member = { userId: 'u1', householdId: 'h1', role: 'member' as const };
const viewer = { ...member, role: 'viewer' as const };
const values: RecipeValues = {
  title: 'Soup',
  servings: 4,
  prep_minutes: null,
  cook_minutes: null,
  ingredients: [],
  steps: [],
  tags: [],
  notes: '',
};
const ready = importFromRow({
  id: 'i1',
  source_type: 'url',
  source_url: 'https://example.com/soup',
  status: 'ready',
  draft: JSON.stringify({ title: 'Soup', author: 'Jane' }),
})!;

describe('import writes', () => {
  it('creates a pending import in the household', async () => {
    const { db, calls } = fakeDb();
    const id = await createImport(db, member, { type: 'text', text: 'Soup' });
    expect(calls[0]?.sql).toMatch(/^insert into imports/);
    expect(calls[0]?.params.slice(0, 5)).toEqual([id, 'h1', 'text', 'Soup', null]);
  });

  it('refuses viewers', async () => {
    const { db } = fakeDb();
    await expect(createImport(db, viewer, { type: 'url', url: 'https://e.com' })).rejects.toThrow();
    await expect(dismissImport(db, viewer, 'i1')).rejects.toThrow();
    await expect(saveImportedRecipe(db, viewer, ready, values)).rejects.toThrow();
  });

  it('dismisses with deleted_at, releasing any pages', async () => {
    const { db, calls } = fakeDb();
    await dismissImport(db, member, 'i1');
    expect(calls[1]?.sql).toBe('update imports set deleted_at = ? where id = ?');
    expect(calls[1]?.params[1]).toBe('i1');
    expect(calls[0]?.params[1]).toBe('i1');
  });

  it('saves the recipe with its source and marks the import saved, in one transaction', async () => {
    const { db, calls } = fakeDb();
    const recipeId = await saveImportedRecipe(db, member, ready, values);
    expect(calls[0]?.sql).toMatch(/^insert into recipes/);
    expect(calls[0]?.params.slice(-4)).toEqual(['https://example.com/soup', 'Jane', null, null]);
    expect(calls[2]).toEqual({
      sql: 'update imports set recipe_id = ?, deleted_at = ? where id = ?',
      params: [recipeId, expect.any(String), 'i1'],
    });
  });

  it('a text import keeps its text as the source', () => {
    const text = importFromRow({
      id: 'i2',
      source_type: 'text',
      source_text: 'Soup\n- 1 onion',
      status: 'ready',
      draft: '{"title":"Soup"}',
    })!;
    expect(sourceOf(text)).toEqual({
      source_url: null,
      source_author: null,
      source_text: 'Soup\n- 1 onion',
    });
  });
});

describe('photo imports (final review)', () => {
  it("the import row is written in the first page's transaction, never alone", async () => {
    const { db, calls } = fakeDb();
    const tx: { sql: string; page: number }[] = [];
    let page = 0;
    const saver = {
      async save(_id: string, _data: ArrayBuffer, write: (t: never) => Promise<void>) {
        page += 1;
        const current = page;
        await write({
          execute: async (sql: string) => {
            tx.push({ sql, page: current });
            return { rowsAffected: 1 };
          },
        } as never);
      },
    };
    const file = { blob: new Blob([new Uint8Array([1])]), width: 1, height: 1 };
    await createPhotoImport(db as never, saver, member, [file as never, file as never]);
    expect(calls.filter((c) => c.sql.includes('insert into imports'))).toHaveLength(0);
    expect(tx.map((c) => `${c.page}:${c.sql.trim().split(/\s+/).slice(0, 3).join(' ')}`)).toEqual([
      '1:insert into imports',
      '1:insert into photos',
      '2:insert into photos',
    ]);
  });

  it('a refused page is one that never reached the server', () => {
    // Pages that uploaded are archived too (they are not dish photos the queue watches).
    expect(IMPORTS_SQL).toMatch(/a\.state = 4 and p\.uploaded_at is null/);
  });
});
