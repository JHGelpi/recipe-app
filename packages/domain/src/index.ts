import { z } from 'zod';
import { isHttpUrl, SOURCE_LIMITS } from './imports';
import { UNITS } from './ingredients';
import { RECIPE_LIMITS, TITLE_MAX } from './limits';

export * from './imports';
export * from './ingredients';
export * from './steps';
export * from './tags';
export * from './search';
export * from './importDraft';
export * from './html';
export * from './jsonLd';
export * from './photos';
export * from './cooking';
export * from './substitutions';
export * from './household';
export * from './sharing';
export * from './shopping';
export { RECIPE_LIMITS, TITLE_MAX } from './limits';

export const recipeTitleSchema = z
  .string()
  .trim()
  .min(1, 'Title is required')
  .max(TITLE_MAX, `Title must be ${TITLE_MAX} characters or fewer`);

const timestampSchema = z.iso.datetime({ offset: true });

export const unitSchema = z.enum(UNITS);

export const ingredientSchema = z.strictObject({
  id: z.guid(),
  raw: z.string().trim().min(1).max(500),
  quantity: z.number().nonnegative().nullable(),
  quantity_max: z.number().nonnegative().nullable(),
  unit: unitSchema.nullable(),
  item: z.string().max(500),
  note: z.string().max(500).nullable(),
  heading: z.boolean(),
});

export const stepSchema = z.strictObject({
  id: z.guid(),
  text: z.string().trim().min(1).max(2000),
});

export const tagSchema = z
  .string()
  .min(1)
  .max(RECIPE_LIMITS.tagLength)
  .refine((tag) => tag === tag.trim().toLowerCase(), 'Tags are trimmed and lowercase');

const minutesSchema = (label: string) =>
  z
    .number()
    .int(`${label} must be a whole number of minutes`)
    .min(RECIPE_LIMITS.minutes[0], `${label} must be 0 to 10000 minutes`)
    .max(RECIPE_LIMITS.minutes[1], `${label} must be 0 to 10000 minutes`)
    .nullable();

// z.guid() accepts any 8-4-4-4-12 hex string. z.uuid() would reject the
// hand-written ids used in seed data.
export const recipeSchema = z.strictObject({
  id: z.guid(),
  household_id: z.guid(),
  title: recipeTitleSchema,
  servings: z
    .number()
    .int('Servings must be 1 to 999')
    .min(RECIPE_LIMITS.servings[0], 'Servings must be 1 to 999')
    .max(RECIPE_LIMITS.servings[1], 'Servings must be 1 to 999')
    .nullable()
    .optional(),
  prep_minutes: minutesSchema('Prep').optional(),
  cook_minutes: minutesSchema('Cook').optional(),
  ingredients: z
    .array(ingredientSchema)
    .max(RECIPE_LIMITS.ingredients, `At most ${RECIPE_LIMITS.ingredients} ingredients`)
    .optional(),
  steps: z
    .array(stepSchema)
    .max(RECIPE_LIMITS.steps, `At most ${RECIPE_LIMITS.steps} steps`)
    .optional(),
  tags: z.array(tagSchema).max(RECIPE_LIMITS.tags, `At most ${RECIPE_LIMITS.tags} tags`).optional(),
  notes: z
    .string()
    .max(RECIPE_LIMITS.notes, `Notes must be ${RECIPE_LIMITS.notes} characters or fewer`)
    .optional(),
  // FR-12, NFR-13: where an imported recipe came from. Set once, on save from review.
  source_url: z
    .string()
    .max(SOURCE_LIMITS.url)
    .refine(isHttpUrl, 'A source link must start with http:// or https://')
    .nullable()
    .optional(),
  source_author: z.string().max(SOURCE_LIMITS.author).nullable().optional(),
  source_text: z.string().max(SOURCE_LIMITS.text).nullable().optional(),
  // FR-15: the dish photo, a photos row of this household.
  photo_id: z.guid().nullable().optional(),
  deleted_at: timestampSchema.nullable().optional(),
});

export const recipePatchSchema = recipeSchema
  .partial()
  .required({ id: true })
  .refine((value) => Object.keys(value).length > 1, { message: 'Patch has no fields' });

/** Fields the client may send. Server-owned fields are never uploaded. */
export const RECIPE_CLIENT_FIELDS = [
  'household_id',
  'title',
  'servings',
  'prep_minutes',
  'cook_minutes',
  'ingredients',
  'steps',
  'tags',
  'notes',
  'source_url',
  'source_author',
  'source_text',
  'photo_id',
  'deleted_at',
] as const;

export const favoriteSchema = z.strictObject({
  id: z.guid(),
  household_id: z.guid(),
  user_id: z.guid(),
  recipe_id: z.guid(),
  deleted_at: timestampSchema.nullable().optional(),
});

/** A favorite is starred or not; it never moves to another recipe or user. */
export const favoritePatchSchema = z.strictObject({
  id: z.guid(),
  deleted_at: timestampSchema.nullable(),
});

export const FAVORITE_CLIENT_FIELDS = [
  'household_id',
  'user_id',
  'recipe_id',
  'deleted_at',
] as const;

export type Recipe = z.infer<typeof recipeSchema>;
export type RecipePatch = z.infer<typeof recipePatchSchema>;
export type Favorite = z.infer<typeof favoriteSchema>;
