import type { AbstractPowerSyncDatabase } from '@powersync/web';
import { recipeTitleSchema } from '@recipe-app/domain';
import { canWrite, type Claims } from '../session/claims';

export type RecipeListItem = { id: string; title: string };

export const LIST_RECIPES_SQL =
  'select id, title from recipes where deleted_at is null order by title collate nocase, id';

/**
 * Writes to the local database only. PowerSync queues the row for upload.
 * created_at, updated_at, and updated_by are set by the server.
 */
export async function createRecipe(
  db: Pick<AbstractPowerSyncDatabase, 'execute'>,
  claims: Claims,
  title: string,
): Promise<string> {
  if (!canWrite(claims.role)) throw new Error('Viewers cannot add recipes');
  const cleanTitle = recipeTitleSchema.parse(title);
  const id = crypto.randomUUID();
  await db.execute('insert into recipes (id, household_id, title) values (?, ?, ?)', [
    id,
    claims.householdId,
    cleanTitle,
  ]);
  return id;
}
