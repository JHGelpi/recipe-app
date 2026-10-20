import { z } from 'zod';
import { UNITS } from './ingredients';
import { RECIPE_LIMITS, TITLE_MAX } from './limits';

// The parts a recipe is made of, in their own file so sharing.ts can use them
// without a cycle through index.ts.
export const recipeTitleSchema = z
  .string()
  .trim()
  .min(1, 'Title is required')
  .max(TITLE_MAX, `Title must be ${TITLE_MAX} characters or fewer`);

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
