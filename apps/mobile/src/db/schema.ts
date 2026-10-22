import { AttachmentTable, column, Schema, Table } from '@powersync/web';

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
    source_url: column.text,
    source_author: column.text,
    source_text: column.text,
    photo_id: column.text,
    // FR-43: JSON text, or null.
    nutrition: column.text,
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

// The household's imports that are not dismissed (household_imports stream).
// draft holds JSON text; status, draft and error are written by the server.
const imports = new Table(
  {
    household_id: column.text,
    source_type: column.text,
    source_text: column.text,
    source_url: column.text,
    status: column.text,
    draft: column.text,
    error: column.text,
    parse_started_at: column.text,
    recipe_id: column.text,
    created_at: column.text,
    updated_at: column.text,
    updated_by: column.text,
    deleted_at: column.text,
  },
  { indexes: { household: ['household_id'] } },
);

// The household's photos that are not deleted (household_photos stream).
// The bytes are not here: the attachments table and IndexedDB hold the files
// this phone keeps (src/photos/queue.ts).
const photos = new Table(
  {
    household_id: column.text,
    kind: column.text,
    import_id: column.text,
    position: column.integer,
    recipe_id: column.text,
    cook_log_id: column.text,
    media_type: column.text,
    bytes: column.integer,
    width: column.integer,
    height: column.integer,
    uploaded_at: column.text,
    created_at: column.text,
    updated_at: column.text,
    updated_by: column.text,
    deleted_at: column.text,
  },
  { indexes: { import: ['import_id'], recipe: ['recipe_id'], cook_log: ['cook_log_id'] } },
);

// The household's remembered substitutions (household_substitutions stream).
// Written only by the server; options holds JSON text.
const substitutions = new Table(
  {
    household_id: column.text,
    recipe_id: column.text,
    ingredient_id: column.text,
    ingredient_raw: column.text,
    options: column.text,
    note: column.text,
    created_at: column.text,
    updated_at: column.text,
    updated_by: column.text,
    deleted_at: column.text,
  },
  { indexes: { recipe: ['recipe_id'] } },
);

// The household's members (household_members) and this user's own row
// (my_membership); written only by the server's household functions.
const memberships = new Table(
  {
    household_id: column.text,
    user_id: column.text,
    email: column.text,
    role: column.text,
    created_at: column.text,
  },
  { indexes: { user: ['user_id'] } },
);

// The household's name (household_info).
const households = new Table({ name: column.text });

// The household's live share links, without snapshots (household_shares).
const shares = new Table(
  {
    household_id: column.text,
    recipe_id: column.text,
    created_at: column.text,
    deleted_at: column.text,
  },
  { indexes: { recipe: ['recipe_id'] } },
);

// The household's list rows not cleared (household_shopping_items stream).
const shopping_items = new Table(
  {
    household_id: column.text,
    item: column.text,
    item_key: column.text,
    quantity: column.real,
    quantity_max: column.real,
    unit: column.text,
    note: column.text,
    aisle: column.text,
    recipe_id: column.text,
    recipe_title: column.text,
    checked_at: column.text,
    created_at: column.text,
    updated_at: column.text,
    updated_by: column.text,
    deleted_at: column.text,
  },
  { indexes: { key: ['item_key'] } },
);

// The household's own aisle for an item (household_aisle_choices stream).
const aisle_choices = new Table({
  household_id: column.text,
  item_key: column.text,
  aisle: column.text,
  created_at: column.text,
  updated_at: column.text,
  updated_by: column.text,
  deleted_at: column.text,
});

// The household's cook diary, trashed entries too (household_cook_logs).
// cooked_by is stamped by the server; cooked_on is a YYYY-MM-DD day.
const cook_logs = new Table(
  {
    household_id: column.text,
    recipe_id: column.text,
    recipe_title: column.text,
    cooked_on: column.text,
    cooked_by: column.text,
    notes: column.text,
    created_at: column.text,
    updated_at: column.text,
    updated_by: column.text,
    deleted_at: column.text,
  },
  { indexes: { recipe: ['recipe_id'] } },
);

// attachments is PowerSync's local-only queue table: never uploaded.
export const AppSchema = new Schema({
  recipes,
  favorites,
  imports,
  photos,
  substitutions,
  memberships,
  households,
  shares,
  shopping_items,
  aisle_choices,
  cook_logs,
  attachments: new AttachmentTable(),
});

export type Database = (typeof AppSchema)['types'];
export type RecipeRow = Database['recipes'];
export type FavoriteRow = Database['favorites'];
export type ImportRow = Database['imports'];
export type PhotoRow = Database['photos'];
export type ShoppingItemRow = Database['shopping_items'];
export type AisleChoiceRow = Database['aisle_choices'];
export type CookLogRow = Database['cook_logs'];
