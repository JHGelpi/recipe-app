import { toSubstitutionAnswer, type SubstitutionAnswer } from '@recipe-app/domain';

export type SubstitutionRecord = {
  id: string;
  recipe_id: string;
  ingredient_id: string;
  ingredient_raw: string;
  answer: SubstitutionAnswer;
};

/** A synced row, or null when it cannot be read (an older or newer server). */
export function substitutionFromRow(row: Record<string, unknown>): SubstitutionRecord | null {
  const { id, recipe_id, ingredient_id, ingredient_raw } = row;
  if ([id, recipe_id, ingredient_id, ingredient_raw].some((value) => typeof value !== 'string'))
    return null;
  let options: unknown;
  try {
    options = typeof row.options === 'string' ? JSON.parse(row.options) : row.options;
  } catch {
    return null;
  }
  const answer = toSubstitutionAnswer({ options, note: row.note ?? null });
  if (!answer) return null;
  return {
    id: id as string,
    recipe_id: recipe_id as string,
    ingredient_id: ingredient_id as string,
    ingredient_raw: ingredient_raw as string,
    answer,
  };
}
