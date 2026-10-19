# Shopping List (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One shared, offline-first shopping list per household. Ingredients are added from recipes (choosing which), merged by item, grouped by aisle, and ticked off while shopping (FR-31–FR-35).

**Architecture:** Each added ingredient or typed item is a row in a new tenant table, `shopping_items`. The screen merges rows into lines with a pure `shoppingLines()` in `packages/domain`. Aisles come from a built-in word list, overridden by `aisle_choices` rows the household writes. Everything goes through the existing local-first path:
- PowerSync local writes;
- the upload queue, through `/api/upload` and `applyOps` under RLS;
- sync streams that mirror RLS.

**Tech Stack:** TypeScript, zod, Vitest, Postgres 17 RLS (dbmate), PowerSync, Hono, Expo Router / React Native Web, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-18-shopping-list-design.md`

## Global Constraints

- **Aisle ids and order:** `produce` Produce, `meat` Meat & Seafood, `dairy` Dairy & Eggs, `bakery` Bakery, `pantry` Pantry, `spices` Spices, `frozen` Frozen, `drinks` Drinks, `household` Household, `other` Other.
- **Limits:** `item` 1–200 characters; at most **500** live rows per household. When full: "Your list is full. Clear ticked items first."
- **Copy:**
  - tab name "Shopping list", or "Shopping list, N to buy";
  - sheet title "Add to shopping list", button "Add N items";
  - banner "Added N items to your list";
  - field label "Add an item";
  - section "Got it", buttons "Clear ticked" and "Clear list";
  - confirm "Clear the whole shopping list?";
  - empty state "Your list is empty. Add ingredients from a recipe, or type an item above.";
  - tick names "Got <item>" / "Need <item>", more button "More for <item>";
  - "For", "Added by hand", "Move to aisle", "Remove", "Remove items from <recipe title>".
- **Viewers:** see lines and "For" only (rule 4); RLS refuses their writes.
- **Rule 5:** soft delete only, except the 30-day purge, which also covers `shopping_items`.
- **Rule 6:** sync streams mirror the select policies.
- **Rule 1:** both tables are added to `apps/api/tests/rls/registry.ts`, with seed rows for households A and B.
- **UI (ADR-0017):** screens use `src/ui` and `src/theme`; no color literals; no `react-native` `Text`/`TextInput` outside `src/ui`.
- **Never run `pnpm db:reset`.** After stack changes, `docker compose restart sync`. Insert new seed rows into the local db by hand, not by reseeding.
- Commits use Conventional Commits with FR ids and end with the Co-Authored-By line.

## Review Focus

1. **A recipe in US units plus one in metric for the same item**, such as "1 cup milk" and "200 ml milk". The line must show one sensible total in the first row's unit, not "1 cup + 200 ml" and not NaN. Pinned in Task 1: `shoppingLines` "adds US and metric volumes in the first row's unit".
2. **Unparsed or unit-only lines**, such as "Salt and pepper to taste", or "2 cups" with an empty item. These must still add with a non-empty item, and must not throw or produce an empty line. Pinned in Task 1: `addRows` "uses the raw text when the item is empty".
3. **A ticked line gains a new row from another recipe.** It must reappear unticked in its aisle, not stay hidden in Got it. Pinned in Task 1: `shoppingLines` "is ticked only when every row is".
4. **Two phones choosing an aisle for the same item offline.** Both uploads must succeed and leave one choice, not a unique-key rejection that leaves the queue stuck. Pinned in Task 2: API test "a second aisle choice for the same item updates the first".
5. **A Viewer opening the list** must see no tick, field, More actions or clear buttons, and a Viewer's write must be refused by RLS. Pinned in Task 2 (RLS) and Task 4 (e2e "a Viewer sees the list with no controls").

## Ruling carried from planning

**`aisle_choices.id` is a normal client UUID, not a derived UUID v5** (spec §4). Deriving one in the browser needs extra hashing code. Instead, the API upserts a put on `(household_id, item_key)`, so two phones choosing offline still leave one row, and the last save wins. The losing phone's local row is replaced by the server's on the next sync. This is recorded as a ruling during execution.

---

### Task 1: Domain: items, aisles, merging, schemas

**Files:**
- Create: `packages/domain/src/shopping.ts`, `packages/domain/src/aisles.ts`, `packages/domain/src/shopping.test.ts`
- Modify: `packages/domain/src/cooking.ts` (export `formatTotal`), `packages/domain/src/index.ts` (export `./shopping` and the schemas)

**Interfaces:**
- Produces:
  - `AISLES: readonly { id: Aisle; label: string }[]`, `type Aisle`, `aisleSchema`;
  - `itemKey(item: string): string`;
  - `aisleFor(key: string, choices: ReadonlyMap<string, Aisle>): Aisle`;
  - `type ShoppingRow = { id: string; item: string; item_key: string; quantity: number | null; quantity_max: number | null; unit: Unit | null; note: string | null; aisle: Aisle; recipe_id: string | null; recipe_title: string | null; checked_at: string | null; created_at: string; updated_at: string }`;
  - `type ShoppingLine = { key: string; item: string; aisle: Aisle; amount: string; recipes: { id: string; title: string }[]; handAdded: boolean; checked: boolean; rowIds: string[] }`;
  - `shoppingLines(rows: ShoppingRow[]): ShoppingLine[]`, sorted by aisle order, then by item;
  - `type NewShoppingRow = Omit<ShoppingRow, 'id' | 'checked_at' | 'created_at' | 'updated_at'>`;
  - `addRows(recipe: { id: string; title: string; ingredients: Ingredient[] }, factor: number, chosen: ReadonlySet<string>, choices: ReadonlyMap<string, Aisle>): NewShoppingRow[]`;
  - `typedRow(text: string, choices: ReadonlyMap<string, Aisle>): NewShoppingRow | null`;
  - `SHOPPING_LIMITS = { item: 200, rows: 500 }`;
  - `shoppingItemPutSchema`, `shoppingItemPatchSchema`, `SHOPPING_ITEM_CLIENT_FIELDS`;
  - `aisleChoicePutSchema`, `aisleChoicePatchSchema`, `AISLE_CHOICE_CLIENT_FIELDS`;
  - in `cooking.ts`: `formatTotal(amount: Amount): string`.

- [ ] **Step 1: Write the failing tests**

`packages/domain/src/shopping.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Ingredient } from './ingredients';
import {
  addRows,
  aisleFor,
  itemKey,
  shoppingItemPutSchema,
  shoppingLines,
  typedRow,
  type ShoppingRow,
} from './shopping';

let n = 0;
function row(over: Partial<ShoppingRow>): ShoppingRow {
  n += 1;
  return {
    id: `r${n}`,
    item: 'onion',
    item_key: 'onion',
    quantity: null,
    quantity_max: null,
    unit: null,
    note: null,
    aisle: 'produce',
    recipe_id: null,
    recipe_title: null,
    checked_at: null,
    created_at: `2026-10-18T10:00:${String(n).padStart(2, '0')}Z`,
    updated_at: `2026-10-18T10:00:${String(n).padStart(2, '0')}Z`,
    ...over,
  };
}

describe('itemKey', () => {
  it.each([
    ['Onions', 'onion'],
    ['  red   onions ', 'red onion'],
    ['berries', 'berry'],
    ['tomatoes', 'tomato'],
    ['glass', 'glass'],
    ['hummus', 'hummus'],
    ['asparagus', 'asparagus'],
    ['couscous', 'couscous'],
    ['molasses', 'molasses'],
    ['eggs', 'egg'],
  ])('%s → %s', (input, key) => expect(itemKey(input)).toBe(key));
});

describe('aisleFor', () => {
  it('matches the whole key, then its last word, then falls back to other', () => {
    expect(aisleFor('onion', new Map())).toBe('produce');
    expect(aisleFor('red onion', new Map())).toBe('produce');
    expect(aisleFor('milk', new Map())).toBe('dairy');
    expect(aisleFor('paper towel', new Map())).toBe('household');
    expect(aisleFor('zzz unknown', new Map())).toBe('other');
  });
  it('a household choice beats the guess', () => {
    expect(aisleFor('onion', new Map([['onion', 'frozen']]))).toBe('frozen');
  });
});

describe('shoppingLines', () => {
  it('merges counts by item and lists each recipe once', () => {
    const lines = shoppingLines([
      row({ quantity: 1, recipe_id: 'a', recipe_title: 'Soup' }),
      row({ item: 'onions', quantity: 2, recipe_id: 'b', recipe_title: 'Stew' }),
      row({ quantity: 1, recipe_id: 'a', recipe_title: 'Soup' }),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      item: 'onion',
      amount: '4',
      handAdded: false,
      checked: false,
      recipes: [
        { id: 'a', title: 'Soup' },
        { id: 'b', title: 'Stew' },
      ],
    });
    expect(lines[0]!.rowIds).toHaveLength(3);
  });

  it('adds US and metric volumes in the first row’s unit', () => {
    const [line] = shoppingLines([
      row({ item: 'milk', item_key: 'milk', aisle: 'dairy', quantity: 1, unit: 'cup' }),
      row({ item: 'milk', item_key: 'milk', aisle: 'dairy', quantity: 200, unit: 'ml' }),
    ]);
    expect(line!.amount).toBe('1¾ cups');
  });

  it('adds weights, keeps other units apart, and joins kinds in a fixed order', () => {
    const [line] = shoppingLines([
      row({ item: 'tomatoes', item_key: 'tomato', quantity: 1, unit: 'can' }),
      row({ item: 'tomatoes', item_key: 'tomato', quantity: 200, unit: 'g' }),
      row({ item: 'tomatoes', item_key: 'tomato', quantity: 2 }),
      row({ item: 'tomatoes', item_key: 'tomato', quantity: 300, unit: 'g' }),
      row({ item: 'tomatoes', item_key: 'tomato' }),
    ]);
    expect(line!.amount).toBe('2 + 500 g + 1 can + to taste');
  });

  it('adds both ends of ranges', () => {
    const [line] = shoppingLines([row({ quantity: 1, quantity_max: 2 }), row({ quantity: 1 })]);
    expect(line!.amount).toBe('2–3');
  });

  it('shows no amount when no row has one', () => {
    expect(shoppingLines([row({ item: 'salt', item_key: 'salt', aisle: 'spices' })])[0]!.amount).toBe(
      '',
    );
  });

  it('is ticked only when every row is', () => {
    const ticked = '2026-10-18T11:00:00Z';
    expect(shoppingLines([row({ checked_at: ticked }), row({ checked_at: ticked })])[0]!.checked).toBe(
      true,
    );
    expect(shoppingLines([row({ checked_at: ticked }), row({})])[0]!.checked).toBe(false);
  });

  it('takes the aisle of the most recently updated row and sorts by aisle, then item', () => {
    const lines = shoppingLines([
      row({ item: 'milk', item_key: 'milk', aisle: 'dairy', updated_at: '2026-10-18T09:00:00Z' }),
      row({ item: 'milk', item_key: 'milk', aisle: 'frozen', updated_at: '2026-10-18T12:00:00Z' }),
      row({ item: 'basil', item_key: 'basil', aisle: 'produce' }),
      row({ item: 'apple', item_key: 'apple', aisle: 'produce' }),
    ]);
    expect(lines.map((line) => [line.item, line.aisle])).toEqual([
      ['apple', 'produce'],
      ['basil', 'produce'],
      ['milk', 'frozen'],
    ]);
  });

  it('marks typed items as hand added', () => {
    expect(shoppingLines([row({})])[0]!.handAdded).toBe(true);
  });
});

const ing = (over: Partial<Ingredient>): Ingredient => ({
  id: 'i',
  raw: '',
  quantity: null,
  quantity_max: null,
  unit: null,
  item: '',
  note: null,
  heading: false,
  ...over,
});

describe('addRows', () => {
  const recipe = {
    id: 'rec1',
    title: 'Soup',
    ingredients: [
      ing({ id: 'h', raw: 'For the soup', heading: true }),
      ing({ id: 'a', raw: '2 onions, diced', quantity: 2, item: 'onions', note: 'diced' }),
      ing({ id: 'b', raw: '1 cup stock', quantity: 1, unit: 'cup', item: 'stock' }),
      ing({ id: 'c', raw: 'Salt and pepper to taste' }),
    ],
  };

  it('scales the chosen lines, skips headings, and works out aisles', () => {
    const rows = addRows(recipe, 2, new Set(['h', 'a', 'b']), new Map());
    expect(rows).toEqual([
      expect.objectContaining({
        item: 'onions',
        item_key: 'onion',
        quantity: 4,
        note: 'diced',
        aisle: 'produce',
        recipe_id: 'rec1',
        recipe_title: 'Soup',
      }),
      expect.objectContaining({ item: 'stock', quantity: 2, unit: 'cup', aisle: 'pantry' }),
    ]);
  });

  it('uses the raw text when the item is empty', () => {
    const [only] = addRows(recipe, 1, new Set(['c']), new Map());
    expect(only).toMatchObject({ item: 'Salt and pepper to taste', quantity: null });
    expect(only!.item_key).toBe('salt and pepper to taste');
  });
});

it('typedRow reads the amount and refuses blank or over-long text', () => {
  expect(typedRow('2 lemons', new Map())).toMatchObject({
    item: 'lemons',
    item_key: 'lemon',
    quantity: 2,
    aisle: 'produce',
    recipe_id: null,
  });
  expect(typedRow('   ', new Map())).toBeNull();
  expect(typedRow('x'.repeat(201), new Map())).toBeNull();
});

it('the put schema refuses a bad aisle and a 201-character item', () => {
  const base = {
    id: '00000000-0000-4000-8000-000000000001',
    household_id: '00000000-0000-4000-8000-000000000002',
    item: 'onion',
    item_key: 'onion',
    aisle: 'produce',
  };
  expect(shoppingItemPutSchema.safeParse(base).success).toBe(true);
  expect(shoppingItemPutSchema.safeParse({ ...base, aisle: 'garden' }).success).toBe(false);
  expect(shoppingItemPutSchema.safeParse({ ...base, item: 'x'.repeat(201) }).success).toBe(false);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run packages/domain/src/shopping.test.ts`
Expected: FAIL. `./shopping` can't be found.

- [ ] **Step 3: Implement**

In `packages/domain/src/cooking.ts`, add below `displayIngredient`:

```ts
/** A merged amount on the shopping list (FR-33): stepped, formatted, with its unit. */
export function formatTotal(amount: Amount): string {
  const stepped =
    amount.unit !== null && (US_UNITS.has(amount.unit) || METRIC_UNITS.has(amount.unit))
      ? stepUnits(amount)
      : amount;
  if (stepped === 'pinch') return 'a pinch';
  const value = formatAmount(stepped.value, stepped.unit);
  const shown = stepped.max === null ? value : `${value}–${formatAmount(stepped.max, stepped.unit)}`;
  return stepped.unit ? `${shown} ${unitLabel(stepped.unit, stepped.max === null ? value : 'range')}` : shown;
}

/** Millilitres or grams per unit, for adding amounts of the same kind. */
export function baseOf(unit: Unit): { kind: 'volume' | 'weight'; per: number } | null {
  if (ML[unit] !== undefined) return { kind: 'volume', per: ML[unit]! };
  if (GRAMS[unit] !== undefined) return { kind: 'weight', per: GRAMS[unit]! };
  return null;
}
```

`packages/domain/src/aisles.ts`:

```ts
// Built-in aisle guesses (shopping spec §5). Keys are itemKey() forms:
// lowercase, last word singular. Matched on the whole key, then on its last word.
const WORDS: Record<string, readonly string[]> = {
  produce: [
    'apple', 'banana', 'orange', 'lemon', 'lime', 'grape', 'berry', 'strawberry', 'blueberry',
    'raspberry', 'blackberry', 'cherry', 'peach', 'pear', 'plum', 'mango', 'pineapple', 'melon',
    'watermelon', 'kiwi', 'avocado', 'tomato', 'potato', 'sweet potato', 'onion', 'red onion',
    'shallot', 'scallion', 'green onion', 'leek', 'garlic', 'ginger', 'carrot', 'celery',
    'cucumber', 'zucchini', 'squash', 'pumpkin', 'eggplant', 'bell pepper', 'jalapeño',
    'jalapeno', 'chili', 'lettuce', 'spinach', 'kale', 'arugula', 'cabbage', 'broccoli',
    'cauliflower', 'brussels sprout', 'asparagus', 'green bean', 'pea', 'corn', 'mushroom',
    'radish', 'beet', 'turnip', 'parsnip', 'fennel', 'basil', 'cilantro', 'parsley', 'mint',
    'dill', 'rosemary', 'thyme', 'sage', 'chive', 'salad',
  ],
  meat: [
    'chicken', 'chicken breast', 'chicken thigh', 'beef', 'ground beef', 'steak', 'pork',
    'pork chop', 'bacon', 'ham', 'sausage', 'turkey', 'lamb', 'veal', 'duck', 'fish', 'salmon',
    'tuna', 'cod', 'tilapia', 'shrimp', 'prawn', 'scallop', 'crab', 'lobster', 'mussel', 'clam',
    'anchovy', 'prosciutto', 'chorizo', 'pepperoni',
  ],
  dairy: [
    'milk', 'cream', 'heavy cream', 'half-and-half', 'butter', 'cheese', 'cheddar', 'mozzarella',
    'parmesan', 'feta', 'ricotta', 'cream cheese', 'cottage cheese', 'yogurt', 'sour cream',
    'egg', 'buttermilk', 'ghee',
  ],
  bakery: ['bread', 'baguette', 'bun', 'roll', 'tortilla', 'pita', 'naan', 'bagel', 'croissant', 'brioche'],
  pantry: [
    'flour', 'sugar', 'brown sugar', 'powdered sugar', 'rice', 'pasta', 'spaghetti', 'noodle',
    'oat', 'oatmeal', 'cereal', 'quinoa', 'couscous', 'lentil', 'bean', 'chickpea', 'black bean',
    'kidney bean', 'stock', 'broth', 'chicken stock', 'vegetable stock', 'oil', 'olive oil',
    'vegetable oil', 'canola oil', 'vinegar', 'soy sauce', 'honey', 'maple syrup', 'syrup',
    'molasses', 'peanut butter', 'jam', 'jelly', 'ketchup', 'mustard', 'mayonnaise', 'hot sauce',
    'salsa', 'tomato paste', 'tomato sauce', 'coconut milk', 'baking powder', 'baking soda',
    'yeast', 'cornstarch', 'chocolate', 'chocolate chip', 'cocoa', 'vanilla', 'vanilla extract',
    'nut', 'almond', 'walnut', 'pecan', 'peanut', 'cashew', 'raisin', 'breadcrumb', 'cracker',
    'chip', 'tahini',
  ],
  spices: [
    'salt', 'pepper', 'black pepper', 'cinnamon', 'cumin', 'paprika', 'smoked paprika', 'oregano',
    'chili powder', 'cayenne', 'nutmeg', 'clove', 'turmeric', 'curry powder', 'garam masala',
    'bay leaf', 'red pepper flake', 'garlic powder', 'onion powder', 'allspice', 'cardamom',
    'coriander', 'mustard seed', 'sesame seed', 'italian seasoning',
  ],
  frozen: ['ice cream', 'frozen pea', 'frozen corn', 'frozen berry', 'ice', 'frozen spinach', 'puff pastry'],
  drinks: ['water', 'sparkling water', 'juice', 'orange juice', 'coffee', 'tea', 'wine', 'red wine', 'white wine', 'beer', 'soda'],
  household: [
    'paper towel', 'toilet paper', 'napkin', 'foil', 'aluminum foil', 'plastic wrap',
    'parchment paper', 'trash bag', 'dish soap', 'detergent', 'sponge',
  ],
};

export const AISLE_WORDS: Record<string, string> = Object.fromEntries(
  Object.entries(WORDS).flatMap(([aisle, words]) => words.map((word) => [word, aisle])),
);
```

Whole-key matches beat last-word ones, so "bell pepper" is Produce while "black pepper" and "pepper" are Spices. "chocolate chip" is Pantry, not by "chip" alone. "clove" sits in Spices; "garlic clove" falls back to "clove", which is acceptable. Note it in ADR-0019's consequences.

`packages/domain/src/shopping.ts`:

```ts
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
  created_at: string;
  updated_at: string;
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
      const sum = add(slot?.sum ?? { value: 0, max: 0, ranged: false, unit: row.unit }, row.quantity * ratio,
        row.quantity_max === null ? null : row.quantity_max * ratio, row.unit);
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

const ORDER = new Map(AISLES.map((aisle, index) => [aisle.id, index]));

export function shoppingLines(rows: ShoppingRow[]): ShoppingLine[] {
  const groups = new Map<string, ShoppingRow[]>();
  for (const row of rows) groups.set(row.item_key, [...(groups.get(row.item_key) ?? []), row]);
  const lines = [...groups.entries()].map(([key, group]) => {
    const byAge = [...group].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const latest = [...group].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0]!;
    const recipes = new Map<string, string>();
    for (const row of byAge) {
      if (row.recipe_id && !recipes.has(row.recipe_id)) recipes.set(row.recipe_id, row.recipe_title ?? '');
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
  'household_id', 'item', 'item_key', 'quantity', 'quantity_max', 'unit', 'note', 'aisle',
  'recipe_id', 'recipe_title', 'checked_at', 'deleted_at',
] as const;

export const aisleChoicePutSchema = z.strictObject({
  id: z.guid(),
  household_id: z.guid(),
  item_key: z.string().min(1).max(SHOPPING_LIMITS.item),
  aisle: aisleSchema,
  deleted_at: timestamp.nullable().optional(),
});
export const aisleChoicePatchSchema = z.strictObject({ id: z.guid(), aisle: aisleSchema });
export const AISLE_CHOICE_CLIENT_FIELDS = ['household_id', 'item_key', 'aisle', 'deleted_at'] as const;
```

Add `export * from './shopping';` to `packages/domain/src/index.ts`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run packages/domain && pnpm typecheck`
Expected: PASS.

`1 cup + 200 ml` is about 436.6 ml, or 1.85 cups, which shows as `1¾ cups` with `formatAmount`'s nearest eighth. If the rounding gives `1⅞ cups` instead, the arithmetic is right: change the expectation to the formatted value and record a ruling.

- [ ] **Step 5: Commit**

```bash
git add packages/domain
git commit -m "feat(domain): shopping list items, aisles and merging (FR-31–FR-35)"
```

---

### Task 2: Database, sync, upload and purge

**Files:**
- Create: `db/migrations/20261024000000_create_shopping_list.sql`
- Modify: `db/seed.sql`, `powersync/sync-config.yaml`, `apps/api/src/upload/ops.ts`, `apps/api/src/app.ts` (purge)
- Modify: `apps/api/tests/rls/registry.ts`, `apps/api/tests/rls/roles.test.ts`
- Test: `apps/api/tests/rls/shopping.test.ts`, `apps/api/tests/upload/shopping.test.ts`, `apps/api/src/upload/ops.test.ts` (if it exists, add the new tables to its table checks)

**Interfaces:**
- Consumes: `shoppingItemPutSchema`, `shoppingItemPatchSchema`, `aisleChoicePutSchema`, `aisleChoicePatchSchema`, `SHOPPING_LIMITS` from Task 1.
- Produces: tables `public.shopping_items` and `public.aisle_choices` (columns as in spec §4); the sync streams `household_shopping_items` and `household_aisle_choices`; upload accepts the tables `shopping_items` and `aisle_choices`; a full list rejects puts with the reason `list_full`.

- [ ] **Step 1: Write the failing RLS and API tests**

`apps/api/tests/rls/shopping.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SEED, signInAs } from '../../../../test-support/auth';
import { adminSql, as, refusalCode } from '../helpers/db';

const item = (householdId: string | null) => ({
  id: randomUUID(),
  household_id: householdId,
  item: 'onions',
  item_key: 'onion',
  aisle: 'produce',
});

describe('shopping list tables', () => {
  it('members add and tick; viewers read but cannot write', async () => {
    const member = await signInAs(SEED.memberA);
    const viewer = await signInAs(SEED.viewerA);
    const row = item(member.householdId);
    await as(member, (tx) => tx`insert into public.shopping_items ${tx(row)}`);
    await as(member, (tx) => tx`update public.shopping_items set checked_at = now() where id = ${row.id}`);
    expect(await as(viewer, (tx) => tx`select id from public.shopping_items where id = ${row.id}`)).toHaveLength(1);
    expect(
      await refusalCode(as(viewer, (tx) => tx`insert into public.shopping_items ${tx(item(viewer.householdId))}`)),
    ).toBe('42501');
    const updated = await as(viewer, (tx) => tx`update public.shopping_items set checked_at = null where id = ${row.id} returning id`);
    expect(updated).toHaveLength(0);
  });

  it('another household cannot read or write the rows', async () => {
    const member = await signInAs(SEED.memberA);
    const other = await signInAs(SEED.adminB);
    const row = item(member.householdId);
    await as(member, (tx) => tx`insert into public.shopping_items ${tx(row)}`);
    expect(await as(other, (tx) => tx`select id from public.shopping_items where id = ${row.id}`)).toHaveLength(0);
    expect(
      await refusalCode(as(other, (tx) => tx`insert into public.shopping_items ${tx(item(member.householdId))}`)),
    ).toBe('42501');
  });

  it('an aisle outside the list and a second choice for the same item are refused by the database', async () => {
    const member = await signInAs(SEED.memberA);
    expect(
      await refusalCode(as(member, (tx) => tx`insert into public.shopping_items ${tx({ ...item(member.householdId), aisle: 'garden' })}`)),
    ).toBe('23514');
    const key = `k-${randomUUID()}`;
    await as(member, (tx) => tx`insert into public.aisle_choices ${tx({ id: randomUUID(), household_id: member.householdId, item_key: key, aisle: 'frozen' })}`);
    expect(
      await refusalCode(as(member, (tx) => tx`insert into public.aisle_choices ${tx({ id: randomUUID(), household_id: member.householdId, item_key: key, aisle: 'dairy' })}`)),
    ).toBe('23505');
  });

  it('only rows deleted over 30 days ago can be hard-deleted', async () => {
    const member = await signInAs(SEED.memberA);
    const fresh = item(member.householdId);
    const old = item(member.householdId);
    await adminSql`insert into public.shopping_items ${adminSql({ ...fresh, deleted_at: new Date() })}`;
    await adminSql`insert into public.shopping_items ${adminSql(old)}`;
    await adminSql`update public.shopping_items set deleted_at = now() - interval '31 days' where id = ${old.id}`;
    const gone = await as(member, (tx) => tx<{ id: string }[]>`delete from public.shopping_items where id in (${fresh.id}, ${old.id}) returning id`);
    expect(gone.map((r) => r.id)).toEqual([old.id]);
  });
});
```

`apps/api/tests/upload/shopping.test.ts` (an API test through `/api/upload`; copy the `call`/`upload` helper from `apps/api/tests/upload/upload.test.ts` and use its exact name and signature):

```ts
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { env } from '../../../../test-support/env';
import { signInFresh, type Actor } from '../../../../test-support/auth';
import { adminSql } from '../helpers/db';

async function upload(actor: Actor, ops: unknown[]) {
  const response = await fetch(`${env.apiUrl}/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${actor.accessToken}` },
    body: JSON.stringify({ ops }),
  });
  return (await response.json()) as { results: { id: string; status: string; reason?: string }[] };
}
const fresh = () => signInFresh(`shop-${randomUUID()}@example.test`);

it('puts, ticks and soft-deletes a shopping item; refuses a bad aisle and a long item', async () => {
  const cook = await fresh();
  const id = randomUUID();
  const base = { household_id: cook.householdId, item: 'onions', item_key: 'onion', aisle: 'produce', quantity: 2 };
  const put = await upload(cook, [{ op: 'put', table: 'shopping_items', id, data: base }]);
  expect(put.results[0]!.status).toBe('applied');
  const tick = await upload(cook, [{ op: 'patch', table: 'shopping_items', id, data: { checked_at: new Date().toISOString() } }]);
  expect(tick.results[0]!.status).toBe('applied');
  const bad = await upload(cook, [
    { op: 'put', table: 'shopping_items', id: randomUUID(), data: { ...base, aisle: 'garden' } },
    { op: 'put', table: 'shopping_items', id: randomUUID(), data: { ...base, item: 'x'.repeat(201) } },
  ]);
  expect(bad.results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
});

it('a second aisle choice for the same item updates the first', async () => {
  const cook = await fresh();
  const data = { household_id: cook.householdId, item_key: 'onion', aisle: 'frozen' };
  const first = await upload(cook, [{ op: 'put', table: 'aisle_choices', id: randomUUID(), data }]);
  const second = await upload(cook, [{ op: 'put', table: 'aisle_choices', id: randomUUID(), data: { ...data, aisle: 'dairy' } }]);
  expect([first.results[0]!.status, second.results[0]!.status]).toEqual(['applied', 'applied']);
  const rows = await adminSql<{ aisle: string }[]>`
    select aisle from public.aisle_choices where household_id = ${cook.householdId} and item_key = 'onion'`;
  expect(rows).toEqual([{ aisle: 'dairy' }]);
});

it('a full list refuses new rows with list_full', async () => {
  const cook = await fresh();
  await adminSql`
    insert into public.shopping_items (id, household_id, item, item_key, aisle)
    select gen_random_uuid(), ${cook.householdId}, 'x', 'x', 'other' from generate_series(1, 500)`;
  const res = await upload(cook, [{ op: 'put', table: 'shopping_items', id: randomUUID(), data: { household_id: cook.householdId, item: 'one more', item_key: 'one more', aisle: 'other' } }]);
  expect(res.results[0]).toMatchObject({ status: 'rejected', reason: 'list_full' });
});

it('the trash purge also removes list rows deleted over 30 days ago', async () => {
  const cook = await fresh();
  const old = randomUUID();
  await adminSql`insert into public.shopping_items (id, household_id, item, item_key, aisle, deleted_at)
    values (${old}, ${cook.householdId}, 'x', 'x', 'other', now() - interval '31 days')`;
  const res = await fetch(`${env.apiUrl}/trash/purge`, { method: 'POST', headers: { Authorization: `Bearer ${cook.accessToken}` } });
  expect(res.status).toBe(200);
  expect(await adminSql`select 1 from public.shopping_items where id = ${old}`).toHaveLength(0);
});
```

Registry: add `'shopping_items'` and `'aisle_choices'` to `TENANT_TABLES`, and `household_id` to `TENANT_COLUMN`. `roles.test.ts`: add `shopping_items: ['DELETE', 'INSERT', 'SELECT', 'UPDATE']` and `aisle_choices: ['INSERT', 'SELECT', 'UPDATE']`.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run -c vitest.integration.config.ts apps/api/tests/rls/shopping.test.ts apps/api/tests/upload/shopping.test.ts`
Expected: FAIL (relation "public.shopping_items" does not exist; upload says `table_not_allowed`).

- [ ] **Step 3: Write the migration**

`db/migrations/20261024000000_create_shopping_list.sql`:

```sql
-- migrate:up
-- Shopping list (Phase 2, FR-31–FR-35; ADR-0019). Runs as app_owner.
-- One row per added ingredient or typed item; the app merges rows into lines.
-- Both tables are household data: RLS here, sync streams mirror the selects.

create table public.shopping_items (
  id uuid primary key, -- generated on the client
  household_id uuid not null references public.households (id),
  item text not null check (char_length(btrim(item)) between 1 and 200),
  item_key text not null check (char_length(item_key) between 1 and 200),
  quantity numeric check (quantity >= 0 and quantity <= 100000),
  quantity_max numeric check (quantity_max >= 0 and quantity_max <= 100000),
  unit text,
  note text check (char_length(note) <= 200),
  aisle text not null check (aisle in ('produce', 'meat', 'dairy', 'bakery', 'pantry', 'spices', 'frozen', 'drinks', 'household', 'other')),
  -- No foreign key: purging a recipe never breaks the list; the title is kept.
  recipe_id uuid,
  recipe_title text check (char_length(recipe_title) <= 200),
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  deleted_at timestamptz
);
create index shopping_items_household_id_idx on public.shopping_items (household_id);

create table public.aisle_choices (
  id uuid primary key,
  household_id uuid not null references public.households (id),
  item_key text not null check (char_length(item_key) between 1 and 200),
  aisle text not null check (aisle in ('produce', 'meat', 'dairy', 'bakery', 'pantry', 'spices', 'frozen', 'drinks', 'household', 'other')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  deleted_at timestamptz,
  unique (household_id, item_key)
);

create trigger shopping_items_stamp before insert or update on public.shopping_items
for each row execute function public.stamp_row();
create trigger aisle_choices_stamp before insert or update on public.aisle_choices
for each row execute function public.stamp_row();

-- Delete only for the 30-day purge (shopping_items_purge below).
grant select, insert, update, delete on public.shopping_items to authenticated;
grant select, insert, update on public.aisle_choices to authenticated;
alter table public.shopping_items enable row level security;
alter table public.aisle_choices enable row level security;

-- Mirrored by powersync/sync-config.yaml (household_shopping_items).
create policy shopping_items_select on public.shopping_items
for select to authenticated
using (household_id = (select public.auth_household_id()));
create policy shopping_items_insert on public.shopping_items
for insert to authenticated
with check (
  household_id = (select public.auth_household_id())
  and (select public.auth_household_role()) in ('admin', 'member')
);
create policy shopping_items_update on public.shopping_items
for update to authenticated
using (
  household_id = (select public.auth_household_id())
  and (select public.auth_household_role()) in ('admin', 'member')
)
with check (
  household_id = (select public.auth_household_id())
  and (select public.auth_household_role()) in ('admin', 'member')
);
create policy shopping_items_purge on public.shopping_items
for delete to authenticated
using (
  household_id = (select public.auth_household_id())
  and (select public.auth_household_role()) in ('admin', 'member')
  and deleted_at is not null
  and deleted_at < now() - interval '30 days'
);

-- Mirrored by powersync/sync-config.yaml (household_aisle_choices).
create policy aisle_choices_select on public.aisle_choices
for select to authenticated
using (household_id = (select public.auth_household_id()));
create policy aisle_choices_insert on public.aisle_choices
for insert to authenticated
with check (
  household_id = (select public.auth_household_id())
  and (select public.auth_household_role()) in ('admin', 'member')
);
create policy aisle_choices_update on public.aisle_choices
for update to authenticated
using (
  household_id = (select public.auth_household_id())
  and (select public.auth_household_role()) in ('admin', 'member')
)
with check (
  household_id = (select public.auth_household_id())
  and (select public.auth_household_role()) in ('admin', 'member')
);

-- migrate:down
drop table public.aisle_choices;
drop table public.shopping_items;
```

Check how the earlier migrations add a table to the PowerSync publication (grep `publication` in `db/migrations`). If tables are listed explicitly rather than `for all tables`, add `alter publication <name> add table public.shopping_items, public.aisle_choices;` and its reverse in `migrate:down`.

Seed (`db/seed.sql`, appended). Insert the same rows into the local db by hand, as in the production-hosting work:

```sql
-- One list row and one aisle choice per household, so the isolation suite's
-- checks of these tables are not vacuous.
insert into public.shopping_items (id, household_id, item, item_key, aisle) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000000a', 'Seed onions', 'seed onion', 'produce'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000000b', 'Seed onions', 'seed onion', 'produce');
insert into public.aisle_choices (id, household_id, item_key, aisle) values
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-00000000000a', 'seed onion', 'produce'),
  ('00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-00000000000b', 'seed onion', 'produce');
```

`powersync/sync-config.yaml`, appended:

```yaml
  # Mirrors shopping_items_select: household_id = auth_household_id(),
  # narrowed to rows not deleted, so cleared items leave the phone.
  household_shopping_items:
    auto_subscribe: true
    query: >-
      SELECT id, household_id, item, item_key, quantity, quantity_max, unit, note, aisle,
             recipe_id, recipe_title, checked_at,
             created_at, updated_at, updated_by, deleted_at
      FROM shopping_items
      WHERE household_id = auth.parameter('household_id') AND deleted_at IS NULL

  # Mirrors aisle_choices_select.
  household_aisle_choices:
    auto_subscribe: true
    query: >-
      SELECT id, household_id, item_key, aisle, created_at, updated_at, updated_by, deleted_at
      FROM aisle_choices
      WHERE household_id = auth.parameter('household_id') AND deleted_at IS NULL
```

- [ ] **Step 4: Upload and purge**

In `apps/api/src/upload/ops.ts`, import the four schemas and `SHOPPING_LIMITS`, and add the tables to `ALLOWED_TABLES` and `APPLY`:

```ts
async function applyShoppingItem(tx: UserTx, op: Op, candidate: Record<string, unknown>): Promise<Result> {
  if (op.op === 'put') {
    const parsed = shoppingItemPutSchema.safeParse(candidate);
    if (!parsed.success) return rejected(op, 'invalid');
    const { id, ...fields } = parsed.data;
    const [existing] = await tx`select 1 from public.shopping_items where id = ${id}`;
    if (!existing) {
      // FR-31 limit (spec §6): counted under RLS, so only the caller's household.
      const [{ live }] = await tx<{ live: number }[]>`
        select count(*)::int as live from public.shopping_items where deleted_at is null`;
      if (live >= SHOPPING_LIMITS.rows) return rejected(op, 'list_full');
    }
    const row = { ...fields, deleted_at: fields.deleted_at ?? null };
    await tx`
      insert into public.shopping_items ${tx({ id, ...row })}
      on conflict (id) do update set ${tx(row)}`;
    return applied(op);
  }
  const parsed = shoppingItemPatchSchema.safeParse(candidate);
  if (!parsed.success) return rejected(op, 'invalid');
  const { id, ...fields } = parsed.data;
  if (Object.keys(fields).length === 0) return applied(op);
  const rows = await tx`update public.shopping_items set ${tx(fields)} where id = ${id} returning id`;
  return rows.length === 0 ? rejected(op, 'not_found_or_forbidden') : applied(op);
}

async function applyAisleChoice(tx: UserTx, op: Op, candidate: Record<string, unknown>): Promise<Result> {
  if (op.op === 'put') {
    const parsed = aisleChoicePutSchema.safeParse(candidate);
    if (!parsed.success) return rejected(op, 'invalid');
    const { id, ...fields } = parsed.data;
    // Two phones choosing offline make two ids for one item: the key decides,
    // and the last save wins (plan ruling; spec §4 "derived id").
    await tx`
      insert into public.aisle_choices ${tx({ id, ...fields, deleted_at: fields.deleted_at ?? null })}
      on conflict (household_id, item_key) do update set aisle = excluded.aisle, deleted_at = excluded.deleted_at`;
    return applied(op);
  }
  const parsed = aisleChoicePatchSchema.safeParse(candidate);
  if (!parsed.success) return rejected(op, 'invalid');
  const rows = await tx`update public.aisle_choices set aisle = ${parsed.data.aisle} where id = ${parsed.data.id} returning id`;
  return rows.length === 0 ? rejected(op, 'not_found_or_forbidden') : applied(op);
}
```

In `apps/api/src/app.ts`'s purge route, inside the same `asUser` transaction and after the recipes delete, add:

```ts
      // Cleared list rows past 30 days (rule 5; shopping spec §4).
      await tx`delete from public.shopping_items where deleted_at < now() - interval '30 days'`;
```

Keep the route's response shape as it is.

- [ ] **Step 5: Restart the stack and run the backend suites**

Run: `pnpm dev:backend:test && docker compose restart sync`, then insert the seed rows by hand (`tail -n 8 db/seed.sql | docker compose exec -T db psql -U postgres -d app -v ON_ERROR_STOP=1 -q`). Then run `pnpm test:rls && pnpm test:api && npx vitest run apps/api`.
Expected: all PASS, including the new files, the isolation tests for both tables, `coverage`, and `roles`.

- [ ] **Step 6: Commit**

```bash
git add db powersync apps/api
git commit -m "feat(db): shopping list and aisle choice tables, sync, upload and purge (FR-31–FR-35)"
```

---

### Task 3: App data: local schema, repository, hooks, upload fields

**Files:**
- Modify: `apps/mobile/src/db/schema.ts`, `apps/mobile/src/sync/upload.ts`
- Create: `apps/mobile/src/shopping/repository.ts`, `apps/mobile/src/shopping/repository.test.ts`, `apps/mobile/src/shopping/hooks.ts`
- Test: `apps/mobile/src/sync/upload.test.ts` (add one case)

**Interfaces:**
- Consumes: `addRows`, `typedRow`, `shoppingLines`, `aisleFor`, `SHOPPING_LIMITS`, `SHOPPING_ITEM_CLIENT_FIELDS`, `AISLE_CHOICE_CLIENT_FIELDS`, and the `Aisle` and `NewShoppingRow` types from Task 1.
- Produces (repository; each takes `db` and `claims`, and refuses Viewers with `Error('Viewers cannot change the shopping list')`):
  - `addShoppingRows(db, claims, rows: NewShoppingRow[]): Promise<'added' | 'full'>`;
  - `setTicked(db, claims, rowIds: string[], ticked: boolean): Promise<void>`;
  - `removeRows(db, claims, rowIds: string[]): Promise<void>`;
  - `clearTicked(db, claims): Promise<void>`;
  - `clearList(db, claims): Promise<void>`;
  - `moveToAisle(db, claims, itemKey: string, aisle: Aisle): Promise<void>`.
- Produces (SQL constants): `SHOPPING_ROWS_SQL` and `AISLE_CHOICES_SQL`.
- Produces (hooks, in `hooks.ts`): `useShoppingLines(): ShoppingLine[]`, `useAisleChoices(): Map<string, Aisle>` and `useToBuyCount(): number`.

- [ ] **Step 1: Write the failing tests**

`apps/mobile/src/shopping/repository.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { addShoppingRows, clearList, clearTicked, moveToAisle, removeRows, setTicked } from './repository';

type Call = { sql: string; params: unknown[] };
function fakeDb(answers: { live?: number; choice?: { id: string } | null } = {}) {
  const calls: Call[] = [];
  return {
    calls,
    db: {
      execute: async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        return { rowsAffected: 1 } as never;
      },
      getOptional: async (sql: string) =>
        (sql.includes('count(*)') ? { live: answers.live ?? 0 } : (answers.choice ?? null)) as never,
    },
  };
}
const member = { userId: 'u1', householdId: 'h1', role: 'member' as const };
const viewer = { ...member, role: 'viewer' as const };
const onion = {
  item: 'onions', item_key: 'onion', quantity: 2, quantity_max: null, unit: null, note: null,
  aisle: 'produce' as const, recipe_id: 'r1', recipe_title: 'Soup',
};

describe('shopping list writes', () => {
  it('inserts each row with the household id', async () => {
    const { db, calls } = fakeDb();
    expect(await addShoppingRows(db, member, [onion])).toBe('added');
    expect(calls[0]!.sql).toMatch(/^insert into shopping_items/);
    expect(calls[0]!.params).toEqual(expect.arrayContaining(['h1', 'onions', 'onion', 2, 'produce', 'r1', 'Soup']));
  });

  it('refuses to go past 500 live rows', async () => {
    const { db, calls } = fakeDb({ live: 499 });
    expect(await addShoppingRows(db, member, [onion, onion])).toBe('full');
    expect(calls).toHaveLength(0);
  });

  it('ticks, unticks, removes and clears with soft writes only', async () => {
    const { db, calls } = fakeDb();
    await setTicked(db, member, ['a', 'b'], true);
    await setTicked(db, member, ['a'], false);
    await removeRows(db, member, ['a']);
    await clearTicked(db, member);
    await clearList(db, member);
    expect(calls.map((c) => c.sql.split(' ').slice(0, 3).join(' '))).toEqual(
      Array(5).fill('update shopping_items set'),
    );
    expect(calls[0]!.params.slice(1)).toEqual(['a', 'b']);
    expect(calls[1]!.params[0]).toBeNull();
    expect(calls.every((c) => !/^delete/.test(c.sql))).toBe(true);
  });

  it('moving to an aisle writes the choice and moves the item’s rows', async () => {
    const { db, calls } = fakeDb({ choice: null });
    await moveToAisle(db, member, 'onion', 'frozen');
    expect(calls[0]!.sql).toMatch(/^insert into aisle_choices/);
    expect(calls[1]!.sql).toMatch(/^update shopping_items set aisle = \?/);
    const again = fakeDb({ choice: { id: 'c1' } });
    await moveToAisle(again.db, member, 'onion', 'dairy');
    expect(again.calls[0]!.sql).toMatch(/^update aisle_choices set aisle = \?/);
  });

  it('viewers cannot change the list', async () => {
    const { db } = fakeDb();
    await expect(addShoppingRows(db, viewer, [onion])).rejects.toThrow(/Viewers/);
    await expect(setTicked(db, viewer, ['a'], true)).rejects.toThrow(/Viewers/);
    await expect(moveToAisle(db, viewer, 'onion', 'frozen')).rejects.toThrow(/Viewers/);
  });
});
```

In `apps/mobile/src/sync/upload.test.ts`, add a case: a `shopping_items` PUT keeps `item`, `aisle` and `checked_at`, and drops `updated_at`. Follow the file's existing cases.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run apps/mobile/src/shopping apps/mobile/src/sync`
Expected: FAIL. `./repository` can't be found, and the upload case drops the fields.

- [ ] **Step 3: Implement**

`apps/mobile/src/db/schema.ts`: add both tables to `AppSchema`, with a type export for each (`ShoppingItemRow`, `AisleChoiceRow`):

```ts
// The household's list rows not cleared (household_shopping_items stream).
const shopping_items = new Table(
  {
    household_id: column.text,
    item: column.text,
    item_key: column.text,
    quantity: column.real,
    quantity_max: column.real,
    unit: column.text,
    note: column.text,
    aisle: column.text,
    recipe_id: column.text,
    recipe_title: column.text,
    checked_at: column.text,
    created_at: column.text,
    updated_at: column.text,
    updated_by: column.text,
    deleted_at: column.text,
  },
  { indexes: { key: ['item_key'] } },
);

// The household's own aisle for an item (household_aisle_choices stream).
const aisle_choices = new Table({
  household_id: column.text,
  item_key: column.text,
  aisle: column.text,
  created_at: column.text,
  updated_at: column.text,
  updated_by: column.text,
  deleted_at: column.text,
});
```

`apps/mobile/src/sync/upload.ts`: add `shopping_items: SHOPPING_ITEM_CLIENT_FIELDS` and `aisle_choices: AISLE_CHOICE_CLIENT_FIELDS` to `CLIENT_FIELDS`.

`apps/mobile/src/shopping/repository.ts`:

```ts
import type { AbstractPowerSyncDatabase } from '@powersync/web';
import { SHOPPING_LIMITS, type Aisle, type NewShoppingRow } from '@recipe-app/domain';
import { canWrite, type Claims } from '../session/claims';

type Db = Pick<AbstractPowerSyncDatabase, 'execute' | 'getOptional'>;

export const SHOPPING_ROWS_SQL = 'select * from shopping_items where deleted_at is null';
export const AISLE_CHOICES_SQL = 'select item_key, aisle from aisle_choices where deleted_at is null';

function requireWriter(claims: Claims): void {
  if (!canWrite(claims.role)) throw new Error('Viewers cannot change the shopping list');
}
const now = () => new Date().toISOString();
const marks = (ids: string[]) => ids.map(() => '?').join(', ');

/** FR-32, FR-35. "full" past 500 live rows (spec §6), and nothing is written. */
export async function addShoppingRows(db: Db, claims: Claims, rows: NewShoppingRow[]): Promise<'added' | 'full'> {
  requireWriter(claims);
  const count = await db.getOptional<{ live: number }>(
    'select count(*) as live from shopping_items where deleted_at is null',
  );
  if ((count?.live ?? 0) + rows.length > SHOPPING_LIMITS.rows) return 'full';
  for (const row of rows) {
    await db.execute(
      `insert into shopping_items (id, household_id, item, item_key, quantity, quantity_max, unit, note, aisle, recipe_id, recipe_title)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [crypto.randomUUID(), claims.householdId, row.item, row.item_key, row.quantity, row.quantity_max,
        row.unit, row.note, row.aisle, row.recipe_id, row.recipe_title],
    );
  }
  return 'added';
}

export async function setTicked(db: Db, claims: Claims, rowIds: string[], ticked: boolean): Promise<void> {
  requireWriter(claims);
  await db.execute(`update shopping_items set checked_at = ? where id in (${marks(rowIds)})`, [
    ticked ? now() : null,
    ...rowIds,
  ]);
}

export async function removeRows(db: Db, claims: Claims, rowIds: string[]): Promise<void> {
  requireWriter(claims);
  await db.execute(`update shopping_items set deleted_at = ? where id in (${marks(rowIds)})`, [now(), ...rowIds]);
}

export async function clearTicked(db: Db, claims: Claims): Promise<void> {
  requireWriter(claims);
  await db.execute(
    'update shopping_items set deleted_at = ? where deleted_at is null and checked_at is not null',
    [now()],
  );
}

export async function clearList(db: Db, claims: Claims): Promise<void> {
  requireWriter(claims);
  await db.execute('update shopping_items set deleted_at = ? where deleted_at is null', [now()]);
}

/** FR-34: the household's own aisle wins from now on, and the list moves at once. */
export async function moveToAisle(db: Db, claims: Claims, itemKey: string, aisle: Aisle): Promise<void> {
  requireWriter(claims);
  const existing = await db.getOptional<{ id: string }>(
    'select id from aisle_choices where item_key = ?',
    [itemKey],
  );
  if (existing) {
    await db.execute('update aisle_choices set aisle = ? where id = ?', [aisle, existing.id]);
  } else {
    await db.execute(
      'insert into aisle_choices (id, household_id, item_key, aisle) values (?, ?, ?, ?)',
      [crypto.randomUUID(), claims.householdId, itemKey, aisle],
    );
  }
  await db.execute('update shopping_items set aisle = ? where item_key = ? and deleted_at is null', [aisle, itemKey]);
}
```

The test expects the `clearTicked` and `clearList` SQL to start `update shopping_items set`, which these do. It also checks `setTicked`'s first call params as `[time, 'a', 'b']` via `.slice(1)`.

`apps/mobile/src/shopping/hooks.ts`:

```ts
import { useQuery } from '@powersync/react';
import { shoppingLines, type Aisle, type ShoppingLine, type ShoppingRow } from '@recipe-app/domain';
import { useMemo } from 'react';
import { AISLE_CHOICES_SQL, SHOPPING_ROWS_SQL } from './repository';

/** FR-33: the list's lines, live from the local database. */
export function useShoppingLines(): ShoppingLine[] {
  const { data } = useQuery<ShoppingRow>(SHOPPING_ROWS_SQL);
  return useMemo(() => shoppingLines(data), [data]);
}

export function useAisleChoices(): Map<string, Aisle> {
  const { data } = useQuery<{ item_key: string; aisle: Aisle }>(AISLE_CHOICES_SQL);
  return useMemo(() => new Map(data.map((row) => [row.item_key, row.aisle])), [data]);
}

/** Lines left to buy, for the tab's name and badge. */
export function useToBuyCount(): number {
  return useShoppingLines().filter((line) => !line.checked).length;
}
```

- [ ] **Step 4: Run tests, lint and typecheck**

Run: `npx vitest run apps/mobile && pnpm lint && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/db apps/mobile/src/sync apps/mobile/src/shopping
git commit -m "feat(app): shopping list storage, writes and live lines (FR-31–FR-35)"
```

---

### Task 4: Screens: the List tab, the list, Add to list; e2e

**Files:**
- Modify: `apps/mobile/src/ui/Icon.tsx` (glyphs `cart`, `cart-outline`, `ellipse-outline`, `checkmark-circle`), `apps/mobile/src/navigation/tabs.ts` and `tabs.test.ts`, `apps/mobile/src/navigation/TabBar.tsx`, `apps/mobile/src/screens/RecipeScreen.tsx`
- Create: `apps/mobile/app/list.tsx`, `apps/mobile/src/screens/ShoppingListScreen.tsx`, `apps/mobile/src/components/AddToListSheet.tsx`, `apps/mobile/src/components/ShoppingLineSheet.tsx`
- Create: `e2e/shopping.spec.ts`; Modify: `e2e/helpers.ts` (an `openList` helper), and the e2e specs that locate tab links, if a fifth tab breaks a locator (`exact: true` names stay unique)

**Interfaces:**
- Consumes: the hooks and repository from Task 3; `addRows`, `typedRow`, `AISLES` and `scaleFactor` from the domain; `useCookPlace` from `src/cooking/useCookPlace`.
- Produces: `listLabel(toBuy: number): string`, returning "Shopping list" or "Shopping list, N to buy"; `Tab` gains `'list'`; `activeTab('/list') === 'list'`.

- [ ] **Step 1: Write the failing unit tests**

In `apps/mobile/src/navigation/tabs.test.ts`, add:

```ts
  it('names the list tab with what is left to buy', () => {
    expect(listLabel(0)).toBe('Shopping list');
    expect(listLabel(1)).toBe('Shopping list, 1 to buy');
    expect(listLabel(12)).toBe('Shopping list, 12 to buy');
    expect(activeTab('/list')).toBe('list');
  });
```

and add `'/list'` to the paths where `showTabBar` is true. Import `listLabel`.

Run: `npx vitest run apps/mobile/src/navigation`
Expected: FAIL (`listLabel` is not exported).

- [ ] **Step 2: Tabs**

`tabs.ts`:
- `export type Tab = 'recipes' | 'favorites' | 'list' | 'household';`
- in `activeTab`: `if (path === '/list') return 'list';`
- add:

```ts
export function listLabel(toBuy: number): string {
  return toBuy > 0 ? `Shopping list, ${toBuy} to buy` : 'Shopping list';
}
```

`Icon.tsx` GLYPHS:
- `cart: 61954`, `'cart-outline': 61955`;
- `'checkmark-circle': 61982`, `'ellipse-outline': 62156`.

Keep the keys in alphabetical order.

`TabBar.tsx`:
- add `list: { label: 'List', href: '/list', icon: 'cart-outline', on: 'cart' }` to `TABS`;
- `TabLink` takes an optional `name` (the accessible name, defaulting to `label`) and an optional `badge: number`. When the badge is above 0, it shows the same amber count badge as **+**, positioned on the icon;
- render `<TabLink tab="list" current={current === 'list'} name={listLabel(toBuy)} badge={toBuy} />` between the **+** slot and Household, with `const toBuy = useToBuyCount();`.

Run: `npx vitest run apps/mobile/src/navigation`
Expected: PASS.

- [ ] **Step 3: The list screen**

`apps/mobile/app/list.tsx` follows `app/favorites.tsx`'s pattern: `SignedIn`, then `ShoppingListScreen` with `claims`.

`apps/mobile/src/screens/ShoppingListScreen.tsx`:

```tsx
import { usePowerSync } from '@powersync/react';
import { AISLES, typedRow, type ShoppingLine } from '@recipe-app/domain';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { ShoppingLineSheet } from '../components/ShoppingLineSheet';
import { StatusLine } from '../components/StatusLine';
import { confirm } from '../components/confirm';
import { canWrite, type Claims } from '../session/claims';
import { addShoppingRows, clearList, clearTicked, setTicked } from '../shopping/repository';
import { useAisleChoices, useShoppingLines } from '../shopping/hooks';
import { colors, space } from '../theme';
import { Banner, Button, Card, Icon, IconButton, Screen, Text, TextField } from '../ui';

const FULL = 'Your list is full. Clear ticked items first.';

/** FR-31–FR-35 (shopping spec §3). */
export function ShoppingListScreen({ claims }: { claims: Claims }) {
  const db = usePowerSync();
  const writer = canWrite(claims.role);
  const lines = useShoppingLines();
  const choices = useAisleChoices();
  const [text, setText] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [open, setOpen] = useState<ShoppingLine | null>(null);
  const toBuy = lines.filter((line) => !line.checked);
  const got = lines.filter((line) => line.checked);

  async function addTyped() {
    const row = typedRow(text, choices);
    if (!row) return;
    if ((await addShoppingRows(db, claims, [row])) === 'full') setMessage(FULL);
    else {
      setText('');
      setMessage(null);
    }
  }

  const lineView = (line: ShoppingLine) => (
    <View key={line.key} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 48 }}>
      {writer ? (
        <IconButton
          icon={line.checked ? 'checkmark-circle' : 'ellipse-outline'}
          label={line.checked ? `Need ${line.item}` : `Got ${line.item}`}
          onPress={() => void setTicked(db, claims, line.rowIds, !line.checked)}
        />
      ) : null}
      <Pressable style={{ flex: 1 }} onPress={() => setOpen(line)} aria-label={`${line.item}${line.amount ? `, ${line.amount}` : ''}`}>
        <Text style={line.checked ? { textDecorationLine: 'line-through', color: colors.muted } : undefined}>
          {line.item}
        </Text>
        {line.amount ? <Text variant="small" tone="muted">{line.amount}</Text> : null}
      </Pressable>
      <IconButton icon="ellipsis-horizontal" label={`More for ${line.item}`} onPress={() => setOpen(line)} />
    </View>
  );

  return (
    <Screen>
      <Text role="heading" aria-level={1} variant="h1">Shopping list</Text>
      <StatusLine />
      {writer ? (
        <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-end' }}>
          <View style={{ flex: 1 }}>
            <TextField label="Add an item" value={text} onChangeText={setText} onSubmitEditing={() => void addTyped()} placeholder="2 lemons" />
          </View>
          <Button label="Add" onPress={() => void addTyped()} />
        </View>
      ) : null}
      {message ? <Banner tone="danger" role="alert">{message}</Banner> : null}
      {lines.length === 0 ? (
        <Text tone="muted">Your list is empty. Add ingredients from a recipe, or type an item above.</Text>
      ) : null}
      {AISLES.map((aisle) => {
        const here = toBuy.filter((line) => line.aisle === aisle.id);
        return here.length === 0 ? null : (
          <Card key={aisle.id} title={aisle.label}>
            {here.map(lineView)}
          </Card>
        );
      })}
      {got.length > 0 ? (
        <Card title="Got it">
          {got.map(lineView)}
          {writer ? <Button variant="secondary" label="Clear ticked" onPress={() => void clearTicked(db, claims)} /> : null}
        </Card>
      ) : null}
      {writer && lines.length > 0 ? (
        <Button
          variant="ghost"
          icon="trash-outline"
          label="Clear list"
          onPress={async () => {
            if (await confirm('Clear the whole shopping list?')) await clearList(db, claims);
          }}
        />
      ) : null}
      <ShoppingLineSheet claims={claims} line={open} onClose={() => setOpen(null)} />
    </Screen>
  );
}
```

`Card title` renders an `h2` heading. Check `src/ui/Card.tsx`, and if it renders the title differently, pass a heading child so aisles are `h2` (spec §3). The `Icon` import is only needed if the line uses one; drop it if lint flags it as unused.

`apps/mobile/src/components/ShoppingLineSheet.tsx` is a `Modal` sheet, following `AddSheet`'s pattern (Escape listener, scrim "Close", `role="dialog"` with `aria-label` set to the line's item). For a line:
- `Text` "For", then one `Text` per `line.recipes[].title`, plus "Added by hand" when `line.handAdded`;
- writers also get:
  - a "Move to aisle" `Text`, then one `Chip` per `AISLES` entry, with tone `selected` for `line.aisle` and `aria-pressed`, whose `onPress` calls `moveToAisle(db, claims, line.key, aisle.id)` and then `onClose()`;
  - a `Button` variant `danger` "Remove", calling `removeRows(db, claims, line.rowIds)` and then `onClose()`;
  - for each recipe, a `Button` variant `ghost` "Remove items from <title>". It removes the line's rows from that recipe, using the ids of the rows whose `recipe_id` matches.

  `ShoppingLine` doesn't carry per-row recipe ids, so the sheet queries `select id from shopping_items where item_key = ? and recipe_id = ? and deleted_at is null` with `db.getAll` before calling `removeRows`.

- [ ] **Step 4: Add to list from a recipe**

`apps/mobile/src/components/AddToListSheet.tsx` is a `Modal` sheet in the same pattern, with `aria-label` "Add to shopping list":
- props: `open`, `claims`, `recipe: RecipeRecord`, `onClose`, `onAdded(count: number)`;
- `const { place } = useCookPlace(recipe); const factor = scaleFactor(recipe.servings, place.servings, place.scale); const choices = useAisleChoices();`;
- state: `chosen`, a `Set` of the non-heading ingredient ids, reset to all when the sheet opens;
- a list of `Pressable` rows with `role="checkbox"`, `aria-checked`, and `aria-label` set to `displayIngredient(line, { factor, units: place.units })`, each showing a check icon and that text;
- `Button` `full`, labelled `` `Add ${chosen.size} ${chosen.size === 1 ? 'item' : 'items'}` ``, with `aria-disabled={chosen.size === 0}`. Its `onPress`:
  - `const rows = addRows(recipe, factor, chosen, choices); const outcome = await addShoppingRows(db, claims, rows);`;
  - on `'full'`, show the full message inside the sheet;
  - otherwise `onAdded(rows.length); onClose();`;
- a `Button` `ghost` "Cancel".

In `RecipeScreen.tsx`'s action row, for writers only, add an `IconButton` with `icon="cart-outline"`, `label="Add to list"` and `filled`, before Share. It sets `const [adding, setAdding] = useState(false)`. Render `<AddToListSheet open={adding} claims={claims} recipe={recipe} onClose={() => setAdding(false)} onAdded={(n) => setAdded(n)} />` and, under the action row, `{added ? <Banner>{`Added ${added} items to your list`}</Banner> : null}`. Use "1 item" for one.

- [ ] **Step 5: Lint, typecheck and unit tests**

Run: `pnpm lint && pnpm typecheck && npx vitest run apps/mobile`
Expected: PASS.

- [ ] **Step 6: Write the e2e spec**

`e2e/helpers.ts`:

```ts
export async function openList(page: Page): Promise<void> {
  await page.getByRole('link', { name: /^Shopping list/ }).click();
  await expect(page.getByRole('heading', { name: 'Shopping list', level: 1 })).toBeVisible();
}
```

`e2e/shopping.spec.ts`:

```ts
import { expect, test } from './fixtures';
import { createRecipe, freshEmail, openList, reloadOffline, SEED, signIn, unique } from './helpers';

async function addFromRecipe(page: import('@playwright/test').Page, untick: string[] = []) {
  await page.getByRole('button', { name: 'Add to list' }).click();
  const sheet = page.getByRole('dialog', { name: 'Add to shopping list' });
  for (const line of untick) await sheet.getByRole('checkbox', { name: line }).click();
  await sheet.getByRole('button', { name: /^Add \d+ items?$/ }).click();
}

test('adding a recipe with lines unticked adds only the others, grouped by aisle (FR-32, FR-34)', async ({ page }) => {
  await signIn(page, freshEmail('shop-add'));
  await createRecipe(page, {
    title: unique('List soup'),
    ingredients: '2 onions\n1 cup milk\n1 tsp salt\n2 tbsp olive oil',
  });
  await addFromRecipe(page, ['1 tsp salt', '2 tbsp olive oil']);
  await expect(page.getByText('Added 2 items to your list')).toBeVisible();
  await openList(page);
  await expect(page.getByRole('heading', { name: 'Produce', level: 2 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Dairy & Eggs', level: 2 })).toBeVisible();
  await expect(page.getByText('salt')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Shopping list, 2 to buy' })).toBeVisible();
});

test('a second recipe’s onions merge into one line that lists both recipes (FR-33)', async ({ page }) => {
  await signIn(page, freshEmail('shop-merge'));
  const soup = unique('Merge soup');
  const stew = unique('Merge stew');
  await createRecipe(page, { title: soup, ingredients: '1 onion' });
  await addFromRecipe(page);
  await createRecipe(page, { title: stew, ingredients: '2 onions, diced' });
  await addFromRecipe(page);
  await openList(page);
  await expect(page.getByRole('button', { name: 'onion, 3' })).toBeVisible();
  await page.getByRole('button', { name: 'More for onion' }).click();
  const sheet = page.getByRole('dialog', { name: 'onion' });
  await expect(sheet.getByText(soup)).toBeVisible();
  await expect(sheet.getByText(stew)).toBeVisible();
});

test('ticking moves a line to Got it; Clear ticked removes it (FR-35)', async ({ page }) => {
  await signIn(page, freshEmail('shop-tick'));
  await openList(page);
  await page.getByLabel('Add an item').fill('2 lemons');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('button', { name: 'Got lemons' }).click();
  await expect(page.getByRole('heading', { name: 'Got it' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear ticked' }).click();
  await expect(page.getByText('Your list is empty.', { exact: false })).toBeVisible();
});

test('a typed item lands in its aisle, and a moved aisle is remembered (FR-34)', async ({ page }) => {
  await signIn(page, freshEmail('shop-aisle'));
  await openList(page);
  await page.getByLabel('Add an item').fill('2 lemons');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Produce', level: 2 })).toBeVisible();
  await page.getByRole('button', { name: 'More for lemons' }).click();
  await page.getByRole('button', { name: 'Frozen' }).click();
  await expect(page.getByRole('heading', { name: 'Frozen', level: 2 })).toBeVisible();
  await page.getByRole('button', { name: 'More for lemons' }).click();
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await page.getByLabel('Add an item').fill('1 lemon');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Frozen', level: 2 })).toBeVisible();
});

test('a change made offline syncs, and another member sees it (FR-31)', async ({ page, browser }) => {
  await signIn(page, SEED.memberA);
  await openList(page);
  await reloadOffline(page);
  const item = unique('Offline basil');
  await page.getByLabel('Add an item').fill(item);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.context().setOffline(false);
  await expect(page.getByText('Online · 0 unsynced')).toBeVisible({ timeout: 30_000 });
  const other = await (await browser.newContext()).newPage();
  await signIn(other, SEED.adminA);
  await openList(other);
  await expect(other.getByText(item)).toBeVisible({ timeout: 15_000 });
  await other.context().close();
});

test('a Viewer sees the list with no controls (rule 4)', async ({ page }) => {
  await signIn(page, SEED.viewerA);
  await openList(page);
  await expect(page.getByLabel('Add an item')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Got / })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Clear list' })).toHaveCount(0);
});
```

Check `reloadOffline`'s name and behaviour in `e2e/helpers.ts`, and how `sync.spec.ts` goes offline. Use the same way here, and adjust the offline test to it. The checkbox names are the sheet's displayed lines. If the add sheet shows the amount differently ("1 tsp salt"), use what the sheet shows.

The Viewer test passes only if household A's seeded list is visible to the Viewer. It checks for missing controls either way, but an empty list hides the per-line buttons anyway. Make it meaningful: before the check, use `adminSql`-style setup through a helper, or sign in as `SEED.memberA` in another context and add a typed item first. Then also assert `page.getByRole('button', { name: /^More for / }).first()` is visible, and that opening it shows no "Remove".

- [ ] **Step 7: Run e2e against the rebuilt app**

Run: `pnpm dev:backend:test && docker compose restart sync && npx playwright test e2e/shopping.spec.ts`
Expected: 6 passed.

Then run: `pnpm test:e2e`
Expected: everything passes (1 skipped as before). Fix any old locator that the fifth tab or the new button made ambiguous by making it exact, and record each as a ruling.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile e2e
git commit -m "feat(app): shopping list tab, list screen and Add to list (FR-31–FR-35)"
```

---

### Task 5: Docs

**Files:**
- Create: `docs/adr/0019-shopping-list.md`
- Modify: `docs/adr/README.md`, `ARCHITECTURE.md`, `docs/SPEC.md`

- [ ] **Step 1: ADR-0019**

Follow the template: Status Accepted, date 2026-10-18.
- **Context:** Phase 2 (SPEC §3) and the owner's choices (spec §1).
- **Decision:**
  - one shared list per household;
  - one row per added ingredient, merged at display time by `shoppingLines` (`item_key`, amounts by kind);
  - aisles from a built-in word list (`aisles.ts`), overridden by `aisle_choices`, upserted on `(household_id, item_key)`;
  - no new API routes: the upload path and RLS; purge after 30 days.
- **Alternatives:**
  - merged rows (lost amounts on concurrent offline adds; sources lost);
  - AI aisle sorting (needs a connection and costs credit);
  - several lists (more taps; not wanted now);
  - a derived UUID v5 for choices (needs hashing in the browser).
- **Consequences:**
  - plural rules are simple English: odd items may not merge ("leaves" and "leaf" do, "geese" doesn't);
  - the word list needs additions over time, and the household's moves cover the gaps;
  - 500-row limit;
  - list rows keep a recipe's title after the recipe is deleted.

Add it to `docs/adr/README.md`'s list.

- [ ] **Step 2: ARCHITECTURE and SPEC**

- **ARCHITECTURE.md:**
  - data model: add `HOUSEHOLD ||--o{ SHOPPING_ITEM : lists` and `HOUSEHOLD ||--o{ AISLE_CHOICE : remembers`, with convention bullets for both tables;
  - the Navigation & Screens component: add the List tab and `/list`;
  - §8: change "Phase 2 shopping list" to describe what's built (`shopping_items`, `aisle_choices`, display-time merging; ADR-0019).
- **docs/SPEC.md:**
  - after "Offline & sync", add "### Shopping list (Phase 2)" with the FR-31 to FR-35 table from spec §2;
  - in §3, mark Phase 2 as built: "Shopping list *(built)*".

- [ ] **Step 3: Check and commit**

Run: `pnpm lint`
Expected: PASS.

```bash
git add docs ARCHITECTURE.md
git commit -m "docs: ADR-0019 shopping list; SPEC FR-31–FR-35; ARCHITECTURE"
```
