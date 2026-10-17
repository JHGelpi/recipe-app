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
] as const;

/** The column that holds the tenant id in each table. */
export const TENANT_COLUMN: Record<(typeof TENANT_TABLES)[number], string> = {
  households: 'id',
  memberships: 'household_id',
  recipes: 'household_id',
  favorites: 'household_id',
  imports: 'household_id',
  ai_usage: 'household_id',
};
