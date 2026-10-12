import { z } from 'zod';

export const TITLE_MAX = 200;

export const recipeTitleSchema = z
  .string()
  .trim()
  .min(1, 'Title is required')
  .max(TITLE_MAX, `Title must be ${TITLE_MAX} characters or fewer`);

const timestampSchema = z.iso.datetime({ offset: true });

// z.guid() accepts any 8-4-4-4-12 hex string. z.uuid() would reject the
// hand-written ids used in seed data.
export const recipeSchema = z.strictObject({
  id: z.guid(),
  household_id: z.guid(),
  title: recipeTitleSchema,
  deleted_at: timestampSchema.nullable().optional(),
});

export const recipePatchSchema = recipeSchema
  .partial()
  .required({ id: true })
  .refine((value) => Object.keys(value).length > 1, { message: 'Patch has no fields' });

/** Fields the client may send. Server-owned fields are never uploaded. */
export const RECIPE_CLIENT_FIELDS = ['household_id', 'title', 'deleted_at'] as const;

export type Recipe = z.infer<typeof recipeSchema>;
export type RecipePatch = z.infer<typeof recipePatchSchema>;
