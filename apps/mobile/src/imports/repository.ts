import type { AbstractPowerSyncDatabase } from '@powersync/web';
import type { RecipeValues } from '../recipes/form';
import { createRecipe } from '../recipes/repository';
import type { RecipeSource } from '../recipes/rows';
import { canWrite, type Claims } from '../session/claims';
import type { ImportSource } from './form';
import type { ImportRecord } from './rows';

type Db = Pick<AbstractPowerSyncDatabase, 'execute' | 'getOptional'>;
type TxDb = Db & { writeTransaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> };

export const IMPORTS_SQL =
  'select * from imports where deleted_at is null order by created_at desc';
export const IMPORT_SQL = 'select * from imports where id = ? and deleted_at is null';
export const READY_COUNT_SQL =
  "select count(*) as n from imports where deleted_at is null and status = 'ready'";
export const KICK_SQL =
  "select id, status, parse_started_at from imports where deleted_at is null and status in ('pending', 'parsing')";

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

export async function dismissImport(db: Db, claims: Claims, id: string): Promise<void> {
  requireWriter(claims);
  await db.execute('update imports set deleted_at = ? where id = ?', [
    new Date().toISOString(),
    id,
  ]);
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
): Promise<string> {
  requireWriter(claims);
  return db.writeTransaction(async (tx) => {
    const recipeId = await createRecipe(tx, claims, values, sourceOf(record));
    await tx.execute('update imports set recipe_id = ?, deleted_at = ? where id = ?', [
      recipeId,
      new Date().toISOString(),
      record.id,
    ]);
    return recipeId;
  });
}
