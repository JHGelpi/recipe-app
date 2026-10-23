import type { AbstractPowerSyncDatabase } from '@powersync/web';
import type { Claims } from '../session/claims';

type Db = Pick<AbstractPowerSyncDatabase, 'execute' | 'getOptional'>;

// Only the signed-in user's ratings are on this device (user_ratings stream).
export const MY_RATING_SQL =
  'select stars from recipe_ratings where recipe_id = ? and user_id = ? and deleted_at is null';
// The household's total and count; the server keeps them (household_ratings).
export const RATING_TOTALS_SQL =
  'select stars_total, ratings_count from recipe_rating_totals where id = ?';
// Every recipe's totals for the list (FR-44); never recipe_ratings, which hold
// only your own (ADR-0022).
export const RATING_TOTALS_LIST_SQL =
  'select id, stars_total, ratings_count from recipe_rating_totals';

// One rating change at a time per recipe: a double tap must not insert two rows.
const chains = new Map<string, Promise<void>>();

/**
 * FR-44: any role rates, Viewers too: a rating is the person's own. null
 * clears it. The average changes once the server has counted it.
 */
export function setRating(
  db: Db,
  claims: Claims,
  recipeId: string,
  stars: number | null,
): Promise<void> {
  const key = `${claims.userId}:${recipeId}`;
  const next = (chains.get(key) ?? Promise.resolve())
    .catch(() => undefined)
    .then(() => writeRating(db, claims, recipeId, stars));
  chains.set(key, next);
  return next;
}

async function writeRating(
  db: Db,
  claims: Claims,
  recipeId: string,
  stars: number | null,
): Promise<void> {
  const existing = await db.getOptional<{ id: string; stars: number; deleted_at: string | null }>(
    'select id, stars, deleted_at from recipe_ratings where user_id = ? and recipe_id = ?',
    [claims.userId, recipeId],
  );
  if (existing) {
    if (stars === null) {
      if (existing.deleted_at === null) {
        await db.execute('update recipe_ratings set deleted_at = ? where id = ?', [
          new Date().toISOString(),
          existing.id,
        ]);
      }
    } else if (existing.deleted_at !== null || existing.stars !== stars) {
      await db.execute('update recipe_ratings set stars = ?, deleted_at = ? where id = ?', [
        stars,
        null,
        existing.id,
      ]);
    }
  } else if (stars !== null) {
    await db.execute(
      'insert into recipe_ratings (id, household_id, user_id, recipe_id, stars) values (?, ?, ?, ?, ?)',
      [crypto.randomUUID(), claims.householdId, claims.userId, recipeId, stars],
    );
  }
}
