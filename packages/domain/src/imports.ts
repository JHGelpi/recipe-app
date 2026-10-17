import { z } from 'zod';

/** FR-9, FR-8, NFR-13: what an import may carry. */
export const SOURCE_LIMITS = { text: 20_000, url: 2_000, author: 200 } as const;

export const IMPORT_STATUSES = ['pending', 'parsing', 'ready', 'failed'] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];

export const IMPORT_ERRORS = [
  'quota',
  'ai_unavailable',
  'fetch_failed',
  'blocked_address',
  'not_a_recipe',
  'invalid_output',
] as const;
export type ImportError = (typeof IMPORT_ERRORS)[number];

/** Failures a new attempt can fix. `quota` succeeds once the month has changed. */
export const RETRYABLE_IMPORT_ERRORS: readonly ImportError[] = [
  'quota',
  'ai_unavailable',
  'fetch_failed',
  'invalid_output',
];

/**
 * A parse still "parsing" after this long is taken to have died and may be
 * claimed again. Longer than the slowest possible parse (page fetch plus two
 * AI attempts), so a live parse is never claimed twice and billed twice.
 */
export const PARSE_STALE_SECONDS = 300;

export function isRetryable(error: string | null | undefined): boolean {
  return (RETRYABLE_IMPORT_ERRORS as readonly string[]).includes(error ?? '');
}

/** An absolute http(s) link with a host. Anything else (javascript:, file:) is refused. */
export function isHttpUrl(value: string): boolean {
  if (!/^https?:\/\//i.test(value)) return false;
  try {
    return new URL(value).hostname !== '';
  } catch {
    return false;
  }
}

const timestampSchema = z.iso.datetime({ offset: true });

export const importTextSchema = z
  .string()
  .trim()
  .min(1, 'Paste the recipe text first')
  .max(SOURCE_LIMITS.text, 'At most 20,000 characters');

export const importUrlSchema = z
  .string()
  .trim()
  .max(SOURCE_LIMITS.url, 'That link is too long')
  .refine(isHttpUrl, 'Enter a link starting with http:// or https://');

// The phone writes only the source and dismissal. status, draft, error and
// parse_started_at belong to the parse endpoint (ADR-0012).
export const importPutSchema = z.discriminatedUnion('source_type', [
  z.strictObject({
    id: z.guid(),
    household_id: z.guid(),
    source_type: z.literal('text'),
    source_text: importTextSchema,
    deleted_at: timestampSchema.nullable().optional(),
  }),
  z.strictObject({
    id: z.guid(),
    household_id: z.guid(),
    source_type: z.literal('url'),
    source_url: importUrlSchema,
    deleted_at: timestampSchema.nullable().optional(),
  }),
]);

export const importPatchSchema = z
  .strictObject({
    id: z.guid(),
    recipe_id: z.guid().nullable().optional(),
    deleted_at: timestampSchema.nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 1, { message: 'Patch has no fields' });

export const IMPORT_CLIENT_FIELDS = [
  'household_id',
  'source_type',
  'source_text',
  'source_url',
  'recipe_id',
  'deleted_at',
] as const;
