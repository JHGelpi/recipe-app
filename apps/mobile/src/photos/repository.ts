import type { AbstractPowerSyncDatabase } from '@powersync/web';
import { canWrite, type Claims } from '../session/claims';

/** A photo ready to save: already resized and re-encoded (prepare.ts). */
export type PhotoFile = { blob: Blob; width: number; height: number };
export type PhotoTx = { execute(sql: string, params?: unknown[]): Promise<unknown> };
type Db = Pick<AbstractPowerSyncDatabase, 'execute'> & {
  writeTransaction<T>(fn: (tx: PhotoTx) => Promise<T>): Promise<T>;
};

/**
 * Saves a file on this phone and runs `write` in the same transaction as its
 * queue entry, so a photos row never exists here without its file
 * (queue.ts wraps PowerSync's attachment queue).
 */
export type PhotoSaver = {
  save(id: string, data: ArrayBuffer, write: (tx: PhotoTx) => Promise<void>): Promise<void>;
};

export const INSERT_PHOTO_SQL = `insert into photos (id, household_id, kind, import_id, position, recipe_id,
     media_type, bytes, width, height, created_at)
     values (?, ?, ?, ?, ?, ?, 'image/jpeg', ?, ?, ?, ?)`;

// A recipe's own dish photo goes when replaced; a page shown as the dish
// photo stays, because it is also an original (FR-12).
const RELEASE_DISH_SQL =
  "update photos set deleted_at = ? where id = (select photo_id from recipes where id = ?) and kind = 'dish' and deleted_at is null";

export function requirePhotoWriter(claims: Claims): void {
  if (!canWrite(claims.role)) throw new Error('Viewers cannot change photos');
}

/** FR-15: one dish photo per recipe. */
export async function setDishPhoto(
  db: Db,
  saver: PhotoSaver,
  claims: Claims,
  recipeId: string,
  file: PhotoFile,
): Promise<string> {
  requirePhotoWriter(claims);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await saver.save(id, await file.blob.arrayBuffer(), async (tx) => {
    await tx.execute(INSERT_PHOTO_SQL, [
      id,
      claims.householdId,
      'dish',
      null,
      null,
      recipeId,
      file.blob.size,
      file.width,
      file.height,
      now,
    ]);
    await tx.execute(RELEASE_DISH_SQL, [now, recipeId]);
    await tx.execute('update recipes set photo_id = ? where id = ?', [id, recipeId]);
  });
  return id;
}

export async function removeDishPhoto(db: Db, claims: Claims, recipeId: string): Promise<void> {
  requirePhotoWriter(claims);
  await db.writeTransaction(async (tx) => {
    await tx.execute(RELEASE_DISH_SQL, [new Date().toISOString(), recipeId]);
    await tx.execute('update recipes set photo_id = null where id = ?', [recipeId]);
  });
}
