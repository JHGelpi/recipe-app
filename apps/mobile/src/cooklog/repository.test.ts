import { describe, expect, it } from 'vitest';
import type { PhotoTx } from '../photos/repository';
import {
  addEntryPhotos,
  freePositions,
  logCooked,
  restoreEntry,
  setCookedOn,
  setEntryNotes,
  trashEntry,
} from './repository';

type Call = { sql: string; params: unknown[] };

function fakeDb(taken: number[] = []) {
  const calls: Call[] = [];
  return {
    calls,
    db: {
      execute: async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        return { rowsAffected: 1 } as never;
      },
      getOptional: async () => null as never,
      getAll: async <T>() => taken.map((position) => ({ position })) as T[],
    },
  };
}

function fakeSaver(calls: Call[]) {
  return {
    saved: [] as string[],
    async save(id: string, _data: ArrayBuffer, write: (tx: PhotoTx) => Promise<void>) {
      this.saved.push(id);
      await write({
        execute: async (sql: string, params: unknown[] = []) => {
          calls.push({ sql, params });
        },
      });
    },
  };
}

const member = { userId: 'u1', householdId: 'h1', role: 'member' as const };
const viewer = { ...member, role: 'viewer' as const };
const file = { blob: new Blob(['jpeg']), width: 4, height: 3 };

describe('cook log writes (FR-37–FR-39)', () => {
  it('logs today in the phone’s own calendar, for the recipe and the cook', async () => {
    const { db, calls } = fakeDb();
    const now = new Date(2026, 9, 22, 23, 50);
    const id = await logCooked(db, member, { id: 'r1', title: 'Soup' }, now);
    expect(calls[0]?.sql).toMatch(/^insert into cook_logs/);
    expect(calls[0]?.params).toEqual([
      id,
      'h1',
      'r1',
      'Soup',
      '2026-10-22',
      'u1',
      now.toISOString(),
    ]);
  });

  it('changes the day and notes, stores blank notes as none, and trashes and restores', async () => {
    const { db, calls } = fakeDb();
    await setCookedOn(db, member, 'e1', '2026-10-21');
    await setEntryNotes(db, member, 'e1', 'Kids loved it');
    await setEntryNotes(db, member, 'e1', '   ');
    await trashEntry(db, member, 'e1');
    await restoreEntry(db, member, 'e1');
    expect(calls.map((c) => c.params)).toEqual([
      ['2026-10-21', 'e1'],
      ['Kids loved it', 'e1'],
      [null, 'e1'],
      [expect.any(String), 'e1'],
      [null, 'e1'],
    ]);
  });

  it('refuses every write for a viewer (rule 4)', async () => {
    const { db, calls } = fakeDb();
    await expect(logCooked(db, viewer, { id: 'r1', title: 'Soup' })).rejects.toThrow();
    await expect(setEntryNotes(db, viewer, 'e1', 'x')).rejects.toThrow();
    await expect(trashEntry(db, viewer, 'e1')).rejects.toThrow();
    await expect(addEntryPhotos(db, fakeSaver(calls), viewer, 'e1', [file])).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it('adds photos into free places, each in one insert that names the entry, and stops at 8', async () => {
    const { db, calls } = fakeDb([1, 2, 4, 5, 6, 7]);
    const saver = fakeSaver(calls);
    expect(await addEntryPhotos(db, saver, member, 'e1', [file, file, file])).toBe(2);
    expect(saver.saved).toHaveLength(2);
    expect(calls.map((c) => [c.params[2], c.params[3]])).toEqual([
      ['e1', 3],
      ['e1', 8],
    ]);
    expect(calls.every((c) => /^insert into photos/.test(c.sql) && c.sql.includes("'cook'"))).toBe(
      true,
    );
  });

  it('freePositions lists unused places 1–8 in order', () => {
    expect(freePositions([])).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(freePositions([2, 8])).toEqual([1, 3, 4, 5, 6, 7]);
  });
});
