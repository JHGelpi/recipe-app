import { describe, expect, it, vi } from 'vitest';
import { saveSetting } from './repository';

function fakeDb(existing: boolean) {
  const calls: [string, unknown[]][] = [];
  const tx = {
    getOptional: vi.fn(async () => (existing ? { id: 'ann' } : null)),
    execute: vi.fn(async (sql: string, params: unknown[]) => void calls.push([sql, params])),
  };
  const db = { writeTransaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) };
  return { calls, db: db as unknown as Parameters<typeof saveSetting>[0] };
}

describe('saving a setting (ADR-0031)', () => {
  it('creates the person’s row the first time, with the other setting’s current value', async () => {
    const { calls, db } = fakeDb(false);
    await saveSetting(db, 'ann', 'units', 'metric', { units: 'as_written', appearance: 'dark' });
    expect(calls).toEqual([
      [
        'insert into person_settings (id, user_id, units, appearance) values (?, ?, ?, ?)',
        ['ann', 'ann', 'metric', 'dark'],
      ],
    ]);
  });

  it('then changes only that setting, so two devices each win for their own (FR-30)', async () => {
    const { calls, db } = fakeDb(true);
    await saveSetting(db, 'ann', 'appearance', 'light', { units: 'us', appearance: 'dark' });
    expect(calls).toEqual([
      ['update person_settings set appearance = ? where id = ?', ['light', 'ann']],
    ]);
  });
});
