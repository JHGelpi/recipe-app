export const UNITS = [
  'cup',
  'tbsp',
  'tsp',
  'oz',
  'lb',
  'g',
  'kg',
  'ml',
  'l',
  'pinch',
  'dash',
  'clove',
  'can',
  'package',
  'stick',
  'slice',
  'pint',
  'quart',
  'gallon',
] as const;
export type Unit = (typeof UNITS)[number];

export type ParsedIngredient = {
  raw: string;
  quantity: number | null;
  quantity_max: number | null;
  unit: Unit | null;
  item: string;
  note: string | null;
  heading: boolean;
};
export type Ingredient = ParsedIngredient & { id: string };

// Lowercased spellings, without a trailing period. "T" and "t" are handled
// separately because their case carries the meaning.
const UNIT_ALIASES: Record<string, Unit> = {
  cup: 'cup',
  cups: 'cup',
  c: 'cup',
  tablespoon: 'tbsp',
  tablespoons: 'tbsp',
  tbsp: 'tbsp',
  tbsps: 'tbsp',
  tbs: 'tbsp',
  tbl: 'tbsp',
  teaspoon: 'tsp',
  teaspoons: 'tsp',
  tsp: 'tsp',
  tsps: 'tsp',
  ounce: 'oz',
  ounces: 'oz',
  oz: 'oz',
  ozs: 'oz',
  pound: 'lb',
  pounds: 'lb',
  lb: 'lb',
  lbs: 'lb',
  gram: 'g',
  grams: 'g',
  g: 'g',
  kilogram: 'kg',
  kilograms: 'kg',
  kg: 'kg',
  milliliter: 'ml',
  milliliters: 'ml',
  millilitre: 'ml',
  millilitres: 'ml',
  ml: 'ml',
  liter: 'l',
  liters: 'l',
  litre: 'l',
  litres: 'l',
  l: 'l',
  pinch: 'pinch',
  pinches: 'pinch',
  dash: 'dash',
  dashes: 'dash',
  clove: 'clove',
  cloves: 'clove',
  can: 'can',
  cans: 'can',
  package: 'package',
  packages: 'package',
  pkg: 'package',
  pkgs: 'package',
  stick: 'stick',
  sticks: 'stick',
  slice: 'slice',
  slices: 'slice',
  pint: 'pint',
  pints: 'pint',
  pt: 'pint',
  quart: 'quart',
  quarts: 'quart',
  qt: 'quart',
  gallon: 'gallon',
  gallons: 'gallon',
  gal: 'gallon',
};

const VULGAR: Record<string, number> = {
  '¼': 1 / 4,
  '½': 1 / 2,
  '¾': 3 / 4,
  '⅓': 1 / 3,
  '⅔': 2 / 3,
  '⅛': 1 / 8,
  '⅜': 3 / 8,
  '⅝': 5 / 8,
  '⅞': 7 / 8,
};
const VULGAR_CHARS = Object.keys(VULGAR).join('');
const NUMBER = `(?:\\d+\\s+\\d+/\\d+|\\d+/\\d+|\\d*[${VULGAR_CHARS}]|\\d+(?:\\.\\d+)?|\\.\\d+)`;
const QUANTITY = new RegExp(`^(${NUMBER})(?:\\s*(?:-|–|\\bto\\b)\\s*(${NUMBER}))?(?=\\s|$)\\s*`);
const UNIT_WORD = /^([A-Za-z]+)\.?(?=\s|$)\s*/;

function toNumber(text: string): number | null {
  const result = rawNumber(text.trim());
  // 1/0 and the like are not quantities.
  return result !== null && Number.isFinite(result) ? result : null;
}

function rawNumber(value: string): number | null {
  const mixed = /^(\d+)\s+(\d+)\/(\d+)$/.exec(value);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const fraction = /^(\d+)\/(\d+)$/.exec(value);
  if (fraction) return Number(fraction[1]) / Number(fraction[2]);
  const vulgar = new RegExp(`^(\\d*)([${VULGAR_CHARS}])$`).exec(value);
  if (vulgar) return Number(vulgar[1] || 0) + (VULGAR[vulgar[2] ?? ''] ?? 0);
  const plain = Number(value);
  return Number.isFinite(plain) ? plain : null;
}

/** Splits at the first comma that is not inside parentheses. */
function splitNote(text: string): [string, string | null] {
  let depth = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '(') depth++;
    else if (char === ')') depth = Math.max(0, depth - 1);
    else if (char === ',' && depth === 0) {
      const note = text.slice(index + 1).trim();
      return [text.slice(0, index).trim(), note === '' ? null : note];
    }
  }
  return [text.trim(), null];
}

function unitOf(word: string): Unit | null {
  if (word === 'T') return 'tbsp';
  if (word === 't') return 'tsp';
  return UNIT_ALIASES[word.toLowerCase()] ?? null;
}

/**
 * Reads one typed ingredient line. Never throws: anything it does not
 * recognise stays in `item`, and `raw` always keeps what was typed.
 */
export function parseIngredientLine(input: string): ParsedIngredient {
  const raw = input.trim().replace(/\s+/g, ' ');
  const plain = { raw, quantity: null, quantity_max: null, unit: null, note: null };

  const match = QUANTITY.exec(raw);
  const quantity = match ? toNumber(match[1] ?? '') : null;
  const quantityMax = match?.[2] ? toNumber(match[2]) : null;
  if (!match || quantity === null || (match[2] && quantityMax === null)) {
    if (raw.endsWith(':')) return { ...plain, item: raw.slice(0, -1).trim(), heading: true };
    const [item, note] = splitNote(raw);
    return { ...plain, item, note, heading: false };
  }

  let rest = raw.slice(match[0].length);
  let unit: Unit | null = null;
  const word = UNIT_WORD.exec(rest);
  if (word) {
    unit = unitOf(word[1] ?? '');
    if (unit) rest = rest.slice(word[0].length).replace(/^of\s+/i, '');
  }
  const [item, note] = splitNote(rest);
  return { raw, quantity, quantity_max: quantityMax, unit, item, note, heading: false };
}

/**
 * One ingredient per non-empty line. An unchanged line keeps its earlier
 * reading whole, id included, so an import's AI reading survives editing.
 */
export function ingredientsFromText(
  text: string,
  previous: Ingredient[],
  newId: () => string,
): Ingredient[] {
  const unused = new Map<string, Ingredient[]>();
  for (const ingredient of previous) {
    unused.set(ingredient.raw, [...(unused.get(ingredient.raw) ?? []), ingredient]);
  }
  return text
    .split(/\r?\n/)
    .map((line) => parseIngredientLine(line))
    .filter((parsed) => parsed.raw !== '')
    .map((parsed) => unused.get(parsed.raw)?.shift() ?? { ...parsed, id: newId() });
}

export function ingredientsToText(ingredients: Ingredient[]): string {
  return ingredients.map((ingredient) => ingredient.raw).join('\n');
}
