/**
 * Every table in the public schema. The coverage guard fails if a table exists
 * that is not listed here, so adding a table forces adding its tests.
 */
export const TENANT_TABLES = [
  'households',
  'memberships',
  'recipes',
  'favorites',
  'imports',
  'ai_usage',
  'photos',
  'substitutions',
  'invites',
  'shares',
  'friend_links',
  'shopping_items',
  'aisle_choices',
  'cook_logs',
  'recipe_ratings',
  'recipe_rating_totals',
] as const;

/** The column that holds the tenant id in each table. */
export const TENANT_COLUMN: Record<(typeof TENANT_TABLES)[number], string> = {
  households: 'id',
  memberships: 'household_id',
  recipes: 'household_id',
  favorites: 'household_id',
  imports: 'household_id',
  ai_usage: 'household_id',
  photos: 'household_id',
  substitutions: 'household_id',
  invites: 'household_id',
  shares: 'household_id',
  friend_links: 'household_id',
  shopping_items: 'household_id',
  aisle_choices: 'household_id',
  cook_logs: 'household_id',
  recipe_ratings: 'household_id',
  recipe_rating_totals: 'household_id',
};

/**
 * Public tables that hold no household data (production spec §4): RLS on,
 * no policies, no grants. Only security definer functions and postgres reach them.
 */
export const SYSTEM_TABLES = [
  'feedback_reporters',
  'share_signups',
  'signup_allowed',
  'signup_passes',
  'signup_settings',
] as const;
