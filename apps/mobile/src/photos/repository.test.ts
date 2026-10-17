import { describe, expect, it, vi } from 'vitest';
import type { Claims } from '../session/claims';
import { createPhotoImport, dismissImport } from '../imports/repository';
import { removeDishPhoto, setDishPhoto, type PhotoSaver } from './repository';

const member: Claims = { userId: 'u1', householdId: 'h1', role: 'member' };
const viewer: Claims = { ...member, role: 'viewer' };

function fakeDb() {
  const calls: { sql: string; params: unknown[] }[] = [];
  const execute = async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    return { rowsAffected: 1 } as never;
  };
  const tx = { execute, getOptional: async () => null as never };
  const db = { ...tx, writeTransaction: async <T>(fn: (t: typeof tx) => Promise<T>) => fn(tx) };
  const saved: { id: string; bytes: number }[] = [];
  const saver: PhotoSaver = {
    async save(id, data, write) {
      saved.push({ id, bytes: data.byteLength });
      await write(tx);
    },
  };
  return { db, calls, saved, saver };
}

const file = (size: number) => ({ blob: new Blob([new Uint8Array(size)]), width: 40, height: 30 });

describe('createPhotoImport', () => {
  it('writes the import first, then each page in order with its file', async () => {
    const { db, calls, saved, saver } = fakeDb();
    const id = await createPhotoImport(db, saver, member, [file(10), file(20)]);
    expect(calls[0]?.sql).toContain('insert into imports');
    expect(calls[0]?.params).toEqual([id, 'h1', expect.any(String)]);
    const pages = calls.filter((call) => call.sql.includes('insert into photos'));
    expect(pages.map((call) => call.params.slice(2, 5))).toEqual([
      ['page', id, 1],
      ['page', id, 2],
    ]);
    expect(saved.map((entry) => entry.bytes)).toEqual([10, 20]);
    expect(pages.map((call) => call.params[0])).toEqual(saved.map((entry) => entry.id));
  });

  it('refuses a viewer, no pages and more than 8', async () => {
    const { db, saver } = fakeDb();
    await expect(createPhotoImport(db, saver, viewer, [file(1)])).rejects.toThrow('Viewers');
    await expect(createPhotoImport(db, saver, member, [])).rejects.toThrow('1 to 8');
    await expect(
      createPhotoImport(
        db,
        saver,
        member,
        Array.from({ length: 9 }, () => file(1)),
      ),
    ).rejects.toThrow('1 to 8');
  });

  it('dismisses the import when a page cannot be saved', async () => {
    const { db, calls } = fakeDb();
    const failing: PhotoSaver = { save: vi.fn().mockRejectedValue(new Error('disk full')) };
    await expect(createPhotoImport(db, failing, member, [file(1)])).rejects.toThrow('disk full');
    expect(calls.some((call) => call.sql.startsWith('update imports set deleted_at'))).toBe(true);
  });
});

describe('dismissImport', () => {
  it('releases the import’s pages with it', async () => {
    const { db, calls } = fakeDb();
    await dismissImport(db, member, 'i1');
    expect(calls.map((call) => call.sql)).toEqual([
      'update photos set deleted_at = ? where import_id = ? and deleted_at is null',
      'update imports set deleted_at = ? where id = ?',
    ]);
  });
});

describe('dish photos', () => {
  it('adds a dish photo, releasing the previous dish photo but never a page', async () => {
    const { db, calls, saver } = fakeDb();
    const id = await setDishPhoto(db, saver, member, 'r1', file(5));
    expect(calls.map((call) => call.sql)).toEqual([
      expect.stringContaining('insert into photos'),
      "update photos set deleted_at = ? where id = (select photo_id from recipes where id = ?) and kind = 'dish' and deleted_at is null",
      'update recipes set photo_id = ? where id = ?',
    ]);
    expect(calls[0]?.params.slice(0, 6)).toEqual([id, 'h1', 'dish', null, null, 'r1']);
    expect(calls[2]?.params).toEqual([id, 'r1']);
  });

  it('removes the dish photo', async () => {
    const { db, calls } = fakeDb();
    await removeDishPhoto(db, member, 'r1');
    expect(calls.map((call) => call.sql)).toEqual([
      "update photos set deleted_at = ? where id = (select photo_id from recipes where id = ?) and kind = 'dish' and deleted_at is null",
      'update recipes set photo_id = null where id = ?',
    ]);
  });

  it('refuses viewers', async () => {
    const { db, saver } = fakeDb();
    await expect(setDishPhoto(db, saver, viewer, 'r1', file(1))).rejects.toThrow('Viewers');
    await expect(removeDishPhoto(db, viewer, 'r1')).rejects.toThrow('Viewers');
  });
});
