import { z } from 'zod';
import { TITLE_MAX } from './limits';

/** FR-37–FR-41: what a cook log entry may hold (the migration checks the same). */
export const COOK_LOG_LIMITS = { notes: 4000, photos: 8, firstDay: '2000-01-01' } as const;

const timestampSchema = z.iso.datetime({ offset: true });

/** A real calendar day, YYYY-MM-DD, on or after COOK_LOG_LIMITS.firstDay. */
export const cookedOnSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((day) => isRealDay(day) && day >= COOK_LOG_LIMITS.firstDay);

function isRealDay(day: string): boolean {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

const notesSchema = z.string().max(COOK_LOG_LIMITS.notes).nullable().optional();

// cooked_by is stamped by the database (the person who logged it), so the
// phone never sends it.
export const cookLogPutSchema = z.strictObject({
  id: z.guid(),
  household_id: z.guid(),
  recipe_id: z.guid().nullable().optional(),
  recipe_title: z.string().trim().min(1).max(TITLE_MAX),
  cooked_on: cookedOnSchema,
  notes: notesSchema,
  deleted_at: timestampSchema.nullable().optional(),
});

/** An entry stays with its recipe; its day, notes and trash state change. */
export const cookLogPatchSchema = z
  .strictObject({
    id: z.guid(),
    cooked_on: cookedOnSchema.optional(),
    notes: notesSchema,
    deleted_at: timestampSchema.nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 1, { message: 'Patch has no fields' });

export const COOK_LOG_CLIENT_FIELDS = [
  'household_id',
  'recipe_id',
  'recipe_title',
  'cooked_on',
  'notes',
  'deleted_at',
] as const;

const pad = (n: number) => String(n).padStart(2, '0');

/** The calendar day where the phone is, as YYYY-MM-DD. */
export function localDay(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** FR-37: a typed day for an entry, checked against the phone's today. */
export function parseCookedOn(
  input: string,
  today: string,
): { ok: true; day: string } | { ok: false; message: string } {
  const day = input.trim();
  if (!cookedOnSchema.safeParse(day).success) {
    return { ok: false, message: 'Enter a date like 2026-10-22' };
  }
  if (day > today) return { ok: false, message: 'The date can’t be in the future' };
  return { ok: true, day };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Oct 22", or "Oct 22, 2025" outside the current year. */
export function formatCookedOn(day: string, today: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const short = `${MONTHS[m - 1]} ${d}`;
  return day.slice(0, 4) === today.slice(0, 4) ? short : `${short}, ${y}`;
}

/** FR-41: "Cooked 4 times · last on Oct 22", or null if never cooked. */
export function cookHistory(entries: { cooked_on: string }[], today: string): string | null {
  if (entries.length === 0) return null;
  const last = entries.reduce((latest, e) => (e.cooked_on > latest ? e.cooked_on : latest), '');
  const times = entries.length === 1 ? 'once' : `${entries.length} times`;
  return `Cooked ${times} · last on ${formatCookedOn(last, today)}`;
}
