import {
  ingredientsFromText,
  ingredientsToText,
  NUTRITION_FIELDS,
  nutritionToInput,
  normalizeTags,
  parseNutritionInput,
  recipeSchema,
  stepsFromText,
  stepsToText,
  type Ingredient,
  type Nutrition,
  type NutritionField,
  type Step,
} from '@recipe-app/domain';
import type { RecipeRecord } from './rows';

export type RecipeForm = {
  title: string;
  servings: string;
  prep: string;
  cook: string;
  ingredients: string;
  steps: string;
  tags: string;
  notes: string;
} & Record<NutritionField, string>;

export type RecipeValues = {
  title: string;
  servings: number | null;
  prep_minutes: number | null;
  cook_minutes: number | null;
  ingredients: Ingredient[];
  steps: Step[];
  tags: string[];
  notes: string;
  /** FR-43: per serving, or null when every field was left blank. */
  nutrition: Nutrition | null;
};

export type FormResult =
  | { ok: true; values: RecipeValues }
  | { ok: false; errors: Partial<Record<keyof RecipeForm, string>> };

// Which editor field each schema field is typed in.
const FIELD_OF: Record<string, keyof RecipeForm> = {
  title: 'title',
  servings: 'servings',
  prep_minutes: 'prep',
  cook_minutes: 'cook',
  ingredients: 'ingredients',
  steps: 'steps',
  tags: 'tags',
  notes: 'notes',
};

// Messages for numbers that could not be read at all (zod's default
// "expected number, received NaN" means nothing to a cook).
const NUMBER_MESSAGE: Partial<Record<keyof RecipeForm, string>> = {
  servings: 'Servings must be 1 to 999',
  prep: 'Prep must be 0 to 10000 minutes',
  cook: 'Cook must be 0 to 10000 minutes',
};

const LINE_NAME: Record<string, string> = { ingredients: 'Ingredient', steps: 'Step', tags: 'Tag' };

/** "Ingredient 3 is over 500 characters" for a line that is too long; null otherwise. */
function lineMessage(issue: {
  path: PropertyKey[];
  code: string;
  maximum?: unknown;
}): string | null {
  const [field, index] = issue.path;
  const name = LINE_NAME[String(field)];
  if (!name || typeof index !== 'number' || issue.code !== 'too_big') return null;
  return `${name} ${index + 1} is over ${String(issue.maximum)} characters`;
}

export function emptyForm(): RecipeForm {
  return {
    title: '',
    servings: '',
    prep: '',
    cook: '',
    ingredients: '',
    steps: '',
    tags: '',
    notes: '',
    ...nutritionToInput(null),
  };
}

export function formFromRecipe(recipe: RecipeRecord): RecipeForm {
  return {
    title: recipe.title,
    servings: recipe.servings === null ? '' : String(recipe.servings),
    prep: recipe.prep_minutes === null ? '' : String(recipe.prep_minutes),
    cook: recipe.cook_minutes === null ? '' : String(recipe.cook_minutes),
    ingredients: ingredientsToText(recipe.ingredients),
    steps: stepsToText(recipe.steps),
    tags: recipe.tags.join(', '),
    notes: recipe.notes,
    ...nutritionToInput(recipe.nutrition),
  };
}

/** Empty text means "not set"; anything else must be a whole number. */
function whole(text: string): number | null {
  const value = text.trim();
  if (value === '') return null;
  return /^-?\d+$/.test(value) ? Number(value) : Number.NaN;
}

/** The editor's text as validated recipe values, or a message per field. */
export function valuesFromForm(
  form: RecipeForm,
  previous: RecipeRecord | null,
  newId: () => string,
): FormResult {
  const candidate = {
    title: form.title,
    servings: whole(form.servings),
    prep_minutes: whole(form.prep),
    cook_minutes: whole(form.cook),
    ingredients: ingredientsFromText(form.ingredients, previous?.ingredients ?? [], newId),
    steps: stepsFromText(form.steps, previous?.steps ?? [], newId),
    tags: normalizeTags(form.tags),
    notes: form.notes.trim(),
  };
  const nutrition = parseNutritionInput(
    Object.fromEntries(NUTRITION_FIELDS.map((field) => [field, form[field]])) as Record<
      NutritionField,
      string
    >,
  );
  const parsed = recipeSchema
    .omit({ id: true, household_id: true, deleted_at: true })
    .safeParse(candidate);
  if (parsed.success && nutrition.ok) {
    return {
      ok: true,
      values: { ...candidate, title: parsed.data.title, nutrition: nutrition.value },
    };
  }
  const errors: Partial<Record<keyof RecipeForm, string>> = {};
  if (!nutrition.ok) errors[nutrition.field] = nutrition.message;
  for (const issue of parsed.success ? [] : parsed.error.issues) {
    const field = FIELD_OF[String(issue.path[0])];
    if (field && !errors[field]) {
      // too_big issues carry `maximum`; the issue union does not say so for every code.
      const line = lineMessage(issue as unknown as Parameters<typeof lineMessage>[0]);
      errors[field] = NUMBER_MESSAGE[field] ?? line ?? issue.message;
    }
  }
  return { ok: false, errors };
}
