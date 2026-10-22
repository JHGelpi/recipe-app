import {
  cleanNutrition,
  recipeSchema,
  UNITS,
  type Ingredient,
  type Nutrition,
  type SearchSource,
  type Step,
} from '@recipe-app/domain';

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
  /** FR-43: per serving, or null. */
  nutrition: Nutrition | null;
};

/**
 * FR-43, read apart from the recipe: a value this app cannot read (a newer
 * app's field, a bad row) loses only the nutrition, never the recipe.
 */
function nutritionOf(value: unknown): Nutrition | null {
  try {
    return cleanNutrition(typeof value === 'string' ? JSON.parse(value) : value);
  } catch {
    return null;
  }
}

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

const INGREDIENT_KEYS = [
  'id',
  'raw',
  'quantity',
  'quantity_max',
  'unit',
  'item',
  'note',
  'heading',
];

/**
 * A newer app's extra fields are ignored, and a unit this app does not know
 * reads as raw text (bug batch spec §2). The server's upload schema stays strict.
 */
function tidyIngredients(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((item: unknown) => {
    if (typeof item !== 'object' || item === null) return item;
    const known = Object.fromEntries(
      Object.entries(item).filter(([key]) => INGREDIENT_KEYS.includes(key)),
    );
    if (known.unit !== null && !(UNITS as readonly unknown[]).includes(known.unit)) {
      return { ...known, unit: null, quantity: null, quantity_max: null };
    }
    return known;
  });
}

function tidySteps(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((step: unknown) =>
    typeof step === 'object' && step !== null
      ? { id: (step as { id?: unknown }).id, text: (step as { text?: unknown }).text }
      : step,
  );
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
      ingredients: tidyIngredients(jsonList(row.ingredients)),
      steps: tidySteps(jsonList(row.steps)),
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
      nutrition: nutritionOf(row.nutrition),
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

export type ListRow = SearchSource & {
  starred: boolean;
  photoId: string | null;
  totalMinutes: number | null;
};

function listOf(value: unknown): unknown[] {
  try {
    const list = jsonList(value);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function minutesOf(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
}

/** Prep plus cook, or null when neither is known. */
function totalOf(prep: unknown, cook: unknown): number | null {
  const [p, c] = [minutesOf(prep), minutesOf(cook)];
  return p === null && c === null ? null : (p ?? 0) + (c ?? 0);
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
    // Tidied as the editor saves them, so an odd server tag never shows an empty chip.
    tags: listOf(row.tags).flatMap((tag) => {
      const clean = typeof tag === 'string' ? tag.trim().toLowerCase() : '';
      return clean ? [clean] : [];
    }),
    ingredients: listOf(row.ingredients).flatMap((item) => {
      const raw = (item as { raw?: unknown } | null)?.raw;
      return typeof raw === 'string' ? [raw] : [];
    }),
    starred: Boolean(row.starred),
    photoId: typeof row.photo_id === 'string' ? row.photo_id : null,
    totalMinutes: totalOf(row.prep_minutes, row.cook_minutes),
  };
}
