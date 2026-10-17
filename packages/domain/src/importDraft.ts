import { z } from 'zod';
import { parseIngredientLine, UNITS, type Ingredient, type Unit } from './ingredients';
import { RECIPE_LIMITS, TITLE_MAX } from './limits';
import type { Step } from './steps';

/** Fields the AI can mark as unsure (FR-11). */
export const DRAFT_FIELDS = [
  'title',
  'servings',
  'prep_minutes',
  'cook_minutes',
  'ingredients',
  'steps',
  'tags',
] as const;
export type DraftField = (typeof DRAFT_FIELDS)[number];

export const DRAFT_TAG_LIMIT = 5;
const LINE_MAX = 500;
const STEP_MAX = 2000;
const AUTHOR_MAX = 200;

const draftIngredientSchema = z.strictObject({
  raw: z.string().min(1).max(LINE_MAX),
  quantity: z.number().nonnegative().nullable(),
  quantity_max: z.number().nonnegative().nullable(),
  unit: z.enum(UNITS).nullable(),
  item: z.string().max(LINE_MAX),
  note: z.string().max(LINE_MAX).nullable(),
  heading: z.boolean(),
});
export type DraftIngredient = z.infer<typeof draftIngredientSchema>;

const minutes = z
  .number()
  .int()
  .min(RECIPE_LIMITS.minutes[0])
  .max(RECIPE_LIMITS.minutes[1])
  .nullable();

/** A parsed recipe awaiting review. Stored in imports.draft; never a recipe until saved. */
export const importDraftSchema = z.strictObject({
  title: z.string().min(1).max(TITLE_MAX),
  servings: z
    .number()
    .int()
    .min(RECIPE_LIMITS.servings[0])
    .max(RECIPE_LIMITS.servings[1])
    .nullable(),
  prep_minutes: minutes,
  cook_minutes: minutes,
  ingredients: z.array(draftIngredientSchema).max(RECIPE_LIMITS.ingredients),
  steps: z.array(z.string().min(1).max(STEP_MAX)).max(RECIPE_LIMITS.steps),
  tags: z.array(z.string().min(1).max(RECIPE_LIMITS.tagLength)).max(DRAFT_TAG_LIMIT),
  author: z.string().min(1).max(AUTHOR_MAX).nullable(),
  low_confidence: z.array(z.enum(DRAFT_FIELDS)),
});
export type ImportDraft = z.infer<typeof importDraftSchema>;

type Loose = Record<string, unknown>;
const isLoose = (value: unknown): value is Loose =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const textOf = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
const cut = (text: string, max: number): string =>
  text.length > max ? text.slice(0, max).trimEnd() : text;
const unique = <T>(values: T[]): T[] => [...new Set(values)];

function wholeIn(value: unknown, min: number, max: number): number | null {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  return rounded >= min && rounded <= max ? rounded : null;
}

function amount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function ingredientOf(value: unknown): DraftIngredient | null {
  if (typeof value === 'string') {
    const raw = cut(textOf(value), LINE_MAX);
    return raw === '' ? null : parseIngredientLine(raw);
  }
  if (!isLoose(value)) return null;
  const raw = cut(textOf(value.raw), LINE_MAX);
  if (raw === '') return null;
  const unit =
    typeof value.unit === 'string' && (UNITS as readonly string[]).includes(value.unit)
      ? (value.unit as Unit)
      : null;
  const note = cut(textOf(value.note), LINE_MAX);
  return {
    raw,
    quantity: amount(value.quantity),
    quantity_max: amount(value.quantity_max),
    unit,
    item: cut(textOf(value.item) || raw, LINE_MAX),
    note: note === '' ? null : note,
    heading: value.heading === true,
  };
}

/**
 * Untrusted parser output (rule 7) as a draft, or null when it cannot be one.
 * Fixable problems are fixed: unknown units become null (the line stays),
 * tags are cleaned, impossible numbers dropped, long text cut. Only a missing
 * title, or input that is not an object, is refused.
 */
export function toImportDraft(input: unknown): ImportDraft | null {
  if (!isLoose(input)) return null;
  const title = cut(textOf(input.title), TITLE_MAX);
  if (title === '') return null;
  const steps = listOf(input.steps)
    .map((step) => textOf(isLoose(step) ? step.text : step))
    .filter((step) => step !== '')
    .map((step) => cut(step, STEP_MAX))
    .slice(0, RECIPE_LIMITS.steps);
  const tags = unique(
    listOf(input.tags)
      .map((tag) => textOf(typeof tag === 'string' ? tag.replace(/,/g, ' ') : tag).toLowerCase())
      .filter((tag) => tag !== '' && tag.length <= RECIPE_LIMITS.tagLength),
  ).slice(0, DRAFT_TAG_LIMIT);
  const author = cut(textOf(input.author), AUTHOR_MAX);
  const draft = {
    title,
    servings: wholeIn(input.servings, RECIPE_LIMITS.servings[0], RECIPE_LIMITS.servings[1]),
    prep_minutes: wholeIn(input.prep_minutes, RECIPE_LIMITS.minutes[0], RECIPE_LIMITS.minutes[1]),
    cook_minutes: wholeIn(input.cook_minutes, RECIPE_LIMITS.minutes[0], RECIPE_LIMITS.minutes[1]),
    ingredients: listOf(input.ingredients)
      .map(ingredientOf)
      .filter((item): item is DraftIngredient => item !== null)
      .slice(0, RECIPE_LIMITS.ingredients),
    steps,
    tags,
    author: author === '' ? null : author,
    low_confidence: unique(
      listOf(input.low_confidence).filter((field): field is DraftField =>
        (DRAFT_FIELDS as readonly unknown[]).includes(field),
      ),
    ),
  };
  const parsed = importDraftSchema.safeParse(draft);
  return parsed.success ? parsed.data : null;
}

export type DraftRecipeFields = {
  title: string;
  servings: number | null;
  prep_minutes: number | null;
  cook_minutes: number | null;
  ingredients: Ingredient[];
  steps: Step[];
  tags: string[];
};

/** The recipe fields a draft becomes, with new ids for ingredients and steps. */
export function draftToRecipeFields(draft: ImportDraft, newId: () => string): DraftRecipeFields {
  return {
    title: draft.title,
    servings: draft.servings,
    prep_minutes: draft.prep_minutes,
    cook_minutes: draft.cook_minutes,
    ingredients: draft.ingredients.map((ingredient) => ({ ...ingredient, id: newId() })),
    steps: draft.steps.map((text) => ({ id: newId(), text })),
    tags: draft.tags,
  };
}
