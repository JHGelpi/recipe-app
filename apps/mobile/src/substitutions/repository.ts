import type { AbstractPowerSyncDatabase } from '@powersync/web';
import { RECIPE_LIMITS } from '@recipe-app/domain';
import { canWrite, type Claims } from '../session/claims';

type Db = Pick<AbstractPowerSyncDatabase, 'execute' | 'getOptional'>;

export const SUBSTITUTIONS_SQL =
  'select * from substitutions where recipe_id = ? and deleted_at is null';

/** FR-25: the chosen substitute kept as a line in the recipe's notes. */
export async function addSubstitutionToNotes(
  db: Db,
  claims: Claims,
  recipeId: string,
  line: string,
): Promise<'added' | 'already' | 'full' | 'missing'> {
  if (!canWrite(claims.role)) throw new Error('Viewers cannot change recipes');
  const row = await db.getOptional<{ notes: string | null }>(
    'select notes from recipes where id = ?',
    [recipeId],
  );
  if (!row) return 'missing';
  const current = (row.notes ?? '').trimEnd();
  // A second tap on Add to notes must not add the line again.
  if (current.split('\n').some((existing) => existing.trim() === line.trim())) return 'already';
  const notes = current ? `${current}\n${line}` : line;
  if (notes.length > RECIPE_LIMITS.notes) return 'full';
  await db.execute('update recipes set notes = ? where id = ?', [notes, recipeId]);
  return 'added';
}
