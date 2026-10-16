import { column, Schema, Table } from '@powersync/web';

// PowerSync adds the `id` column itself. Timestamps are ISO strings.
// ingredients, steps and tags hold JSON text (rows.ts parses them).
const recipes = new Table(
  {
    household_id: column.text,
    title: column.text,
    servings: column.integer,
    prep_minutes: column.integer,
    cook_minutes: column.integer,
    ingredients: column.text,
    steps: column.text,
    tags: column.text,
    notes: column.text,
    created_at: column.text,
    updated_at: column.text,
    updated_by: column.text,
    deleted_at: column.text,
  },
  { indexes: { household: ['household_id'] } },
);

// Only the signed-in user's rows sync here (user_favorites stream).
const favorites = new Table(
  {
    household_id: column.text,
    user_id: column.text,
    recipe_id: column.text,
    created_at: column.text,
    updated_at: column.text,
    updated_by: column.text,
    deleted_at: column.text,
  },
  { indexes: { recipe: ['recipe_id'] } },
);

export const AppSchema = new Schema({ recipes, favorites });

export type Database = (typeof AppSchema)['types'];
export type RecipeRow = Database['recipes'];
export type FavoriteRow = Database['favorites'];
