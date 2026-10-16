import type { AbstractPowerSyncDatabase } from '@powersync/web';
import { canWrite, type Claims } from '../session/claims';
import type { RecipeValues } from './form';

type Db = Pick<AbstractPowerSyncDatabase, 'execute' | 'getOptional'>;

// Live lists. The current user's id is the first parameter of the favorites
// joins; only that user's favorites are on this device anyway.
export const LIST_RECIPES_SQL = `
  select r.id, r.title, r.tags, f.id is not null as starred
  from recipes r
  left join favorites f on f.recipe_id = r.id and f.user_id = ? and f.deleted_at is null
  where r.deleted_at is null
  order by r.title collate nocase, r.id`;

export const LIST_FAVORITES_SQL = `
  select r.id, r.title, r.tags, 1 as starred
  from recipes r
  join favorites f on f.recipe_id = r.id and f.user_id = ? and f.deleted_at is null
  where r.deleted_at is null
  order by r.title collate nocase, r.id`;

export const RECIPE_SQL = 'select * from recipes where id = ?';
export const STARRED_SQL =
  'select id from favorites where recipe_id = ? and user_id = ? and deleted_at is null';
export const TRASH_SQL = 'select id, title, deleted_at from recipes where deleted_at is not null';
export const TAGS_SQL = 'select tags from recipes where deleted_at is null';

function requireWriter(claims: Claims): void {
  if (!canWrite(claims.role)) throw new Error('Viewers cannot change recipes');
}

function columns(values: RecipeValues): unknown[] {
  return [
    values.title,
    values.servings,
    values.prep_minutes,
    values.cook_minutes,
    JSON.stringify(values.ingredients),
    JSON.stringify(values.steps),
    JSON.stringify(values.tags),
    values.notes,
  ];
}

/**
 * Writes to the local database only. PowerSync queues the row for upload.
 * created_at, updated_at, and updated_by are set by the server.
 */
export async function createRecipe(db: Db, claims: Claims, values: RecipeValues): Promise<string> {
  requireWriter(claims);
  const id = crypto.randomUUID();
  await db.execute(
    `insert into recipes (id, household_id, title, servings, prep_minutes, cook_minutes,
       ingredients, steps, tags, notes) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, claims.householdId, ...columns(values)],
  );
  return id;
}

/** Saves the whole recipe; never changes whether it is in the Trash. */
export async function updateRecipe(
  db: Db,
  claims: Claims,
  id: string,
  values: RecipeValues,
): Promise<void> {
  requireWriter(claims);
  await db.execute(
    `update recipes set title = ?, servings = ?, prep_minutes = ?, cook_minutes = ?,
       ingredients = ?, steps = ?, tags = ?, notes = ? where id = ?`,
    [...columns(values), id],
  );
}

export async function trashRecipe(db: Db, claims: Claims, id: string): Promise<void> {
  requireWriter(claims);
  await db.execute('update recipes set deleted_at = ? where id = ?', [
    new Date().toISOString(),
    id,
  ]);
}

export async function restoreRecipe(db: Db, claims: Claims, id: string): Promise<void> {
  requireWriter(claims);
  await db.execute('update recipes set deleted_at = ? where id = ?', [null, id]);
}

/** Any role may star: a favorite changes only the user's own list. */
export async function setFavorite(
  db: Db,
  claims: Claims,
  recipeId: string,
  starred: boolean,
): Promise<void> {
  const existing = await db.getOptional<{ id: string }>(
    'select id from favorites where user_id = ? and recipe_id = ?',
    [claims.userId, recipeId],
  );
  if (existing) {
    await db.execute('update favorites set deleted_at = ? where id = ?', [
      starred ? null : new Date().toISOString(),
      existing.id,
    ]);
  } else if (starred) {
    await db.execute(
      'insert into favorites (id, household_id, user_id, recipe_id) values (?, ?, ?, ?)',
      [crypto.randomUUID(), claims.householdId, claims.userId, recipeId],
    );
  }
}
