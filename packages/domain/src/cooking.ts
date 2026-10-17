import type { Ingredient, Unit } from './ingredients';

/** FR-23: how amounts are shown. Display only; the saved recipe never changes. */
export type UnitSystem = 'as_written' | 'us' | 'metric';
export type Amount = { value: number; max: number | null; unit: Unit | null };

/** FR-22: scale steps for a recipe without servings. */
export const SCALE_STEPS = [0.5, 1, 1.5, 2, 3, 4] as const;
const SERVINGS = [1, 999] as const;

const ML: Partial<Record<Unit, number>> = {
  tsp: 4.929,
  tbsp: 14.787,
  cup: 236.588,
  pint: 473.176,
  quart: 946.353,
  gallon: 3785.41,
  ml: 1,
  l: 1000,
};
const GRAMS: Partial<Record<Unit, number>> = { oz: 28.3495, lb: 453.592, g: 1, kg: 1000 };
const US_UNITS = new Set<Unit>(['tsp', 'tbsp', 'cup', 'pint', 'quart', 'gallon', 'oz', 'lb']);
const METRIC_UNITS = new Set<Unit>(['ml', 'l', 'g', 'kg']);
const PLURAL: Partial<Record<Unit, string>> = {
  cup: 'cups',
  pint: 'pints',
  quart: 'quarts',
  gallon: 'gallons',
  clove: 'cloves',
  can: 'cans',
  package: 'packages',
  stick: 'sticks',
  slice: 'slices',
  pinch: 'pinches',
  dash: 'dashes',
};
// The amount at the start of a typed line, as the parser reads it.
const LEADING_AMOUNT = /^\s*[\d½¼¾⅓⅔⅛⅜⅝⅞.,/\s–-]+/;
const EIGHTHS: [number, string][] = [
  [0, ''],
  [1 / 8, '⅛'],
  [1 / 4, '¼'],
  [1 / 3, '⅓'],
  [1 / 2, '½'],
  [2 / 3, '⅔'],
  [3 / 4, '¾'],
  [7 / 8, '⅞'],
  [1, ''],
];

export function scaleFactor(
  recipeServings: number | null,
  chosenServings: number | null,
  scale: number,
): number {
  if (recipeServings && chosenServings) return chosenServings / recipeServings;
  return recipeServings ? 1 : scale;
}

export function stepServings(value: number, delta: 1 | -1): number {
  return Math.min(SERVINGS[1], Math.max(SERVINGS[0], Math.round(value) + delta));
}

/** The next scale step up or down from `factor` (snapping a value between steps). */
export function stepScale(factor: number, delta: 1 | -1): number {
  const steps: readonly number[] = SCALE_STEPS;
  if (delta > 0) return steps.find((step) => step > factor + 1e-9) ?? steps[steps.length - 1]!;
  return [...steps].reverse().find((step) => step < factor - 1e-9) ?? steps[0]!;
}

export function scaleIngredient(ingredient: Ingredient, factor: number): Ingredient {
  if (ingredient.heading || ingredient.quantity === null || factor === 1) return ingredient;
  return {
    ...ingredient,
    quantity: ingredient.quantity * factor,
    quantity_max: ingredient.quantity_max === null ? null : ingredient.quantity_max * factor,
  };
}

function rescale(amount: Amount, ratio: number, unit: Unit): Amount {
  return {
    value: amount.value * ratio,
    max: amount.max === null ? null : amount.max * ratio,
    unit,
  };
}

/** Same kind only: volume ↔ volume, weight ↔ weight. Counted units never convert. */
export function convertAmount(amount: Amount, system: UnitSystem): Amount {
  const unit = amount.unit;
  if (system === 'as_written' || unit === null) return amount;
  if (system === 'metric' && US_UNITS.has(unit)) {
    const volume = ML[unit];
    if (volume) return stepUnits(rescale(amount, volume, 'ml')) as Amount;
    return stepUnits(rescale(amount, GRAMS[unit]!, 'g')) as Amount;
  }
  if (system === 'us' && METRIC_UNITS.has(unit)) {
    const volume = ML[unit];
    if (volume) {
      const ml = amount.value * volume;
      const target: Unit = ml / ML.cup! >= 0.25 ? 'cup' : ml / ML.tbsp! >= 0.25 ? 'tbsp' : 'tsp';
      return rescale(amount, volume / ML[target]!, target);
    }
    const grams = amount.value * GRAMS[unit]!;
    const target: Unit = grams / GRAMS.lb! >= 1 ? 'lb' : 'oz';
    return rescale(amount, GRAMS[unit]! / GRAMS[target]!, target);
  }
  return amount;
}

/** Spec §4: tiny amounts step down a unit, large ones step up. */
export function stepUnits(amount: Amount): Amount | 'pinch' {
  let current = amount;
  // Multiply going down a unit, divide going up: exact for these ratios.
  const down = (times: number, unit: Unit) => (current = rescale(current, times, unit));
  const up = (per: number, unit: Unit) =>
    (current = {
      value: current.value / per,
      max: current.max === null ? null : current.max / per,
      unit,
    });
  if (current.unit === 'l' && current.value < 1) down(1000, 'ml');
  if (current.unit === 'kg' && current.value < 1) down(1000, 'g');
  if (current.unit === 'cup' && current.value < 0.25) down(16, 'tbsp');
  if (current.unit === 'tbsp' && current.value < 1) down(3, 'tsp');
  if (current.unit === 'tsp' && current.value < 0.125) return 'pinch';
  if (current.unit === 'tsp' && current.value >= 3) up(3, 'tbsp');
  if (current.unit === 'tbsp' && current.value >= 16) up(16, 'cup');
  if (current.unit === 'g' && current.value >= 1000) up(1000, 'kg');
  if (current.unit === 'ml' && current.value >= 1000) up(1000, 'l');
  if (current.unit === 'oz' && current.value >= 16) up(16, 'lb');
  return current;
}

function fraction(value: number): string {
  let whole = Math.floor(value);
  const rest = value - whole;
  let [best, glyph] = EIGHTHS[0]!;
  for (const [step, text] of EIGHTHS) {
    if (Math.abs(rest - step) < Math.abs(rest - best)) [best, glyph] = [step, text];
  }
  if (best === 1) whole += 1;
  if (whole === 0 && glyph === '') return '⅛';
  return `${whole > 0 ? whole : ''}${glyph}`;
}

/** An amount as a cook writes it (spec §4). */
export function formatAmount(value: number, unit: Unit | null): string {
  if (unit !== null && US_UNITS.has(unit)) return fraction(value);
  if (unit === 'g' || unit === 'ml') {
    const rounded = value < 100 ? Math.max(1, Math.round(value)) : Math.round(value / 5) * 5;
    return String(rounded);
  }
  if (unit === 'kg' || unit === 'l') return String(Math.round(value * 10) / 10);
  // Counts: eggs, cloves, cans and the like.
  const rounded = Math.max(0.5, Math.round(value * 2) / 2);
  const text = `${Math.floor(rounded) > 0 ? Math.floor(rounded) : ''}${rounded % 1 ? '½' : ''}`;
  return Math.abs(rounded - value) > 1e-6 ? `≈${text}` : text;
}

// Plural unless the shown amount is one or less: "⅔ cup", "1 cup", "1½ cups".
function unitLabel(unit: Unit, shown: string): string {
  return /^≈?(1|⅛|¼|⅓|½|⅔|¾|⅞)$/.test(shown) ? unit : (PLURAL[unit] ?? unit);
}

/** FR-21–23: the line to show for a scale and unit system. */
export function displayIngredient(
  ingredient: Ingredient,
  options: { factor: number; units: UnitSystem },
): string {
  if (ingredient.heading || ingredient.quantity === null) return ingredient.raw;
  if (options.factor === 1 && options.units === 'as_written') return ingredient.raw;
  const scaled = scaleIngredient(ingredient, options.factor);
  const written: Amount = { value: scaled.quantity!, max: scaled.quantity_max, unit: scaled.unit };
  // A line with no item ("2 cups"), or in fluid ounces (stored as "oz", which
  // is weight), keeps its written unit: only the leading number changes.
  const fluid = ingredient.unit === 'oz' && /\bfl\.?\s*oz\b|fluid\s+ounce/i.test(ingredient.raw);
  if (!ingredient.item || fluid) {
    const value = formatAmount(written.value, written.unit);
    const amount =
      written.max === null ? value : `${value}–${formatAmount(written.max, written.unit)}`;
    return ingredient.raw.replace(LEADING_AMOUNT, `${amount} `).trim();
  }
  const converted = convertAmount(written, options.units);
  const stepped =
    converted.unit !== null && (US_UNITS.has(converted.unit) || METRIC_UNITS.has(converted.unit))
      ? stepUnits(converted)
      : converted;
  const note = ingredient.note ? `, ${ingredient.note}` : '';
  // A bracketed equivalent ("(360 ml) milk") would contradict the new amount.
  // A package size with no unit ("(14 oz) can tomatoes") stays.
  const item =
    stepped !== 'pinch' && stepped.unit !== null
      ? ingredient.item.replace(/^\([^)]*\d[^)]*\)\s*/, '')
      : ingredient.item;
  if (stepped === 'pinch') return `a pinch of ${item}${note}`;
  const value = formatAmount(stepped.value, stepped.unit);
  const amount =
    stepped.max === null ? value : `${value}–${formatAmount(stepped.max, stepped.unit)}`;
  const unit = stepped.unit
    ? ` ${unitLabel(stepped.unit, stepped.max === null ? value : 'range')}`
    : '';
  return `${amount}${unit} ${item}${note}`;
}
