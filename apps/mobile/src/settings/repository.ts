import type { PersonSettings } from './cache';

type Tx = {
  getOptional<T>(sql: string, params: unknown[]): Promise<T | null>;
  execute(sql: string, params: unknown[]): Promise<unknown>;
};
type Db = { writeTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> };

const COLUMNS = { units: 'units', appearance: 'appearance' } as const;

/**
 * Saves one setting to the person's row (ADR-0031), creating it with the
 * other setting's current value the first time. Only the changed column is
 * updated, so choices made on two devices each win for their own setting
 * (FR-30).
 */
export async function saveSetting<K extends keyof PersonSettings>(
  db: Db,
  userId: string,
  key: K,
  value: PersonSettings[K],
  current: PersonSettings,
): Promise<void> {
  await db.writeTransaction(async (tx) => {
    const found = await tx.getOptional<{ id: string }>(
      'select id from person_settings where id = ?',
      [userId],
    );
    if (found) {
      await tx.execute(`update person_settings set ${COLUMNS[key]} = ? where id = ?`, [
        value,
        userId,
      ]);
      return;
    }
    const next = { ...current, [key]: value };
    await tx.execute(
      'insert into person_settings (id, user_id, units, appearance) values (?, ?, ?, ?)',
      [userId, userId, next.units, next.appearance],
    );
  });
}
