import type { AbstractPowerSyncDatabase } from '@powersync/web';
import { canWrite, type Claims } from '../session/claims';
import type { RecipeValues } from './form';
import { NO_SOURCE, type RecipeSource } from './rows';

type Db = Pick<AbstractPowerSyncDatabase, 'execute' | 'getOptional'>;

// The list reads recipes and favorites separately, so a star tap does not
// re-read every recipe or rebuild the search index.
export const LIST_RECIPES_SQL =
  'select id, title, tags, ingredients, photo_id, prep_minutes, cook_minutes from recipes where deleted_at is null';

// Only the signed-in user's favorites are on this device (user_favorites stream).
export const STARRED_IDS_SQL =
  'select recipe_id from favorites where user_id = ? and deleted_at is null';

export const RECIPE_SQL = 'select * from recipes where id = ?';
export const STARRED_SQL =
  'select id from favorites where recipe_id = ? and user_id = ? and deleted_at is null';
export const TRASH_SQL = 'select id, title, deleted_at from recipes where deleted_at is not null';
/** FR-12: a photo-import recipe's original pages, in order. */
export const RECIPE_PAGES_SQL =
  "select id from photos where recipe_id = ? and kind = 'page' and deleted_at is null order by position";
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
 * created_at, updated_at, and updated_by are set by the server. `source` is
 * set only by an import (FR-12); the editor never changes it.
 */
export async function createRecipe(
  db: Db,
  claims: Claims,
  values: RecipeValues,
  source: RecipeSource = NO_SOURCE,
  photoId: string | null = null,
): Promise<string> {
  requireWriter(claims);
  const id = crypto.randomUUID();
  await db.execute(
    `insert into recipes (id, household_id, title, servings, prep_minutes, cook_minutes,
       ingredients, steps, tags, notes, source_url, source_author, source_text, photo_id)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      claims.householdId,
      ...columns(values),
      source.source_url,
      source.source_author,
      source.source_text,
      photoId,
    ],
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
