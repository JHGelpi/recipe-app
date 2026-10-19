import { z } from 'zod';
import { AISLE_WORDS } from './aisles';
import { baseOf, formatTotal, scaleIngredient } from './cooking';
import { parseIngredientLine, UNITS, type Ingredient, type Unit } from './ingredients';
import { TITLE_MAX } from './limits';

export const AISLES = [
  { id: 'produce', label: 'Produce' },
  { id: 'meat', label: 'Meat & Seafood' },
  { id: 'dairy', label: 'Dairy & Eggs' },
  { id: 'bakery', label: 'Bakery' },
  { id: 'pantry', label: 'Pantry' },
  { id: 'spices', label: 'Spices' },
  { id: 'frozen', label: 'Frozen' },
  { id: 'drinks', label: 'Drinks' },
  { id: 'household', label: 'Household' },
  { id: 'other', label: 'Other' },
] as const;
export type Aisle = (typeof AISLES)[number]['id'];
const AISLE_IDS = AISLES.map((aisle) => aisle.id) as [Aisle, ...Aisle[]];
export const aisleSchema = z.enum(AISLE_IDS);
export const SHOPPING_LIMITS = { item: 200, rows: 500 } as const;

const KEEP = new Set(['asparagus', 'couscous', 'molasses', 'swiss', 'hummus', 'glass', 'grass']);

function singular(word: string): string {
  if (KEEP.has(word) || word.length <= 3) return word;
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.endsWith('oes')) return word.slice(0, -2);
  if (word.endsWith('s') && !/(ss|us|is)$/.test(word)) return word.slice(0, -1);
  return word;
}

/** The merge key (spec §5): lowercase, trimmed, spaces collapsed, last word singular. */
export function itemKey(item: string): string {
  const words = item.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  words[words.length - 1] = singular(words[words.length - 1]!);
  return words.join(' ');
}

export function aisleFor(key: string, choices: ReadonlyMap<string, Aisle>): Aisle {
  const chosen = choices.get(key);
  if (chosen) return chosen;
  const last = key.split(' ').at(-1) ?? key;
  return (AISLE_WORDS[key] ?? AISLE_WORDS[last] ?? 'other') as Aisle;
}

export type ShoppingRow = {
  id: string;
  item: string;
  item_key: string;
  quantity: number | null;
  quantity_max: number | null;
  unit: Unit | null;
  note: string | null;
  aisle: Aisle;
  recipe_id: string | null;
  recipe_title: string | null;
  checked_at: string | null;
  /** Null until the server stamps the row: added on this phone, not yet synced. */
  created_at: string | null;
  updated_at: string | null;
};
export type NewShoppingRow = Omit<ShoppingRow, 'id' | 'checked_at' | 'created_at' | 'updated_at'>;
export type ShoppingLine = {
  key: string;
  item: string;
  aisle: Aisle;
  amount: string;
  recipes: { id: string; title: string }[];
  handAdded: boolean;
  checked: boolean;
  rowIds: string[];
};

type Sum = { value: number; max: number; ranged: boolean; unit: Unit | null };

function add(sum: Sum | undefined, value: number, max: number | null, unit: Unit | null): Sum {
  const next = sum ?? { value: 0, max: 0, ranged: false, unit };
  next.value += value;
  next.max += max ?? value;
  next.ranged ||= max !== null;
  return next;
}

const show = (sum: Sum) =>
  formatTotal({ value: sum.value, max: sum.ranged ? sum.max : null, unit: sum.unit });

/** FR-33: one line per item, amounts added where units allow. */
function amountOf(rows: ShoppingRow[]): string {
  let count: Sum | undefined;
  let volume: { sum: Sum; per: number } | undefined;
  let weight: { sum: Sum; per: number } | undefined;
  const others = new Map<Unit, Sum>();
  let toTaste = false;
  for (const row of rows) {
    if (row.quantity === null) {
      toTaste = true;
      continue;
    }
    if (row.unit === null) {
      count = add(count, row.quantity, row.quantity_max, null);
      continue;
    }
    const base = baseOf(row.unit);
    if (base) {
      // Added in ml or g, then shown in the unit of the first row of that kind.
      const slot = base.kind === 'volume' ? volume : weight;
      const per = slot?.per ?? base.per;
      const ratio = base.per / per;
      const sum = add(
        slot?.sum ?? { value: 0, max: 0, ranged: false, unit: row.unit },
        row.quantity * ratio,
        row.quantity_max === null ? null : row.quantity_max * ratio,
        row.unit,
      );
      if (base.kind === 'volume') volume = { sum, per };
      else weight = { sum, per };
      continue;
    }
    others.set(row.unit, add(others.get(row.unit), row.quantity, row.quantity_max, row.unit));
  }
  const parts = [
    count && show(count),
    volume && show(volume.sum),
    weight && show(weight.sum),
    ...[...others.values()].map(show),
  ].filter((part): part is string => Boolean(part));
  if (toTaste && parts.length > 0) parts.push('to taste');
  return parts.join(' + ');
}

// An unsynced row (no server time yet) is the newest one.
const LATEST = '\uffff';
const time = (value: string | null) => value ?? LATEST;

const ORDER = new Map(AISLES.map((aisle, index) => [aisle.id, index]));

export function shoppingLines(rows: ShoppingRow[]): ShoppingLine[] {
  const groups = new Map<string, ShoppingRow[]>();
  for (const row of rows) groups.set(row.item_key, [...(groups.get(row.item_key) ?? []), row]);
  const lines = [...groups.entries()].map(([key, group]) => {
    const byAge = [...group].sort((a, b) => time(a.created_at).localeCompare(time(b.created_at)));
    const latest = [...group].sort((a, b) =>
      time(b.updated_at).localeCompare(time(a.updated_at)),
    )[0]!;
    const recipes = new Map<string, string>();
    for (const row of byAge) {
      if (row.recipe_id && !recipes.has(row.recipe_id))
        recipes.set(row.recipe_id, row.recipe_title ?? '');
    }
    return {
      key,
      item: byAge[0]!.item,
      aisle: latest.aisle,
      amount: amountOf(byAge),
      recipes: [...recipes].map(([id, title]) => ({ id, title })),
      handAdded: group.some((row) => row.recipe_id === null),
      checked: group.every((row) => row.checked_at !== null),
      rowIds: byAge.map((row) => row.id),
    };
  });
  return lines.sort(
    (a, b) => ORDER.get(a.aisle)! - ORDER.get(b.aisle)! || a.item.localeCompare(b.item),
  );
}

function newRow(
  ingredient: Pick<Ingredient, 'raw' | 'item' | 'quantity' | 'quantity_max' | 'unit' | 'note'>,
  recipe: { id: string; title: string } | null,
  choices: ReadonlyMap<string, Aisle>,
): NewShoppingRow {
  const item = (ingredient.item.trim() || ingredient.raw.trim()).slice(0, SHOPPING_LIMITS.item);
  const key = itemKey(item);
  return {
    item,
    item_key: key,
    quantity: ingredient.quantity,
    quantity_max: ingredient.quantity_max,
    unit: ingredient.unit,
    note: ingredient.note,
    aisle: aisleFor(key, choices),
    recipe_id: recipe?.id ?? null,
    recipe_title: recipe?.title ?? null,
  };
}

/** FR-32: the chosen ingredient lines at the viewed servings; headings skipped. */
export function addRows(
  recipe: { id: string; title: string; ingredients: Ingredient[] },
  factor: number,
  chosen: ReadonlySet<string>,
  choices: ReadonlyMap<string, Aisle>,
): NewShoppingRow[] {
  return recipe.ingredients
    .filter((line) => !line.heading && chosen.has(line.id) && (line.item.trim() || line.raw.trim()))
    .map((line) => newRow(scaleIngredient(line, factor), recipe, choices));
}

/** FR-35: a typed item, read like a recipe line ("2 lemons"). */
export function typedRow(text: string, choices: ReadonlyMap<string, Aisle>): NewShoppingRow | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > SHOPPING_LIMITS.item) return null;
  return newRow(parseIngredientLine(trimmed), null, choices);
}

// Same shape as imports.ts's timestamps.
const timestamp = z.iso.datetime({ offset: true });
const quantity = z.number().nonnegative().max(100_000);

export const shoppingItemPutSchema = z.strictObject({
  id: z.guid(),
  household_id: z.guid(),
  item: z.string().trim().min(1).max(SHOPPING_LIMITS.item),
  item_key: z.string().min(1).max(SHOPPING_LIMITS.item),
  quantity: quantity.nullable().optional(),
  quantity_max: quantity.nullable().optional(),
  unit: z.enum(UNITS).nullable().optional(),
  note: z.string().max(200).nullable().optional(),
  aisle: aisleSchema,
  recipe_id: z.guid().nullable().optional(),
  recipe_title: z.string().max(TITLE_MAX).nullable().optional(),
  checked_at: timestamp.nullable().optional(),
  deleted_at: timestamp.nullable().optional(),
});
export const shoppingItemPatchSchema = z.strictObject({
  id: z.guid(),
  aisle: aisleSchema.optional(),
  checked_at: timestamp.nullable().optional(),
  deleted_at: timestamp.nullable().optional(),
});
export const SHOPPING_ITEM_CLIENT_FIELDS = [
  'household_id',
  'item',
  'item_key',
  'quantity',
  'quantity_max',
  'unit',
  'note',
  'aisle',
  'recipe_id',
  'recipe_title',
  'checked_at',
  'deleted_at',
] as const;

export const aisleChoicePutSchema = z.strictObject({
  id: z.guid(),
  household_id: z.guid(),
  item_key: z.string().min(1).max(SHOPPING_LIMITS.item),
  aisle: aisleSchema,
  deleted_at: timestamp.nullable().optional(),
});
export const aisleChoicePatchSchema = z.strictObject({ id: z.guid(), aisle: aisleSchema });
export const AISLE_CHOICE_CLIENT_FIELDS = [
  'household_id',
  'item_key',
  'aisle',
  'deleted_at',
] as const;
