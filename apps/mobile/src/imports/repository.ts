import type { AbstractPowerSyncDatabase } from '@powersync/web';
import { PHOTO_LIMITS } from '@recipe-app/domain';
import { INSERT_PHOTO_SQL, type PhotoFile, type PhotoSaver } from '../photos/repository';
import type { RecipeValues } from '../recipes/form';
import { createRecipe } from '../recipes/repository';
import type { RecipeSource } from '../recipes/rows';
import { canWrite, type Claims } from '../session/claims';
import type { ImportSource } from './form';
import type { ImportRecord } from './rows';

type Db = Pick<AbstractPowerSyncDatabase, 'execute' | 'getOptional'>;
type TxDb = Db & { writeTransaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> };

// Photo imports carry their page counts. attachments.state 0 is
// QUEUED_UPLOAD: a page this phone still has to send.
const IMPORT_COLUMNS = `i.*,
  (select count(*) from photos p
     where p.import_id = i.id and p.kind = 'page' and p.deleted_at is null) as pages,
  (select count(*) from photos p
     where p.import_id = i.id and p.kind = 'page' and p.deleted_at is null
       and p.uploaded_at is not null) as uploaded,
  (select count(*) from photos p join attachments a on a.id = p.id
     where p.import_id = i.id and p.deleted_at is null and a.state = 0) as local_pending,
  (select p.id from photos p
     where p.import_id = i.id and p.kind = 'page' and p.deleted_at is null
     order by p.position limit 1) as first_page`;

export const IMPORTS_SQL = `select ${IMPORT_COLUMNS} from imports i
  where i.deleted_at is null order by i.created_at desc`;
export const IMPORT_SQL = `select ${IMPORT_COLUMNS} from imports i
  where i.id = ? and i.deleted_at is null`;
export const READY_COUNT_SQL =
  "select count(*) as n from imports where deleted_at is null and status = 'ready'";
export const PAGES_SQL =
  "select id, position from photos where import_id = ? and kind = 'page' and deleted_at is null order by position";

// A photo import is sent for reading only once the server has every page.
export const KICK_SQL = `select i.id, i.status, i.parse_started_at from imports i
  where i.deleted_at is null and i.status in ('pending', 'parsing')
    and (i.source_type <> 'photo' or not exists (
      select 1 from photos p
      where p.import_id = i.id and p.kind = 'page' and p.deleted_at is null
        and p.uploaded_at is null))`;

function requireWriter(claims: Claims): void {
  if (!canWrite(claims.role)) throw new Error('Viewers cannot import recipes');
}

/** FR-29: written locally first; read by the server once uploaded. */
export async function createImport(db: Db, claims: Claims, source: ImportSource): Promise<string> {
  requireWriter(claims);
  const id = crypto.randomUUID();
  await db.execute(
    `insert into imports (id, household_id, source_type, source_text, source_url, status, created_at)
       values (?, ?, ?, ?, ?, 'pending', ?)`,
    [
      id,
      claims.householdId,
      source.type,
      source.type === 'text' ? source.text : null,
      source.type === 'url' ? source.url : null,
      new Date().toISOString(),
    ],
  );
  return id;
}

/** Dismissing a photo import releases its pages; the purge removes them after 30 days. */
export async function dismissImport(db: TxDb, claims: Claims, id: string): Promise<void> {
  requireWriter(claims);
  const now = new Date().toISOString();
  await db.writeTransaction(async (tx) => {
    await tx.execute(
      'update photos set deleted_at = ? where import_id = ? and deleted_at is null',
      [now, id],
    );
    await tx.execute('update imports set deleted_at = ? where id = ?', [now, id]);
  });
}

/** FR-7, FR-29: the import, then each page with its file, kept here until uploaded. */
export async function createPhotoImport(
  db: TxDb,
  saver: PhotoSaver,
  claims: Claims,
  pages: PhotoFile[],
): Promise<string> {
  requireWriter(claims);
  if (pages.length < 1 || pages.length > PHOTO_LIMITS.pages) {
    throw new Error('A photo import has 1 to 8 pages');
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  // The import goes first: the server checks each page's import exists.
  await db.execute(
    `insert into imports (id, household_id, source_type, status, created_at)
       values (?, ?, 'photo', 'pending', ?)`,
    [id, claims.householdId, now],
  );
  try {
    for (const [index, page] of pages.entries()) {
      const photoId = crypto.randomUUID();
      await saver.save(photoId, await page.blob.arrayBuffer(), (tx) =>
        tx
          .execute(INSERT_PHOTO_SQL, [
            photoId,
            claims.householdId,
            'page',
            id,
            index + 1,
            null,
            page.blob.size,
            page.width,
            page.height,
            now,
          ])
          .then(() => undefined),
      );
    }
  } catch (error) {
    await dismissImport(db, claims, id);
    throw error;
  }
  return id;
}

/** FR-12, NFR-13: the original kept on the recipe. */
export function sourceOf(record: ImportRecord): RecipeSource {
  return {
    source_url: record.source_type === 'url' ? record.source_url : null,
    source_author: record.draft?.author ?? null,
    source_text: record.source_type === 'text' ? record.source_text : null,
  };
}

/** Saves the reviewed recipe and marks the import saved, both or neither. */
export async function saveImportedRecipe(
  db: TxDb,
  claims: Claims,
  record: ImportRecord,
  values: RecipeValues,
  dishPhotoId: string | null = null,
): Promise<string> {
  requireWriter(claims);
  return db.writeTransaction(async (tx) => {
    const recipeId = await createRecipe(tx, claims, values, sourceOf(record), dishPhotoId);
    // FR-12: the pages stay as the recipe's originals.
    await tx.execute('update photos set recipe_id = ? where import_id = ? and deleted_at is null', [
      recipeId,
      record.id,
    ]);
    await tx.execute('update imports set recipe_id = ?, deleted_at = ? where id = ?', [
      recipeId,
      new Date().toISOString(),
      record.id,
    ]);
    return recipeId;
  });
}
