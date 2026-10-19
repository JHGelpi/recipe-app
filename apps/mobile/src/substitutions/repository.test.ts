import { describe, expect, it } from 'vitest';
import { addSubstitutionToNotes } from './repository';

function fakeDb(notes: string | null) {
  const calls: { sql: string; params: unknown[] }[] = [];
  return {
    calls,
    db: {
      execute: async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        return { rowsAffected: 1 } as never;
      },
      getOptional: async () => (notes === null ? null : ({ notes } as never)),
    },
  };
}
const member = { userId: 'u1', householdId: 'h1', role: 'member' as const };

describe('addSubstitutionToNotes (FR-25)', () => {
  it('appends the line on a new line, or as the first note', async () => {
    const some = fakeDb('Bake on the middle rack.');
    expect(await addSubstitutionToNotes(some.db, member, 'r1', 'Instead of X: Y')).toBe('added');
    expect(some.calls[0]?.params).toEqual(['Bake on the middle rack.\nInstead of X: Y', 'r1']);
    const none = fakeDb('');
    await addSubstitutionToNotes(none.db, member, 'r1', 'Instead of X: Y');
    expect(none.calls[0]?.params).toEqual(['Instead of X: Y', 'r1']);
  });

  it('refuses past the notes limit (Review Focus 5), a missing recipe, and viewers', async () => {
    const full = fakeDb('x'.repeat(9_990));
    expect(
      await addSubstitutionToNotes(full.db, member, 'r1', 'Instead of X: Y, a long line'),
    ).toBe('full');
    expect(full.calls).toEqual([]);
    expect(await addSubstitutionToNotes(fakeDb(null).db, member, 'r1', 'x')).toBe('missing');
    await expect(
      addSubstitutionToNotes(fakeDb('').db, { ...member, role: 'viewer' }, 'r1', 'x'),
    ).rejects.toThrow('Viewers');
  });
});

describe('adding twice (bug batch spec §2)', () => {
  it('adding the same line twice adds it once', async () => {
    const line = 'Instead of 1 egg: 1 tbsp flax — Denser';
    const { db, calls } = fakeDb(`Old note\n${line}`);
    expect(await addSubstitutionToNotes(db, member, 'r1', line)).toBe('already');
    expect(calls.filter((c) => c.sql.startsWith('update'))).toHaveLength(0);
  });
});
