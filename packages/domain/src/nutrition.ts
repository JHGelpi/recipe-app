import { z } from 'zod';

/**
 * FR-43: optional nutrition per serving. Only what the source states or the
 * cook types; never estimated. The migration's recipes_nutrition_check holds
 * the same limits.
 */
export const NUTRITION_FIELDS = ['calories', 'protein_g', 'carbs_g', 'fat_g'] as const;
export type NutritionField = (typeof NUTRITION_FIELDS)[number];
export const NUTRITION_LIMITS: Record<NutritionField, number> = {
  calories: 10_000,
  protein_g: 1_000,
  carbs_g: 1_000,
  fat_g: 1_000,
};
export const NUTRITION_LABELS: Record<NutritionField, string> = {
  calories: 'Calories',
  protein_g: 'Protein',
  carbs_g: 'Carbohydrates',
  fat_g: 'Fat',
};

const value = (field: NutritionField) =>
  z.number().min(0).max(NUTRITION_LIMITS[field]).nullable().optional();

/** At least one value: no nutrition is stored as null, not as an empty object. */
export const nutritionSchema = z
  .strictObject({
    calories: value('calories'),
    protein_g: value('protein_g'),
    carbs_g: value('carbs_g'),
    fat_g: value('fat_g'),
  })
  .refine((n) => NUTRITION_FIELDS.some((field) => typeof n[field] === 'number'), {
    message: 'Nutrition has no values',
  });
export type Nutrition = Partial<Record<NutritionField, number | null>>;

const round1 = (n: number) => Math.round(n * 10) / 10;

function numberIn(raw: unknown, field: NutritionField): number | null {
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw.trim()) : raw;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const rounded = round1(n);
  return rounded >= 0 && rounded <= NUTRITION_LIMITS[field] ? rounded : null;
}

function compact(values: Partial<Record<NutritionField, number | null>>): Nutrition | null {
  const kept = Object.fromEntries(
    NUTRITION_FIELDS.flatMap((field) =>
      typeof values[field] === 'number' ? [[field, values[field]]] : [],
    ),
  ) as Nutrition;
  return Object.keys(kept).length > 0 ? kept : null;
}

/** Untrusted nutrition (AI output, rule 7) made safe: bad values dropped; null when none left. */
export function cleanNutrition(input: unknown): Nutrition | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  const loose = input as Record<string, unknown>;
  return compact(
    Object.fromEntries(NUTRITION_FIELDS.map((field) => [field, numberIn(loose[field], field)])),
  );
}

export type NutritionInput = Record<NutritionField, string>;
export const EMPTY_NUTRITION_INPUT: NutritionInput = {
  calories: '',
  protein_g: '',
  carbs_g: '',
  fat_g: '',
};

export function nutritionToInput(nutrition: Nutrition | null | undefined): NutritionInput {
  return Object.fromEntries(
    NUTRITION_FIELDS.map((field) => {
      const n = nutrition?.[field];
      return [field, typeof n === 'number' ? String(n) : ''];
    }),
  ) as NutritionInput;
}

/** The editor's four fields: blank is none; a bad value names its field. */
export function parseNutritionInput(
  input: NutritionInput,
): { ok: true; value: Nutrition | null } | { ok: false; field: NutritionField; message: string } {
  const values: Partial<Record<NutritionField, number | null>> = {};
  for (const field of NUTRITION_FIELDS) {
    const text = input[field].trim();
    if (text === '') continue;
    const n = numberIn(text, field);
    if (n === null) {
      return {
        ok: false,
        field,
        message: `${NUTRITION_LABELS[field]} must be a number from 0 to ${NUTRITION_LIMITS[field]}`,
      };
    }
    values[field] = n;
  }
  return { ok: true, value: compact(values) };
}

const JSON_LD_KEYS: Record<NutritionField, string> = {
  calories: 'calories',
  protein_g: 'proteinContent',
  carbs_g: 'carbohydrateContent',
  fat_g: 'fatContent',
};

/** "240 calories", "1046 kJ", "12 g", "500 mg", or a number, in kcal or grams. */
function amountOf(raw: unknown, field: NutritionField): number | null {
  if (typeof raw === 'number') return numberIn(raw, field);
  if (typeof raw !== 'string') return null;
  const match = /(\d+(?:[.,]\d+)?)\s*([a-zµ]*)/i.exec(raw);
  if (!match) return null;
  const n = Number(match[1]!.replace(',', '.'));
  const unit = match[2]!.toLowerCase();
  if (field === 'calories') return numberIn(unit === 'kj' ? n / 4.184 : n, field);
  return numberIn(unit === 'mg' ? n / 1000 : n, field);
}

/** FR-43: a schema.org NutritionInformation block, per serving as sites state it. */
export function nutritionFromJsonLd(value: unknown): Nutrition | null {
  const node = Array.isArray(value) ? value[0] : value;
  if (typeof node !== 'object' || node === null) return null;
  const loose = node as Record<string, unknown>;
  return compact(
    Object.fromEntries(
      NUTRITION_FIELDS.map((field) => [field, amountOf(loose[JSON_LD_KEYS[field]], field)]),
    ),
  );
}

const UNIT: Record<NutritionField, (n: number) => string> = {
  calories: (n) => `${n} kcal`,
  protein_g: (n) => `${n} g protein`,
  carbs_g: (n) => `${n} g carbs`,
  fat_g: (n) => `${n} g fat`,
};

/** FR-43 in shares: "Per serving: 420 kcal · 30 g protein", or null when none. */
export function nutritionLine(nutrition: Nutrition | null | undefined): string | null {
  const parts = formatNutrition(nutrition);
  return parts.length > 0 ? `Per serving: ${parts.join(' · ')}` : null;
}

/** "420 kcal", "30 g protein", … for what is known. */
export function formatNutrition(nutrition: Nutrition | null | undefined): string[] {
  return NUTRITION_FIELDS.flatMap((field) => {
    const n = nutrition?.[field];
    return typeof n === 'number' ? [UNIT[field](n)] : [];
  });
}
