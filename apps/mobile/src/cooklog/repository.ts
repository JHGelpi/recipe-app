import { COOK_LOG_LIMITS, localDay } from '@recipe-app/domain';
import type { AbstractPowerSyncDatabase } from '@powersync/web';
import type { PhotoFile, PhotoSaver } from '../photos/repository';
import { canWrite, type Claims } from '../session/claims';

type Db = Pick<AbstractPowerSyncDatabase, 'execute' | 'getOptional'>;

/** FR-40: the diary, newest first; the live recipe title when it is still here. */
export const DIARY_SQL = `select c.id, c.recipe_id, c.cooked_on, c.cooked_by, c.notes,
    coalesce(r.title, c.recipe_title) as title,
    (select p.id from photos p where p.cook_log_id = c.id and p.deleted_at is null
     order by p.position, p.created_at limit 1) as photo_id
  from cook_logs c left join recipes r on r.id = c.recipe_id
  where c.deleted_at is null and (? is null or c.recipe_id = ?)
  order by c.cooked_on desc, c.created_at desc`;

export const ENTRY_SQL = `select c.*, coalesce(r.title, c.recipe_title) as title,
    r.deleted_at is null and r.id is not null as recipe_live
  from cook_logs c left join recipes r on r.id = c.recipe_id where c.id = ?`;

export const ENTRY_PHOTOS_SQL = `select id from photos
  where cook_log_id = ? and kind = 'cook' and deleted_at is null order by position, created_at`;

/** FR-41: one recipe's live entries, for "Cooked 4 times · last on Oct 22". */
export const RECIPE_HISTORY_SQL =
  'select cooked_on from cook_logs where recipe_id = ? and deleted_at is null';

export const TRASHED_ENTRIES_SQL = `select id, recipe_title as title, cooked_on, deleted_at
  from cook_logs where deleted_at is not null`;

export const MEMBER_EMAILS_SQL = 'select user_id, email from memberships';

function requireWriter(claims: Claims): void {
  if (!canWrite(claims.role)) throw new Error('Viewers cannot change the cook diary');
}

/**
 * FR-37: one tap logs today's meal. Written locally; PowerSync uploads it.
 * cooked_by is set here only for display: the server stamps the real one.
 */
export async function logCooked(
  db: Db,
  claims: Claims,
  recipe: { id: string; title: string },
  now = new Date(),
): Promise<string> {
  requireWriter(claims);
  const id = crypto.randomUUID();
  await db.execute(
    `insert into cook_logs (id, household_id, recipe_id, recipe_title, cooked_on, cooked_by, created_at)
     values (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      claims.householdId,
      recipe.id,
      recipe.title,
      localDay(now),
      claims.userId,
      now.toISOString(),
    ],
  );
  return id;
}

export async function setCookedOn(db: Db, claims: Claims, id: string, day: string): Promise<void> {
  requireWriter(claims);
  await db.execute('update cook_logs set cooked_on = ? where id = ?', [day, id]);
}

/** FR-38: blank notes are stored as none. */
export async function setEntryNotes(
  db: Db,
  claims: Claims,
  id: string,
  notes: string,
): Promise<void> {
  requireWriter(claims);
  await db.execute('update cook_logs set notes = ? where id = ?', [
    notes.trim() ? notes : null,
    id,
  ]);
}

/** FR-18: an entry goes to the Trash; its photos stay with it. */
export async function trashEntry(db: Db, claims: Claims, id: string): Promise<void> {
  requireWriter(claims);
  await db.execute('update cook_logs set deleted_at = ? where id = ?', [
    new Date().toISOString(),
    id,
  ]);
}

export async function restoreEntry(db: Db, claims: Claims, id: string): Promise<void> {
  requireWriter(claims);
  await db.execute('update cook_logs set deleted_at = ? where id = ?', [null, id]);
}

// One insert carrying cook_log_id: the server refuses a cook photo without it.
const INSERT_COOK_PHOTO_SQL = `insert into photos (id, household_id, kind, cook_log_id, position,
     media_type, bytes, width, height, created_at)
     values (?, ?, 'cook', ?, ?, 'image/jpeg', ?, ?, ?, ?)`;

/** Free positions 1–8, lowest first, so a removed photo's place can be reused. */
export function freePositions(taken: number[]): number[] {
  const used = new Set(taken);
  return Array.from({ length: COOK_LOG_LIMITS.photos }, (_, i) => i + 1).filter(
    (p) => !used.has(p),
  );
}

/**
 * FR-39: adds photos to an entry, up to COOK_LOG_LIMITS.photos. Each file and
 * its row are saved together (photos/queue.ts). Returns how many were added.
 */
export async function addEntryPhotos(
  db: Pick<AbstractPowerSyncDatabase, 'getAll'>,
  saver: PhotoSaver,
  claims: Claims,
  entryId: string,
  files: PhotoFile[],
): Promise<number> {
  requireWriter(claims);
  const rows = await db.getAll<{ position: number }>(
    "select position from photos where cook_log_id = ? and kind = 'cook' and deleted_at is null",
    [entryId],
  );
  const positions = freePositions(rows.map((row) => Number(row.position)));
  let added = 0;
  for (const [index, file] of files.entries()) {
    const position = positions[index];
    if (position === undefined) break;
    const id = crypto.randomUUID();
    await saver.save(id, await file.blob.arrayBuffer(), async (tx) => {
      await tx.execute(INSERT_COOK_PHOTO_SQL, [
        id,
        claims.householdId,
        entryId,
        position,
        file.blob.size,
        file.width,
        file.height,
        new Date().toISOString(),
      ]);
    });
    added += 1;
  }
  return added;
}

export async function removeEntryPhoto(db: Db, claims: Claims, photoId: string): Promise<void> {
  requireWriter(claims);
  await db.execute("update photos set deleted_at = ? where id = ? and kind = 'cook'", [
    new Date().toISOString(),
    photoId,
  ]);
}
