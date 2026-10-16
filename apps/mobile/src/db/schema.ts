import { column, Schema, Table } from '@powersync/web';

// PowerSync adds the `id` column itself. Timestamps are ISO strings.
const recipes = new Table(
  {
    household_id: column.text,
    title: column.text,
    created_at: column.text,
    updated_at: column.text,
    updated_by: column.text,
    deleted_at: column.text,
  },
  { indexes: { household: ['household_id'] } },
);

export const AppSchema = new Schema({ recipes });

export type Database = (typeof AppSchema)['types'];
export type RecipeRow = Database['recipes'];
