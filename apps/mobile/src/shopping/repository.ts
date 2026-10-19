import type { AbstractPowerSyncDatabase } from '@powersync/web';
import { SHOPPING_LIMITS, type Aisle, type NewShoppingRow } from '@recipe-app/domain';
import { canWrite, type Claims } from '../session/claims';
import { aisleChoiceId } from './choiceId';

type Db = Pick<AbstractPowerSyncDatabase, 'execute' | 'getOptional'>;

export const SHOPPING_ROWS_SQL = 'select * from shopping_items where deleted_at is null';
export const AISLE_CHOICES_SQL =
  'select item_key, aisle from aisle_choices where deleted_at is null';

function requireWriter(claims: Claims): void {
  if (!canWrite(claims.role)) throw new Error('Viewers cannot change the shopping list');
}
const now = () => new Date().toISOString();
const marks = (ids: string[]) => ids.map(() => '?').join(', ');

/** FR-32, FR-35. "full" past 500 live rows (spec §6), and nothing is written. */
export async function addShoppingRows(
  db: Db,
  claims: Claims,
  rows: NewShoppingRow[],
): Promise<'added' | 'full'> {
  requireWriter(claims);
  const count = await db.getOptional<{ live: number }>(
    'select count(*) as live from shopping_items where deleted_at is null',
  );
  if ((count?.live ?? 0) + rows.length > SHOPPING_LIMITS.rows) return 'full';
  for (const row of rows) {
    await db.execute(
      `insert into shopping_items (id, household_id, item, item_key, quantity, quantity_max, unit, note, aisle, recipe_id, recipe_title)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        crypto.randomUUID(),
        claims.householdId,
        row.item,
        row.item_key,
        row.quantity,
        row.quantity_max,
        row.unit,
        row.note,
        row.aisle,
        row.recipe_id,
        row.recipe_title,
      ],
    );
  }
  return 'added';
}

export async function setTicked(
  db: Db,
  claims: Claims,
  rowIds: string[],
  ticked: boolean,
): Promise<void> {
  requireWriter(claims);
  await db.execute(`update shopping_items set checked_at = ? where id in (${marks(rowIds)})`, [
    ticked ? now() : null,
    ...rowIds,
  ]);
}

export async function removeRows(db: Db, claims: Claims, rowIds: string[]): Promise<void> {
  requireWriter(claims);
  await db.execute(`update shopping_items set deleted_at = ? where id in (${marks(rowIds)})`, [
    now(),
    ...rowIds,
  ]);
}

export async function clearTicked(db: Db, claims: Claims): Promise<void> {
  requireWriter(claims);
  await db.execute(
    'update shopping_items set deleted_at = ? where deleted_at is null and checked_at is not null',
    [now()],
  );
}

export async function clearList(db: Db, claims: Claims): Promise<void> {
  requireWriter(claims);
  await db.execute('update shopping_items set deleted_at = ? where deleted_at is null', [now()]);
}

/** FR-34: the household's own aisle wins from now on, and the list moves at once. */
export async function moveToAisle(
  db: Db,
  claims: Claims,
  itemKey: string,
  aisle: Aisle,
): Promise<void> {
  requireWriter(claims);
  const id = await aisleChoiceId(claims.householdId ?? '', itemKey);
  const existing = await db.getOptional<{ id: string }>(
    'select id from aisle_choices where id = ?',
    [id],
  );
  if (existing) {
    await db.execute('update aisle_choices set aisle = ? where id = ?', [aisle, id]);
  } else {
    await db.execute(
      'insert into aisle_choices (id, household_id, item_key, aisle) values (?, ?, ?, ?)',
      [id, claims.householdId, itemKey, aisle],
    );
  }
  await db.execute(
    'update shopping_items set aisle = ? where item_key = ? and deleted_at is null',
    [aisle, itemKey],
  );
}
