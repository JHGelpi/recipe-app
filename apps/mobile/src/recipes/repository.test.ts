import { describe, expect, it, vi } from 'vitest';
import type { Claims } from '../session/claims';
import { createRecipe } from './repository';

const member: Claims = { userId: 'user-1', householdId: 'house-1', role: 'member' };

function fakeDb() {
  return { execute: vi.fn().mockResolvedValue({ rowsAffected: 1 }) };
}

describe('createRecipe', () => {
  it('inserts a trimmed title with a new UUID and the session household', async () => {
    const db = fakeDb();
    const id = await createRecipe(db, member, '  Pancakes  ');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(db.execute).toHaveBeenCalledTimes(1);
    const [sql, params] = db.execute.mock.calls[0]!;
    expect(sql).toMatch(/insert into recipes \(id, household_id, title\)/i);
    expect(params).toEqual([id, 'house-1', 'Pancakes']);
  });

  it('never writes server-owned columns', async () => {
    const db = fakeDb();
    await createRecipe(db, member, 'Soup');
    const [sql] = db.execute.mock.calls[0]!;
    expect(sql).not.toMatch(/created_at|updated_at|updated_by/);
  });

  it.each(['', '   ', 'a'.repeat(201)])(
    'rejects the title %j and writes nothing',
    async (title) => {
      const db = fakeDb();
      await expect(createRecipe(db, member, title)).rejects.toThrow();
      expect(db.execute).not.toHaveBeenCalled();
    },
  );

  it('refuses to write for a viewer', async () => {
    const db = fakeDb();
    await expect(createRecipe(db, { ...member, role: 'viewer' }, 'Soup')).rejects.toThrow(
      'Viewers cannot add recipes',
    );
    expect(db.execute).not.toHaveBeenCalled();
  });
});
