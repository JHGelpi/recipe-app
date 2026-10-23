import { describe, expect, it } from 'vitest';
import { setRating } from './repository';

type Call = { sql: string; params: unknown[] };
type Existing = { id: string; stars: number; deleted_at: string | null } | null;

/** A local database holding at most one rating row, which writes update. */
function fakeDb(existing: Existing = null) {
  const calls: Call[] = [];
  let row = existing;
  return {
    calls,
    db: {
      execute: async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        if (sql.startsWith('insert'))
          row = { id: 'new', stars: params[4] as number, deleted_at: null };
        if (sql.startsWith('update recipe_ratings set stars') && row) {
          row = { ...row, stars: params[0] as number, deleted_at: null };
        }
        if (sql.startsWith('update recipe_ratings set deleted_at') && row) {
          row = { ...row, deleted_at: params[0] as string };
        }
        return { rowsAffected: 1 } as never;
      },
      getOptional: async () => row as never,
    },
  };
}

const viewer = { userId: 'u1', householdId: 'h1', role: 'viewer' as const };

describe('setRating (FR-44)', () => {
  it('a viewer rates: the first rating inserts their own row', async () => {
    const { db, calls } = fakeDb();
    await setRating(db, viewer, 'r1', 4);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toMatch(/^insert into recipe_ratings/);
    expect(calls[0]?.params.slice(1)).toEqual(['h1', 'u1', 'r1', 4]);
  });

  it('changing a rating updates the same row', async () => {
    const { db, calls } = fakeDb({ id: 'x', stars: 4, deleted_at: null });
    await setRating(db, viewer, 'r1', 2);
    expect(calls).toEqual([
      {
        sql: 'update recipe_ratings set stars = ?, deleted_at = ? where id = ?',
        params: [2, null, 'x'],
      },
    ]);
  });

  it('clearing sets deleted_at; rating again revives the row', async () => {
    const { db, calls } = fakeDb({ id: 'x', stars: 3, deleted_at: null });
    await setRating(db, viewer, 'r1', null);
    expect(calls[0]?.sql).toBe('update recipe_ratings set deleted_at = ? where id = ?');
    await setRating(db, viewer, 'r1', 3);
    expect(calls[1]).toEqual({
      sql: 'update recipe_ratings set stars = ?, deleted_at = ? where id = ?',
      params: [3, null, 'x'],
    });
  });

  it('writes nothing when nothing changes', async () => {
    const { db, calls } = fakeDb({ id: 'x', stars: 3, deleted_at: null });
    await setRating(db, viewer, 'r1', 3);
    const cleared = fakeDb({ id: 'y', stars: 3, deleted_at: '2026-11-01T00:00:00.000Z' });
    await setRating(cleared.db, viewer, 'r1', null);
    await setRating(fakeDb().db, viewer, 'r1', null);
    expect([...calls, ...cleared.calls]).toEqual([]);
  });

  it('a fast double tap makes one row', async () => {
    const { db, calls } = fakeDb();
    await Promise.all([setRating(db, viewer, 'r2', 5), setRating(db, viewer, 'r2', 5)]);
    expect(calls.filter((call) => call.sql.startsWith('insert'))).toHaveLength(1);
  });
});
