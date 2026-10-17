import { recipeSchema, type Ingredient, type SearchSource, type Step } from '@recipe-app/domain';

export const TRASH_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export type RecipeSource = {
  source_url: string | null;
  source_author: string | null;
  source_text: string | null;
};
export const NO_SOURCE: RecipeSource = { source_url: null, source_author: null, source_text: null };

export type RecipeRecord = RecipeSource & {
  id: string;
  household_id: string;
  title: string;
  servings: number | null;
  prep_minutes: number | null;
  cook_minutes: number | null;
  ingredients: Ingredient[];
  steps: Step[];
  tags: string[];
  notes: string;
  deleted_at: string | null;
  /** FR-15: the dish photo. */
  photo_id: string | null;
};

/** A Postgres text[] literal such as {quick,"two words"}. */
function fromArrayLiteral(text: string): string[] {
  const inner = text.slice(1, -1);
  if (inner === '') return [];
  return (inner.match(/"(?:[^"\\]|\\.)*"|[^,]+/g) ?? []).map((part) =>
    part.startsWith('"') ? part.slice(1, -1).replace(/\\(.)/g, '$1') : part,
  );
}

function jsonList(value: unknown): unknown {
  if (value === null || value === undefined || value === '') return [];
  if (typeof value !== 'string') return value;
  if (value.startsWith('{')) return fromArrayLiteral(value);
  return JSON.parse(value) as unknown;
}

/**
 * A local row as a recipe, or null when it cannot be read. Columns added
 * after a row was written arrive as null and read as empty.
 */
export function rowToRecipe(row: Record<string, unknown>): RecipeRecord | null {
  try {
    const parsed = recipeSchema.safeParse({
      id: row.id,
      household_id: row.household_id,
      title: row.title,
      servings: row.servings ?? null,
      prep_minutes: row.prep_minutes ?? null,
      cook_minutes: row.cook_minutes ?? null,
      ingredients: jsonList(row.ingredients),
      steps: jsonList(row.steps),
      tags: jsonList(row.tags),
      notes: row.notes ?? '',
      source_url: row.source_url ?? null,
      source_author: row.source_author ?? null,
      source_text: row.source_text ?? null,
      photo_id: row.photo_id ?? null,
    });
    if (!parsed.success) return null;
    const recipe = parsed.data;
    return {
      id: recipe.id,
      household_id: recipe.household_id,
      title: recipe.title,
      servings: recipe.servings ?? null,
      prep_minutes: recipe.prep_minutes ?? null,
      cook_minutes: recipe.cook_minutes ?? null,
      ingredients: recipe.ingredients ?? [],
      steps: recipe.steps ?? [],
      tags: recipe.tags ?? [],
      notes: recipe.notes ?? '',
      deleted_at: typeof row.deleted_at === 'string' ? row.deleted_at : null,
      source_url: recipe.source_url ?? null,
      source_author: recipe.source_author ?? null,
      source_text: recipe.source_text ?? null,
      photo_id: recipe.photo_id ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Milliseconds since the epoch, for timestamps written here ("…T…Z") and
 * those sync sends ("… …Z", "+00"). Safari's Date.parse accepts only the
 * strict ISO form, so the text is normalised first.
 */
export function parseTimestamp(text: string | null | undefined): number | null {
  if (!text) return null;
  const iso = text
    .trim()
    .replace(' ', 'T')
    .replace(/(\.\d{3})\d+/, '$1')
    .replace(/([+-]\d{2})$/, '$1:00');
  const value = Date.parse(iso);
  return Number.isNaN(value) ? null : value;
}

/** Whole days left before the purge, rounded up; 0 once due. */
export function trashDaysLeft(deletedAt: string, now: number): number {
  const deleted = parseTimestamp(deletedAt);
  if (deleted === null) return 0;
  return Math.max(0, Math.ceil((deleted + TRASH_DAYS * DAY_MS - now) / DAY_MS));
}

export type ListRow = SearchSource & { starred: boolean; photoId: string | null };

function listOf(value: unknown): unknown[] {
  try {
    const list = jsonList(value);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/**
 * A list row for display and search. Lighter than rowToRecipe (no schema
 * check per row): it keeps what it can read and drops the rest, so an odd row
 * still lists by its title.
 */
export function listRowFrom(row: Record<string, unknown>): ListRow {
  return {
    id: String(row.id),
    title: typeof row.title === 'string' ? row.title : '',
    tags: listOf(row.tags).filter((tag): tag is string => typeof tag === 'string'),
    ingredients: listOf(row.ingredients).flatMap((item) => {
      const raw = (item as { raw?: unknown } | null)?.raw;
      return typeof raw === 'string' ? [raw] : [];
    }),
    starred: Boolean(row.starred),
    photoId: typeof row.photo_id === 'string' ? row.photo_id : null,
  };
}
