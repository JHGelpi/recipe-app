import { z } from 'zod';

/** FR-7, spec §3–§4: what a photo may be. */
export const PHOTO_LIMITS = { bytes: 3_000_000, edge: 4_000, pages: 8 } as const;

/**
 * Long edges the phone resizes to (spec §2). Claude scales anything larger to
 * about 1568 px anyway, so a bigger page only costs upload time.
 */
export const PAGE_EDGE = 1568;
export const DISH_EDGE = 1200;

export const PHOTO_KINDS = ['page', 'dish', 'cook'] as const;
export type PhotoKind = (typeof PHOTO_KINDS)[number];

const timestampSchema = z.iso.datetime({ offset: true });
const sideSchema = z.number().int().min(1).max(PHOTO_LIMITS.edge);

const photoFields = {
  id: z.guid(),
  household_id: z.guid(),
  media_type: z.literal('image/jpeg'),
  bytes: z.number().int().min(1).max(PHOTO_LIMITS.bytes),
  width: sideSchema,
  height: sideSchema,
  recipe_id: z.guid().nullable().optional(),
  deleted_at: timestampSchema.nullable().optional(),
};

// The phone writes the description; uploaded_at belongs to the file endpoint.
export const photoPutSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    ...photoFields,
    kind: z.literal('page'),
    import_id: z.guid(),
    position: z.number().int().min(1).max(PHOTO_LIMITS.pages),
  }),
  z.strictObject({ ...photoFields, kind: z.literal('dish') }),
  // FR-39: a meal's photo belongs to its cook log entry, never to a recipe.
  z.strictObject({
    ...photoFields,
    kind: z.literal('cook'),
    recipe_id: z.null().optional(),
    cook_log_id: z.guid(),
    position: z.number().int().min(1).max(PHOTO_LIMITS.pages),
  }),
]);

// Pages are ordered before Import and never reordered after, so position is
// not patchable.
export const photoPatchSchema = z
  .strictObject({
    id: z.guid(),
    recipe_id: z.guid().nullable().optional(),
    deleted_at: timestampSchema.nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 1, { message: 'Patch has no fields' });

export const PHOTO_CLIENT_FIELDS = [
  'household_id',
  'kind',
  'import_id',
  'position',
  'recipe_id',
  'cook_log_id',
  'media_type',
  'bytes',
  'width',
  'height',
  'deleted_at',
] as const;

/** The size that fits `maxEdge` on the long side with the same shape. Never enlarges. */
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** A picture's place on a page: [x0, y0, x1, y1], each a fraction of the page's width or height. */
export type DishBox = [number, number, number, number];

/** The box in whole pixels of a `width` × `height` image, inside it and at least 1 × 1. */
export function cropRect(
  width: number,
  height: number,
  box: DishBox,
): { x: number; y: number; width: number; height: number } {
  const x = Math.min(width - 1, Math.round(box[0] * width));
  const y = Math.min(height - 1, Math.round(box[1] * height));
  return {
    x,
    y,
    width: Math.max(1, Math.min(width, Math.round(box[2] * width)) - x),
    height: Math.max(1, Math.min(height, Math.round(box[3] * height)) - y),
  };
}
