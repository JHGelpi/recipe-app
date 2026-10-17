import { z } from 'zod';

/** FR-24: what the phone sends to ask. The id is the row's, generated on the phone. */
export const substitutionAskSchema = z.strictObject({
  id: z.guid(),
  recipe_id: z.guid(),
  ingredient_id: z.guid(),
});
export type SubstitutionAsk = z.infer<typeof substitutionAskSchema>;

export const substitutionOptionSchema = z.strictObject({
  substitute: z.string().trim().min(1).max(200),
  amount: z.string().trim().min(1).max(200),
  how: z.string().trim().max(500),
  effect: z.string().trim().min(1).max(300),
});
export type SubstitutionOption = z.infer<typeof substitutionOptionSchema>;

export const substitutionAnswerSchema = z
  .strictObject({
    options: z.array(substitutionOptionSchema).max(3),
    note: z.string().trim().max(500).nullable(),
  })
  .refine((answer) => answer.options.length > 0 || (answer.note ?? '') !== '', {
    message: 'An answer needs an option or a note',
  });
export type SubstitutionAnswer = z.infer<typeof substitutionAnswerSchema>;

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : value);

/** The model's answer, untrusted (rule 7): tidied, then held to the schema. */
export function toSubstitutionAnswer(input: unknown): SubstitutionAnswer | null {
  if (typeof input !== 'object' || input === null) return null;
  const { options, note } = input as { options?: unknown; note?: unknown };
  if (!Array.isArray(options)) return null;
  const tidied = {
    options: options
      .slice(0, 3)
      .map((option) =>
        typeof option === 'object' && option !== null
          ? Object.fromEntries(Object.entries(option).map(([key, value]) => [key, text(value)]))
          : option,
      ),
    note: typeof note === 'string' && note.trim() !== '' ? note.trim() : null,
  };
  const parsed = substitutionAnswerSchema.safeParse(tidied);
  return parsed.success ? parsed.data : null;
}

/** The answer was for a line that has since changed, or is gone. */
export function isStale(
  row: { ingredient_raw: string },
  ingredient: { raw: string } | undefined,
): boolean {
  return !ingredient || ingredient.raw.trim() !== row.ingredient_raw.trim();
}

/** FR-25: the line added to the recipe's notes. */
export function substitutionNoteLine(ingredientRaw: string, option: SubstitutionOption): string {
  const amount = option.amount.toLowerCase();
  const named = option.substitute
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .some((word) => word.length > 3 && amount.includes(word));
  const what = named ? option.amount : `${option.amount} (${option.substitute})`;
  return `Instead of ${ingredientRaw.trim()}: ${what} — ${option.effect}`;
}
