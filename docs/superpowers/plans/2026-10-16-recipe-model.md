# Recipe Model and Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the title-only recipe into a full recipe the owner can type in by hand on a phone, then read, edit, star, delete and restore, offline and synced across the household.

**Architecture:** Ingredients, steps and tags are JSON (`jsonb`, `text[]`) on the `recipes` row, so a save is one atomic row and last-write-wins applies per recipe. A pure parser in `packages/domain` turns one typed line into a structured ingredient while keeping the typed text. Per-user favorites get their own tenant table and sync stream. A 30-day trash purge runs as the user under a narrow RLS `DELETE` policy.

**Tech Stack:** Postgres 17 with RLS and dbmate migrations, PowerSync 1.27 sync streams (edition 3), Node/Hono API with `postgres` and zod, Expo 57 (React Native Web, Expo Router), `@powersync/web`, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-16-recipe-model-design.md`

## Global Constraints

- Shell commands are prefixed with `rtk` (CLAUDE.md). pnpm runs through corepack; on the owner's WSL machine a `pnpm` shim must be on `PATH`. Commit messages go in a file and use `rtk proxy git commit -q -F <file>` (the RTK hook mangles heredocs); they end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and reference FR IDs.
- Never edit `db/migrations/20261013000000_create_households_memberships_recipes.sql`. The new migration is `db/migrations/20261017000000_add_recipe_details_and_favorites.sql`.
- Limits (spec §3): `servings` 1–999; `prep_minutes`, `cook_minutes` 0–10,000; at most 200 ingredients, 100 steps, 30 tags; ingredient `raw` 1–500, `item` 0–500, `note` ≤ 500; step `text` 1–2,000; tag 1–40, lowercase; `notes` ≤ 10,000.
- Canonical units: `cup, tbsp, tsp, oz, lb, g, kg, ml, l, pinch, dash, clove, can, package, stick, slice, pint, quart, gallon`.
- RLS and the sync config change together (rule 6). `favorites` joins `TENANT_TABLES` in `apps/api/tests/rls/registry.ts`.
- Viewers may write only their own `favorites` rows. They see no New recipe, Edit, Move to Trash, Restore or Trash controls.
- The purge runs only as the user through `asUser`; no new database role, no scheduler.
- Screens show an ingredient's `raw` text, never a reconstruction from parsed fields.
- Copy: "Title is required", "Servings must be 1 to 999", "Discard your changes?", "This recipe is in the Trash", "Deletes in N days" ("Deletes in 1 day" for one), "This recipe could not be read".
- Every new route works offline and is covered by the service worker's navigation fallback.
- No new runtime dependency.

## Review Focus

1. **Timestamps synced by PowerSync use a different text format from those the phone writes** (for example `2026-10-16 18:44:44Z` versus `2026-10-16T18:44:44.000Z`). Trash ordering and "Deletes in N days" must be right for both, and in Safari, whose `Date.parse` is strict. Test in Task 4.
2. **A row with missing or old-shaped columns** (a recipe created before this migration, or `null` from sync): it must still list and open, with empty ingredients, steps and tags. Test in Task 4.
3. **The same ingredient line typed twice** (for example "1 egg" on two lines): both keep distinct IDs, and those IDs survive an edit. Test in Task 1.
4. **A pasted list over a limit** (more than 200 ingredient lines): the editor shows a clear message beside the field and saves nothing. Test in Task 4.
5. **A double tap on Save** must create one recipe, not two. Test in Task 5.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/domain/src/ingredients.ts` (create) | Units, `parseIngredientLine`, `ingredientsFromText`, `ingredientsToText` |
| `packages/domain/src/steps.ts` (create) | `stepsFromText`, `stepsToText` |
| `packages/domain/src/tags.ts` (create) | `normalizeTags` |
| `packages/domain/src/index.ts` (modify) | Schemas (recipe, ingredient, step, tag, favorite), client-field lists, re-exports |
| `packages/domain/src/*.test.ts` (create/modify) | Unit tests for each |
| `db/migrations/20261017000000_add_recipe_details_and_favorites.sql` (create) | Columns, `favorites`, grants, RLS, purge policy, publication |
| `powersync/sync-config.yaml` (modify) | New recipe columns; `user_favorites` stream |
| `apps/api/tests/rls/registry.ts`, `roles.test.ts`, `isolation.test.ts` (modify) | Registry, grants, deletes |
| `apps/api/tests/rls/favorites.test.ts`, `recipe-details.test.ts` (create) | New RLS cases |
| `apps/api/src/upload/ops.ts` (modify) | Recipe columns and `favorites` ops |
| `apps/api/src/app.ts`, `app.test.ts` (modify) | `POST /api/trash/purge` |
| `apps/api/tests/upload/upload.test.ts` (modify), `purge.test.ts` (create) | API tests |
| `apps/mobile/src/db/schema.ts` (modify) | Local columns; `favorites` table |
| `apps/mobile/src/sync/upload.ts`, `upload.test.ts` (modify) | Favorites fields; decode JSON columns |
| `apps/mobile/src/sync/purge.ts`, `purge.test.ts` (create) | `purgeDue`, `purgeTrashIfDue` |
| `apps/mobile/src/recipes/rows.ts`, `rows.test.ts` (create) | Local row to recipe, timestamps, days left |
| `apps/mobile/src/recipes/form.ts`, `form.test.ts` (create) | Editor text to a validated recipe, and back |
| `apps/mobile/src/recipes/repository.ts`, `repository.test.ts` (modify) | Local reads and writes |
| `apps/mobile/src/recipes/hooks.ts` (create; replaces `useRecipes.ts`) | Live queries |
| `apps/mobile/src/session/SignedIn.tsx` (create) | Route gate: loading, signed out, no household |
| `apps/mobile/src/components/confirm.ts` (create) | Yes/no confirmation |
| `apps/mobile/src/components/RecipeEditor.tsx`, `StarButton.tsx` (create) | Editor form; star toggle |
| `apps/mobile/src/screens/RecipeListScreen.tsx` (modify), `RecipeScreen.tsx`, `EditRecipeScreen.tsx`, `TrashScreen.tsx` (create) | Screens |
| `apps/mobile/app/recipe/new.tsx`, `app/recipe/[id]/index.tsx`, `app/recipe/[id]/edit.tsx`, `app/trash.tsx` (create); `app/index.tsx` (modify) | Routes |
| `apps/mobile/src/components/AddRecipeForm.tsx` (delete) | Replaced by the editor |
| `apps/mobile/src/db/DatabaseSessionBridge.tsx` (modify) | Purge call after connect |
| `e2e/helpers.ts` (modify), `e2e/recipes.spec.ts` (rewrite), `e2e/favorites.spec.ts`, `e2e/trash.spec.ts` (create) | Acceptance tests |
| `docs/adr/0010-recipe-content-as-json.md` (create); `docs/adr/README.md`, `docs/SPEC.md`, `CLAUDE.md`, `ARCHITECTURE.md` (modify) | Documentation |

---

### Task 1: Domain: ingredient parser, text lists, tags and schemas

**Files:**
- Create: `packages/domain/src/ingredients.ts`, `packages/domain/src/steps.ts`, `packages/domain/src/tags.ts`
- Modify: `packages/domain/src/index.ts`
- Test: `packages/domain/src/ingredients.test.ts`, `packages/domain/src/steps.test.ts`, `packages/domain/src/tags.test.ts`, `packages/domain/src/index.test.ts`

**Interfaces:**
- Produces:
  - `UNITS`, `type Unit`
  - `type ParsedIngredient = { raw: string; quantity: number | null; quantity_max: number | null; unit: Unit | null; item: string; note: string | null; heading: boolean }`
  - `type Ingredient = ParsedIngredient & { id: string }`
  - `parseIngredientLine(raw: string): ParsedIngredient`
  - `ingredientsFromText(text: string, previous: Ingredient[], newId: () => string): Ingredient[]`
  - `ingredientsToText(ingredients: Ingredient[]): string`
  - `type Step = { id: string; text: string }`
  - `stepsFromText(text: string, previous: Step[], newId: () => string): Step[]`
  - `stepsToText(steps: Step[]): string`
  - `normalizeTags(input: string): string[]`
  - Schemas: `unitSchema`, `ingredientSchema`, `stepSchema`, `tagSchema`, `recipeSchema` (extended), `recipePatchSchema`, `favoriteSchema`, `favoritePatchSchema`
  - Constants: `RECIPE_CLIENT_FIELDS`, `FAVORITE_CLIENT_FIELDS`, `RECIPE_LIMITS = { servings: [1, 999], minutes: [0, 10000], ingredients: 200, steps: 100, tags: 30, tagLength: 40, notes: 10000 }`
  - Types: `Recipe`, `RecipePatch`, `Favorite`

- [ ] **Step 1: Write the failing parser tests**

`packages/domain/src/ingredients.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  ingredientsFromText,
  ingredientsToText,
  parseIngredientLine,
  type Ingredient,
} from './ingredients';

type Case = [string, Partial<ReturnType<typeof parseIngredientLine>>];

const CASES: Case[] = [
  ['2 1/2 cups flour, sifted', { quantity: 2.5, unit: 'cup', item: 'flour', note: 'sifted' }],
  ['½ tsp salt', { quantity: 0.5, unit: 'tsp', item: 'salt', note: null }],
  ['1½ cups milk', { quantity: 1.5, unit: 'cup', item: 'milk' }],
  ['1.5 lb chicken thighs', { quantity: 1.5, unit: 'lb', item: 'chicken thighs' }],
  [
    '2-3 cloves garlic, minced',
    { quantity: 2, quantity_max: 3, unit: 'clove', item: 'garlic', note: 'minced' },
  ],
  ['2 – 3 cloves garlic', { quantity: 2, quantity_max: 3, unit: 'clove' }],
  ['2 to 3 tbsp oil', { quantity: 2, quantity_max: 3, unit: 'tbsp', item: 'oil' }],
  ['1 T butter', { quantity: 1, unit: 'tbsp', item: 'butter' }],
  ['1 t vanilla', { quantity: 1, unit: 'tsp', item: 'vanilla' }],
  ['1 Tbsp. sugar', { quantity: 1, unit: 'tbsp', item: 'sugar' }],
  ['3 eggs', { quantity: 3, unit: null, item: 'eggs' }],
  ['2 large eggs, beaten', { quantity: 2, unit: null, item: 'large eggs', note: 'beaten' }],
  ['1 cup of rice', { quantity: 1, unit: 'cup', item: 'rice' }],
  ['4 oz cream cheese', { quantity: 4, unit: 'oz', item: 'cream cheese' }],
  ['2 lbs ground beef', { quantity: 2, unit: 'lb', item: 'ground beef' }],
  ['500 g pasta', { quantity: 500, unit: 'g', item: 'pasta' }],
  ['250 ml stock', { quantity: 250, unit: 'ml', item: 'stock' }],
  ['1 l water', { quantity: 1, unit: 'l', item: 'water' }],
  ['1 can diced tomatoes', { quantity: 1, unit: 'can', item: 'diced tomatoes' }],
  ['2 pkg yeast', { quantity: 2, unit: 'package', item: 'yeast' }],
  ['1 stick butter, softened', { quantity: 1, unit: 'stick', item: 'butter', note: 'softened' }],
  ['3 slices bacon', { quantity: 3, unit: 'slice', item: 'bacon' }],
  ['1 pinch nutmeg', { quantity: 1, unit: 'pinch', item: 'nutmeg' }],
  ['2 dashes hot sauce', { quantity: 2, unit: 'dash', item: 'hot sauce' }],
  ['1 qt buttermilk', { quantity: 1, unit: 'quart', item: 'buttermilk' }],
  ['1 pint cream', { quantity: 1, unit: 'pint', item: 'cream' }],
  ['1 gallon water', { quantity: 1, unit: 'gallon', item: 'water' }],
  ['1 kg potatoes', { quantity: 1, unit: 'kg', item: 'potatoes' }],
  ['3 c flour', { quantity: 3, unit: 'cup', item: 'flour' }],
  ['2 carrots, diced', { quantity: 2, unit: null, item: 'carrots', note: 'diced' }],
  ['.5 cup sugar', { quantity: 0.5, unit: 'cup', item: 'sugar' }],
  ['1/3 cup honey', { quantity: 1 / 3, unit: 'cup', item: 'honey' }],
  [
    '1 (14 oz, drained) can beans, rinsed',
    { quantity: 1, item: '(14 oz, drained) can beans', note: 'rinsed' },
  ],
  ['2 cups', { quantity: 2, unit: 'cup', item: '' }],
  ['salt to taste', { quantity: null, unit: null, item: 'salt to taste', note: null }],
  ['Salt, to taste', { quantity: null, item: 'Salt', note: 'to taste' }],
  ['For the sauce:', { quantity: null, item: 'For the sauce', heading: true }],
  ['  3   eggs  ', { raw: '3 eggs', quantity: 3, item: 'eggs' }],
  ['1/0 cup water', { quantity: null, unit: null, item: '1/0 cup water' }],
];

describe('parseIngredientLine', () => {
  it.each(CASES)('parses %j', (raw, expected) => {
    expect(parseIngredientLine(raw)).toMatchObject(expected);
  });

  it('keeps the typed text, trimmed and with single spaces', () => {
    expect(parseIngredientLine('2 1/2 cups flour, sifted').raw).toBe('2 1/2 cups flour, sifted');
  });

  it('marks only lines ending in a colon without a quantity as headings', () => {
    expect(parseIngredientLine('For the sauce:').heading).toBe(true);
    expect(parseIngredientLine('2 cups sauce:').heading).toBe(false);
    expect(parseIngredientLine('flour').heading).toBe(false);
  });

  it('never throws on odd input', () => {
    for (const raw of ['', ':', '-', '½', '1 -', 'to', '()', ',,,']) {
      expect(() => parseIngredientLine(raw)).not.toThrow();
    }
  });
});

describe('ingredientsFromText', () => {
  let counter = 0;
  const newId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

  it('makes one ingredient per non-empty line', () => {
    const list = ingredientsFromText('2 cups flour\n\n  \n1 egg\n', [], newId);
    expect(list.map((ingredient) => ingredient.raw)).toEqual(['2 cups flour', '1 egg']);
  });

  it('keeps the id of an unchanged line and gives a new one to a changed line', () => {
    const first = ingredientsFromText('2 cups flour\n1 egg', [], newId);
    const second = ingredientsFromText('2 cups flour\n2 eggs', first, newId);
    expect(second[0]?.id).toBe(first[0]?.id);
    expect(second[1]?.id).not.toBe(first[1]?.id);
  });

  it('keeps distinct ids for the same line typed twice, across an edit', () => {
    const first = ingredientsFromText('1 egg\n1 egg', [], newId);
    expect(first[0]?.id).not.toBe(first[1]?.id);
    const second = ingredientsFromText('1 egg\n1 cup milk\n1 egg', first, newId);
    expect([second[0]?.id, second[2]?.id].sort()).toEqual([first[0]?.id, first[1]?.id].sort());
  });

  it('round-trips through ingredientsToText', () => {
    const list: Ingredient[] = ingredientsFromText('2 cups flour\nFor the top:\n1 egg', [], newId);
    expect(ingredientsToText(list)).toBe('2 cups flour\nFor the top:\n1 egg');
  });
});
```

- [ ] **Step 2: Write the failing steps and tags tests**

`packages/domain/src/steps.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { stepsFromText, stepsToText } from './steps';

let counter = 0;
const newId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

describe('stepsFromText', () => {
  it('makes one step per non-empty line', () => {
    expect(stepsFromText('Mix.\n\nBake.', [], newId).map((step) => step.text)).toEqual([
      'Mix.',
      'Bake.',
    ]);
  });

  it.each([
    ['1. Preheat the oven', 'Preheat the oven'],
    ['2) Mix', 'Mix'],
    ['Step 3: Bake', 'Bake'],
    ['step 4 - Cool', 'Cool'],
    ['350 degrees is hot', '350 degrees is hot'],
  ])('strips numbering from %j', (line, text) => {
    expect(stepsFromText(line, [], newId)[0]?.text).toBe(text);
  });

  it('keeps ids of unchanged steps', () => {
    const first = stepsFromText('Mix\nBake', [], newId);
    const second = stepsFromText('Mix\nBake longer', first, newId);
    expect(second[0]?.id).toBe(first[0]?.id);
    expect(second[1]?.id).not.toBe(first[1]?.id);
  });

  it('round-trips through stepsToText', () => {
    expect(stepsToText(stepsFromText('1. Mix\n2. Bake', [], newId))).toBe('Mix\nBake');
  });
});
```

`packages/domain/src/tags.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { normalizeTags } from './tags';

describe('normalizeTags', () => {
  it('splits on commas, trims, lowercases, collapses spaces, and de-duplicates in order', () => {
    expect(normalizeTags(' Dinner, Quick  Meals,dinner,, ,Soup ')).toEqual([
      'dinner',
      'quick meals',
      'soup',
    ]);
  });

  it('returns an empty list for empty input', () => {
    expect(normalizeTags('')).toEqual([]);
  });
});
```

- [ ] **Step 3: Write the failing schema tests**

Append to `packages/domain/src/index.test.ts` (keep the existing tests; extend the import line to add `favoritePatchSchema, favoriteSchema, ingredientSchema, RECIPE_LIMITS, stepSchema, tagSchema`):

```ts
const ingredient = {
  id: '6f1c2f0e-8f0a-4a3b-9d5e-2b7c1a9e4d11',
  raw: '2 cups flour',
  quantity: 2,
  quantity_max: null,
  unit: 'cup',
  item: 'flour',
  note: null,
  heading: false,
};
const step = { id: '6f1c2f0e-8f0a-4a3b-9d5e-2b7c1a9e4d12', text: 'Mix' };
const full = {
  id,
  household_id,
  title: 'Bread',
  servings: 4,
  prep_minutes: 15,
  cook_minutes: 40,
  ingredients: [ingredient],
  steps: [step],
  tags: ['bread'],
  notes: 'From Grandma',
};

describe('recipeSchema details', () => {
  it('accepts a full recipe', () => {
    expect(recipeSchema.safeParse(full).success).toBe(true);
  });

  it('still accepts a title-only recipe', () => {
    expect(recipeSchema.safeParse({ id, household_id, title: 'Soup' }).success).toBe(true);
  });

  it.each([
    ['servings', 0],
    ['servings', 1000],
    ['servings', 2.5],
    ['prep_minutes', -1],
    ['cook_minutes', 10001],
  ])('rejects %s = %s', (field, value) => {
    expect(recipeSchema.safeParse({ ...full, [field]: value }).success).toBe(false);
  });

  it.each([
    ['servings', 1],
    ['servings', 999],
    ['prep_minutes', 0],
    ['cook_minutes', 10000],
  ])('accepts %s = %s', (field, value) => {
    expect(recipeSchema.safeParse({ ...full, [field]: value }).success).toBe(true);
  });

  it('rejects more than the maximum number of ingredients, steps, and tags', () => {
    const many = <T>(item: T, count: number) => Array.from({ length: count }, () => item);
    expect(
      recipeSchema.safeParse({ ...full, ingredients: many(ingredient, RECIPE_LIMITS.ingredients) })
        .success,
    ).toBe(true);
    expect(
      recipeSchema.safeParse({
        ...full,
        ingredients: many(ingredient, RECIPE_LIMITS.ingredients + 1),
      }).success,
    ).toBe(false);
    expect(
      recipeSchema.safeParse({ ...full, steps: many(step, RECIPE_LIMITS.steps + 1) }).success,
    ).toBe(false);
    expect(
      recipeSchema.safeParse({ ...full, tags: many('x', RECIPE_LIMITS.tags + 1) }).success,
    ).toBe(false);
  });

  it('rejects notes over the limit', () => {
    expect(
      recipeSchema.safeParse({ ...full, notes: 'a'.repeat(RECIPE_LIMITS.notes + 1) }).success,
    ).toBe(false);
  });
});

describe('ingredientSchema', () => {
  it('rejects an unknown unit, a missing field, and an extra field', () => {
    expect(ingredientSchema.safeParse({ ...ingredient, unit: 'bucket' }).success).toBe(false);
    const { heading: _heading, ...missing } = ingredient;
    expect(ingredientSchema.safeParse(missing).success).toBe(false);
    expect(ingredientSchema.safeParse({ ...ingredient, extra: 1 }).success).toBe(false);
  });

  it('rejects an empty raw line and one over 500 characters', () => {
    expect(ingredientSchema.safeParse({ ...ingredient, raw: '' }).success).toBe(false);
    expect(ingredientSchema.safeParse({ ...ingredient, raw: 'a'.repeat(501) }).success).toBe(false);
  });
});

describe('stepSchema and tagSchema', () => {
  it('rejects an empty step and one over 2000 characters', () => {
    expect(stepSchema.safeParse({ ...step, text: '' }).success).toBe(false);
    expect(stepSchema.safeParse({ ...step, text: 'a'.repeat(2001) }).success).toBe(false);
  });

  it('accepts a tag of 40 characters and rejects 41 or an uppercase tag', () => {
    expect(tagSchema.safeParse('a'.repeat(40)).success).toBe(true);
    expect(tagSchema.safeParse('a'.repeat(41)).success).toBe(false);
    expect(tagSchema.safeParse('Dinner').success).toBe(false);
  });
});

describe('favoriteSchema', () => {
  const favorite = {
    id,
    household_id,
    user_id: '00000000-0000-0000-0000-0000000000a1',
    recipe_id: '6f1c2f0e-8f0a-4a3b-9d5e-2b7c1a9e4d13',
  };

  it('accepts a favorite and a patch that only sets deleted_at', () => {
    expect(favoriteSchema.safeParse(favorite).success).toBe(true);
    expect(
      favoritePatchSchema.safeParse({ id, deleted_at: '2026-10-17T10:00:00.000Z' }).success,
    ).toBe(true);
  });

  it('rejects a patch that moves the favorite to another recipe', () => {
    expect(favoritePatchSchema.safeParse({ id, recipe_id: favorite.recipe_id }).success).toBe(
      false,
    );
  });
});
```

- [ ] **Step 4: Run them and confirm they fail**

Run: `rtk vitest run packages/domain`
Expected: FAIL; `ingredients.test.ts`, `steps.test.ts`, `tags.test.ts` cannot resolve their modules; `index.test.ts` fails on the missing exports.

- [ ] **Step 5: Implement the parser**

`packages/domain/src/ingredients.ts`:

```ts
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
  cup: 'cup', cups: 'cup', c: 'cup',
  tablespoon: 'tbsp', tablespoons: 'tbsp', tbsp: 'tbsp', tbsps: 'tbsp', tbs: 'tbsp', tbl: 'tbsp',
  teaspoon: 'tsp', teaspoons: 'tsp', tsp: 'tsp', tsps: 'tsp',
  ounce: 'oz', ounces: 'oz', oz: 'oz', ozs: 'oz',
  pound: 'lb', pounds: 'lb', lb: 'lb', lbs: 'lb',
  gram: 'g', grams: 'g', g: 'g',
  kilogram: 'kg', kilograms: 'kg', kg: 'kg',
  milliliter: 'ml', milliliters: 'ml', millilitre: 'ml', millilitres: 'ml', ml: 'ml',
  liter: 'l', liters: 'l', litre: 'l', litres: 'l', l: 'l',
  pinch: 'pinch', pinches: 'pinch',
  dash: 'dash', dashes: 'dash',
  clove: 'clove', cloves: 'clove',
  can: 'can', cans: 'can',
  package: 'package', packages: 'package', pkg: 'package', pkgs: 'package',
  stick: 'stick', sticks: 'stick',
  slice: 'slice', slices: 'slice',
  pint: 'pint', pints: 'pint', pt: 'pint',
  quart: 'quart', quarts: 'quart', qt: 'quart',
  gallon: 'gallon', gallons: 'gallon', gal: 'gallon',
};

const VULGAR: Record<string, number> = {
  '¼': 1 / 4, '½': 1 / 2, '¾': 3 / 4, '⅓': 1 / 3, '⅔': 2 / 3,
  '⅛': 1 / 8, '⅜': 3 / 8, '⅝': 5 / 8, '⅞': 7 / 8,
};
const VULGAR_CHARS = Object.keys(VULGAR).join('');
const NUMBER = `(?:\\d+\\s+\\d+/\\d+|\\d+/\\d+|\\d*[${VULGAR_CHARS}]|\\d+(?:\\.\\d+)?|\\.\\d+)`;
const QUANTITY = new RegExp(`^(${NUMBER})(?:\\s*(?:-|–|\\bto\\b)\\s*(${NUMBER}))?(?=\\s|$)\\s*`);
const UNIT_WORD = /^([A-Za-z]+)\.?(?=\s|$)\s*/;

function toNumber(text: string): number | null {
  const value = text.trim();
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

/** One ingredient per non-empty line; an unchanged line keeps its id. */
export function ingredientsFromText(
  text: string,
  previous: Ingredient[],
  newId: () => string,
): Ingredient[] {
  const unused = new Map<string, string[]>();
  for (const ingredient of previous) {
    unused.set(ingredient.raw, [...(unused.get(ingredient.raw) ?? []), ingredient.id]);
  }
  return text
    .split(/\r?\n/)
    .map((line) => parseIngredientLine(line))
    .filter((parsed) => parsed.raw !== '')
    .map((parsed) => ({ ...parsed, id: unused.get(parsed.raw)?.shift() ?? newId() }));
}

export function ingredientsToText(ingredients: Ingredient[]): string {
  return ingredients.map((ingredient) => ingredient.raw).join('\n');
}
```

Prettier will reflow the alias tables to one entry per line; that is fine.

- [ ] **Step 6: Implement steps and tags**

`packages/domain/src/steps.ts`:

```ts
export type Step = { id: string; text: string };

// "1. ", "2) ", "Step 3: ", "step 4 - ": numbering the app adds itself.
const NUMBERING = /^(?:step\s*)?\d+\s*[.):-]\s*/i;

/** One step per non-empty line, numbering removed; an unchanged step keeps its id. */
export function stepsFromText(text: string, previous: Step[], newId: () => string): Step[] {
  const unused = new Map<string, string[]>();
  for (const step of previous) unused.set(step.text, [...(unused.get(step.text) ?? []), step.id]);
  return text
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\s+/g, ' ').replace(NUMBERING, '').trim())
    .filter((line) => line !== '')
    .map((line) => ({ id: unused.get(line)?.shift() ?? newId(), text: line }));
}

export function stepsToText(steps: Step[]): string {
  return steps.map((step) => step.text).join('\n');
}
```

`packages/domain/src/tags.ts`:

```ts
/** Comma-separated input to clean, lowercase, unique tags, in the order typed. */
export function normalizeTags(input: string): string[] {
  const tags: string[] = [];
  for (const part of input.split(',')) {
    const tag = part.trim().replace(/\s+/g, ' ').toLowerCase();
    if (tag !== '' && !tags.includes(tag)) tags.push(tag);
  }
  return tags;
}
```

- [ ] **Step 7: Extend the schemas**

Replace `packages/domain/src/index.ts` with:

```ts
import { z } from 'zod';
import { UNITS } from './ingredients';

export * from './ingredients';
export * from './steps';
export * from './tags';

export const TITLE_MAX = 200;

export const RECIPE_LIMITS = {
  servings: [1, 999],
  minutes: [0, 10000],
  ingredients: 200,
  steps: 100,
  tags: 30,
  tagLength: 40,
  notes: 10000,
} as const;

export const recipeTitleSchema = z
  .string()
  .trim()
  .min(1, 'Title is required')
  .max(TITLE_MAX, `Title must be ${TITLE_MAX} characters or fewer`);

const timestampSchema = z.iso.datetime({ offset: true });

export const unitSchema = z.enum(UNITS);

export const ingredientSchema = z.strictObject({
  id: z.guid(),
  raw: z.string().trim().min(1).max(500),
  quantity: z.number().nonnegative().nullable(),
  quantity_max: z.number().nonnegative().nullable(),
  unit: unitSchema.nullable(),
  item: z.string().max(500),
  note: z.string().max(500).nullable(),
  heading: z.boolean(),
});

export const stepSchema = z.strictObject({
  id: z.guid(),
  text: z.string().trim().min(1).max(2000),
});

export const tagSchema = z
  .string()
  .min(1)
  .max(RECIPE_LIMITS.tagLength)
  .refine((tag) => tag === tag.trim().toLowerCase(), 'Tags are trimmed and lowercase');

const minutesSchema = (label: string) =>
  z
    .number()
    .int(`${label} must be a whole number of minutes`)
    .min(RECIPE_LIMITS.minutes[0], `${label} must be 0 to 10000 minutes`)
    .max(RECIPE_LIMITS.minutes[1], `${label} must be 0 to 10000 minutes`)
    .nullable();

// z.guid() accepts any 8-4-4-4-12 hex string. z.uuid() would reject the
// hand-written ids used in seed data.
export const recipeSchema = z.strictObject({
  id: z.guid(),
  household_id: z.guid(),
  title: recipeTitleSchema,
  servings: z
    .number()
    .int('Servings must be 1 to 999')
    .min(RECIPE_LIMITS.servings[0], 'Servings must be 1 to 999')
    .max(RECIPE_LIMITS.servings[1], 'Servings must be 1 to 999')
    .nullable()
    .optional(),
  prep_minutes: minutesSchema('Prep').optional(),
  cook_minutes: minutesSchema('Cook').optional(),
  ingredients: z
    .array(ingredientSchema)
    .max(RECIPE_LIMITS.ingredients, `At most ${RECIPE_LIMITS.ingredients} ingredients`)
    .optional(),
  steps: z
    .array(stepSchema)
    .max(RECIPE_LIMITS.steps, `At most ${RECIPE_LIMITS.steps} steps`)
    .optional(),
  tags: z.array(tagSchema).max(RECIPE_LIMITS.tags, `At most ${RECIPE_LIMITS.tags} tags`).optional(),
  notes: z
    .string()
    .max(RECIPE_LIMITS.notes, `Notes must be ${RECIPE_LIMITS.notes} characters or fewer`)
    .optional(),
  deleted_at: timestampSchema.nullable().optional(),
});

export const recipePatchSchema = recipeSchema
  .partial()
  .required({ id: true })
  .refine((value) => Object.keys(value).length > 1, { message: 'Patch has no fields' });

/** Fields the client may send. Server-owned fields are never uploaded. */
export const RECIPE_CLIENT_FIELDS = [
  'household_id',
  'title',
  'servings',
  'prep_minutes',
  'cook_minutes',
  'ingredients',
  'steps',
  'tags',
  'notes',
  'deleted_at',
] as const;

export const favoriteSchema = z.strictObject({
  id: z.guid(),
  household_id: z.guid(),
  user_id: z.guid(),
  recipe_id: z.guid(),
  deleted_at: timestampSchema.nullable().optional(),
});

/** A favorite is starred or not; it never moves to another recipe or user. */
export const favoritePatchSchema = z.strictObject({
  id: z.guid(),
  deleted_at: timestampSchema.nullable(),
});

export const FAVORITE_CLIENT_FIELDS = ['household_id', 'user_id', 'recipe_id', 'deleted_at'] as const;

export type Recipe = z.infer<typeof recipeSchema>;
export type RecipePatch = z.infer<typeof recipePatchSchema>;
export type Favorite = z.infer<typeof favoriteSchema>;
```

- [ ] **Step 8: Run the domain tests and confirm they pass**

Run: `rtk vitest run packages/domain`
Expected: PASS. If a parser case fails, fix the parser, not the case, unless the case contradicts the spec's table in §4.

- [ ] **Step 9: Typecheck, lint, all unit tests, commit**

Run: `rtk pnpm lint && rtk pnpm typecheck && rtk pnpm test`
Expected: all exit 0. The API (`apps/api/src/upload/ops.ts`) still compiles because `recipeSchema` keeps every earlier field.

Message: `feat(domain): ingredient-line parser, step and tag lists, full recipe and favorite schemas (FR-15, FR-16, FR-17)`.

---

### Task 2: Database: columns, favorites, purge policy, RLS tests, sync config

**Files:**
- Create: `db/migrations/20261017000000_add_recipe_details_and_favorites.sql`
- Modify: `powersync/sync-config.yaml`
- Modify: `apps/api/tests/rls/registry.ts`, `apps/api/tests/rls/roles.test.ts`, `apps/api/tests/rls/isolation.test.ts`
- Test: `apps/api/tests/rls/favorites.test.ts`, `apps/api/tests/rls/recipe-details.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1 (SQL only).
- Produces: the columns and `favorites` table (spec §3); `recipes_purge` policy; the `user_favorites` stream. Later tasks rely on `favorites(id, household_id, user_id, recipe_id, created_at, updated_at, updated_by, deleted_at)` and `unique (user_id, recipe_id)`.

- [ ] **Step 1: Add the table to the registry and expected grants (failing)**

`apps/api/tests/rls/registry.ts`:

```ts
/**
 * Every table in the public schema. The coverage guard fails if a table exists
 * that is not listed here, so adding a table forces adding its tests.
 */
export const TENANT_TABLES = ['households', 'memberships', 'recipes', 'favorites'] as const;

/** The column that holds the tenant id in each table. */
export const TENANT_COLUMN: Record<(typeof TENANT_TABLES)[number], string> = {
  households: 'id',
  memberships: 'household_id',
  recipes: 'household_id',
  favorites: 'household_id',
};
```

In `apps/api/tests/rls/roles.test.ts`, change the expected grants to:

```ts
    expect(byTable).toEqual({
      households: ['SELECT', 'UPDATE'],
      memberships: ['SELECT'],
      recipes: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
      favorites: ['INSERT', 'SELECT', 'UPDATE'],
    });
```

In `apps/api/tests/rls/isolation.test.ts`, replace the `describe('no hard deletes', ...)` block's first test with:

```ts
describe('hard deletes', () => {
  // Only trash older than 30 days can be deleted (recipes_purge); any other
  // delete matches no row under RLS, so it runs and removes nothing.
  it.each([SEED.adminA, SEED.memberA, SEED.viewerA])(
    '%s cannot delete a recipe that is not expired trash',
    async (email) => {
      const member = await signInAs(SEED.memberA);
      const actor = await signInAs(email);
      const id = await insertRecipe(member, 'Keep me');
      const deleted = await as(actor, (tx) => tx`delete from public.recipes where id = ${id} returning id`);
      expect(deleted).toHaveLength(0);
      expect(await titleOf(member, id)).toBe('Keep me');
    },
  );
```

Keep the second test ("an admin cannot delete the household or a membership") unchanged; close the `describe` as before.

- [ ] **Step 2: Write the failing favorites RLS tests**

`apps/api/tests/rls/favorites.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SEED, signInAs, signInFresh, type Actor } from '../../../../test-support/auth';
import { as, refusalCode } from '../helpers/db';

const REFUSED = '42501';

async function insertRecipe(actor: Actor): Promise<string> {
  const id = randomUUID();
  await as(
    actor,
    (tx) =>
      tx`insert into public.recipes (id, household_id, title) values (${id}, ${actor.householdId}, 'Fav soup')`,
  );
  return id;
}

function star(actor: Actor, recipeId: string, id = randomUUID()) {
  return as(
    actor,
    (tx) => tx`insert into public.favorites (id, household_id, user_id, recipe_id)
      values (${id}, ${actor.householdId}, ${actor.userId}, ${recipeId})`,
  ).then(() => id);
}

async function favoritesOf(actor: Actor) {
  return as(actor, (tx) => tx<{ id: string; user_id: string }[]>`select id, user_id from public.favorites`);
}

describe('favorites', () => {
  it('a user reads and un-stars their own favorite', async () => {
    const member = await signInAs(SEED.memberA);
    const recipeId = await insertRecipe(member);
    const id = await star(member, recipeId);
    expect((await favoritesOf(member)).map((row) => row.id)).toContain(id);
    const updated = await as(
      member,
      (tx) => tx`update public.favorites set deleted_at = now() where id = ${id} returning id`,
    );
    expect(updated).toHaveLength(1);
  });

  it('a viewer can star a household recipe', async () => {
    const member = await signInAs(SEED.memberA);
    const viewer = await signInAs(SEED.viewerA);
    const recipeId = await insertRecipe(member);
    expect(await refusalCode(star(viewer, recipeId))).toBeUndefined();
  });

  it('another user in the same household neither sees nor changes my favorites', async () => {
    const member = await signInAs(SEED.memberA);
    const admin = await signInAs(SEED.adminA);
    const recipeId = await insertRecipe(member);
    const id = await star(member, recipeId);
    expect((await favoritesOf(admin)).map((row) => row.id)).not.toContain(id);
    const updated = await as(
      admin,
      (tx) => tx`update public.favorites set deleted_at = now() where id = ${id} returning id`,
    );
    expect(updated).toHaveLength(0);
  });

  it('a user cannot write a favorite for someone else', async () => {
    const member = await signInAs(SEED.memberA);
    const admin = await signInAs(SEED.adminA);
    const recipeId = await insertRecipe(member);
    const code = await refusalCode(
      as(
        member,
        (tx) => tx`insert into public.favorites (id, household_id, user_id, recipe_id)
          values (${randomUUID()}, ${member.householdId}, ${admin.userId}, ${recipeId})`,
      ),
    );
    expect(code).toBe(REFUSED);
  });

  it('nobody can favorite another household recipe or read its favorites', async () => {
    const memberA = await signInAs(SEED.memberA);
    const adminB = await signInAs(SEED.adminB);
    const recipeA = await insertRecipe(memberA);
    await star(memberA, recipeA);
    expect(await refusalCode(star(adminB, recipeA))).toBe(REFUSED);
    const seen = await favoritesOf(adminB);
    expect(seen.every((row) => row.user_id === adminB.userId)).toBe(true);
  });

  it('one favorite row per user and recipe', async () => {
    const fresh = await signInFresh('fav-unique');
    const recipeId = await insertRecipe(fresh);
    await star(fresh, recipeId);
    const code = await refusalCode(star(fresh, recipeId));
    expect(code).toBe('23505');
  });
});
```

If `signInFresh` takes different arguments, check `test-support/auth.ts` and match it.

- [ ] **Step 3: Write the failing recipe-details RLS tests**

`apps/api/tests/rls/recipe-details.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SEED, signInAs, type Actor } from '../../../../test-support/auth';
import { adminSql, as, refusalCode } from '../helpers/db';

async function insertRecipe(actor: Actor, title = 'Detail soup'): Promise<string> {
  const id = randomUUID();
  await as(
    actor,
    (tx) =>
      tx`insert into public.recipes (id, household_id, title) values (${id}, ${actor.householdId}, ${title})`,
  );
  return id;
}

async function trashDaysAgo(id: string, days: number): Promise<void> {
  // Arranged as the superuser: a client can only set deleted_at to "now".
  await adminSql`update public.recipes set deleted_at = now() - make_interval(days => ${days}) where id = ${id}`;
}

async function exists(id: string): Promise<boolean> {
  const rows = await adminSql`select 1 from public.recipes where id = ${id}`;
  return rows.length === 1;
}

function purge(actor: Actor, id: string) {
  return as(
    actor,
    (tx) =>
      tx`delete from public.recipes where id = ${id} and deleted_at < now() - interval '30 days' returning id`,
  );
}

describe('recipe details', () => {
  it('a member stores every new column', async () => {
    const member = await signInAs(SEED.memberA);
    const id = await insertRecipe(member);
    const ingredients = [{ id: randomUUID(), raw: '1 egg' }];
    await as(
      member,
      (tx) => tx`update public.recipes set servings = 4, prep_minutes = 10, cook_minutes = 20,
        ingredients = ${tx.json(ingredients)}, steps = ${tx.json([{ id: randomUUID(), text: 'Mix' }])},
        tags = ${['quick', 'eggs']}, notes = 'Shared note' where id = ${id}`,
    );
    const [row] = await as(
      member,
      (tx) => tx<{ servings: number; tags: string[]; ingredients: unknown[] }[]>`
        select servings, tags, ingredients from public.recipes where id = ${id}`,
    );
    expect(row?.servings).toBe(4);
    expect(row?.tags).toEqual(['quick', 'eggs']);
    expect(row?.ingredients).toHaveLength(1);
  });

  it('a viewer cannot change the new columns', async () => {
    const member = await signInAs(SEED.memberA);
    const viewer = await signInAs(SEED.viewerA);
    const id = await insertRecipe(member);
    const updated = await as(
      viewer,
      (tx) => tx`update public.recipes set notes = 'viewer was here' where id = ${id} returning id`,
    );
    expect(updated).toHaveLength(0);
  });

  it.each([
    ['servings = 0', 'servings = 0'],
    ['servings = 1000', 'servings = 1000'],
    ['prep_minutes = -1', 'prep_minutes = -1'],
    ['cook_minutes = 10001', 'cook_minutes = 10001'],
    ['ingredients as an object', `ingredients = '{}'::jsonb`],
    ['steps as a string', `steps = '"mix"'::jsonb`],
    ['201 ingredients', `ingredients = (select jsonb_agg(x) from generate_series(1, 201) x)`],
    ['101 steps', `steps = (select jsonb_agg(x) from generate_series(1, 101) x)`],
    ['31 tags', `tags = (select array_agg(x::text) from generate_series(1, 31) x)`],
    ['notes over 10000', `notes = repeat('a', 10001)`],
  ])('the database refuses %s', async (_label, assignment) => {
    const member = await signInAs(SEED.memberA);
    const id = await insertRecipe(member);
    const code = await refusalCode(
      as(member, (tx) => tx.unsafe(`update public.recipes set ${assignment} where id = $1`, [id])),
    );
    expect(code?.startsWith('2')).toBe(true);
  });
});

describe('trash purge policy', () => {
  it.each([SEED.adminA, SEED.memberA])('%s purges household trash older than 30 days', async (email) => {
    const member = await signInAs(SEED.memberA);
    const actor = await signInAs(email);
    const id = await insertRecipe(member);
    await trashDaysAgo(id, 31);
    expect(await purge(actor, id)).toHaveLength(1);
    expect(await exists(id)).toBe(false);
  });

  it('nobody purges trash younger than 30 days or a recipe not in the trash', async () => {
    const admin = await signInAs(SEED.adminA);
    const young = await insertRecipe(admin);
    await trashDaysAgo(young, 29);
    const live = await insertRecipe(admin);
    await as(admin, (tx) => tx`delete from public.recipes where id in (${young}, ${live})`);
    expect(await exists(young)).toBe(true);
    expect(await exists(live)).toBe(true);
  });

  it('a viewer cannot purge, nor can another household', async () => {
    const member = await signInAs(SEED.memberA);
    const viewer = await signInAs(SEED.viewerA);
    const adminB = await signInAs(SEED.adminB);
    const id = await insertRecipe(member);
    await trashDaysAgo(id, 31);
    expect(await purge(viewer, id)).toHaveLength(0);
    expect(await purge(adminB, id)).toHaveLength(0);
    expect(await exists(id)).toBe(true);
  });

  it('purging a recipe removes its favorites', async () => {
    const member = await signInAs(SEED.memberA);
    const id = await insertRecipe(member);
    await as(
      member,
      (tx) => tx`insert into public.favorites (id, household_id, user_id, recipe_id)
        values (${randomUUID()}, ${member.householdId}, ${member.userId}, ${id})`,
    );
    await trashDaysAgo(id, 31);
    await purge(member, id);
    const left = await adminSql`select 1 from public.favorites where recipe_id = ${id}`;
    expect(left).toHaveLength(0);
  });
});
```

- [ ] **Step 4: Run the RLS suite and confirm the new tests fail**

Run: `rtk pnpm test:rls`
Expected: FAIL. `favorites.test.ts` and `recipe-details.test.ts` fail with `relation "public.favorites" does not exist` or `column "servings" does not exist`; `roles.test.ts` fails on the grants; the coverage guard passes (the registry lists a table that does not exist yet; check `coverage.test.ts` — if it fails because a listed table is missing, that is also an expected failure).

- [ ] **Step 5: Write the migration**

`db/migrations/20261017000000_add_recipe_details_and_favorites.sql`:

```sql
-- migrate:up
-- Recipe details (FR-15, FR-16), favorites (FR-17), 30-day trash purge (FR-18).
-- NFR-1: favorites carry household_id with RLS in this same migration.
-- Runs as app_owner.

-- ---------------------------------------------------------------- recipe details

-- Ingredients and steps are JSON on the row (ADR-0010): one recipe, one row,
-- so a save is atomic and last-write-wins applies to the whole recipe.
-- Element shapes are validated by the API (packages/domain); the database
-- checks types and counts.
alter table public.recipes
  add column servings integer check (servings between 1 and 999),
  add column prep_minutes integer check (prep_minutes between 0 and 10000),
  add column cook_minutes integer check (cook_minutes between 0 and 10000),
  add column ingredients jsonb not null default '[]'::jsonb
    check (jsonb_typeof(ingredients) = 'array' and jsonb_array_length(ingredients) <= 200),
  add column steps jsonb not null default '[]'::jsonb
    check (jsonb_typeof(steps) = 'array' and jsonb_array_length(steps) <= 100),
  add column tags text[] not null default '{}'
    check (cardinality(tags) <= 30),
  add column notes text not null default ''
    check (char_length(notes) <= 10000);

-- ---------------------------------------------------------------- favorites

-- One row per user and recipe. Un-starring sets deleted_at; starring again
-- clears it on the same row.
create table public.favorites (
  id uuid primary key, -- generated on the client; no default on purpose
  household_id uuid not null references public.households (id),
  user_id uuid not null references auth.users (id) on delete cascade,
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  deleted_at timestamptz,
  unique (user_id, recipe_id)
);
create index favorites_household_id_idx on public.favorites (household_id);
create index favorites_recipe_id_idx on public.favorites (recipe_id);

create trigger favorites_stamp before insert or update on public.favorites
for each row execute function public.stamp_row();

-- ---------------------------------------------------------------- grants

-- Favorites: any role writes its own rows (a personal bookmark, not household
-- data). No delete grant: removal is soft, or by cascade from a purged recipe.
grant select, insert, update on public.favorites to authenticated;

-- Recipes: delete is granted only for the 30-day purge; recipes_purge below
-- limits it to expired trash. Every other delete matches no row.
grant delete on public.recipes to authenticated;

-- ---------------------------------------------------------------- RLS

alter table public.favorites enable row level security;

-- Mirrored by powersync/sync-config.yaml (user_favorites). Change both together.
create policy favorites_select on public.favorites
for select to authenticated
using (
  household_id = (select public.auth_household_id())
  and user_id = (select public.auth_user_id())
);

create policy favorites_insert on public.favorites
for insert to authenticated
with check (
  household_id = (select public.auth_household_id())
  and user_id = (select public.auth_user_id())
  and exists (
    select 1 from public.recipes r
    where r.id = recipe_id and r.household_id = (select public.auth_household_id())
  )
);

create policy favorites_update on public.favorites
for update to authenticated
using (
  household_id = (select public.auth_household_id())
  and user_id = (select public.auth_user_id())
)
with check (
  household_id = (select public.auth_household_id())
  and user_id = (select public.auth_user_id())
  and exists (
    select 1 from public.recipes r
    where r.id = recipe_id and r.household_id = (select public.auth_household_id())
  )
);

-- FR-18: trash older than 30 days is deleted for good, by an admin or member
-- of the household, through POST /api/trash/purge.
create policy recipes_purge on public.recipes
for delete to authenticated
using (
  household_id = (select public.auth_household_id())
  and (select public.auth_household_role()) in ('admin', 'member')
  and deleted_at is not null
  and deleted_at < now() - interval '30 days'
);

-- ---------------------------------------------------------------- sync

alter publication powersync add table public.favorites;
grant select on public.favorites to powersync_repl;

-- migrate:down
alter publication powersync drop table public.favorites;
drop policy recipes_purge on public.recipes;
revoke delete on public.recipes from authenticated;
drop table public.favorites;
alter table public.recipes
  drop column servings,
  drop column prep_minutes,
  drop column cook_minutes,
  drop column ingredients,
  drop column steps,
  drop column tags,
  drop column notes;
```

- [ ] **Step 6: Update the sync config**

`powersync/sync-config.yaml`:

```yaml
# What each device receives. Each stream MIRRORS an RLS select policy;
# change one, change the other (CLAUDE.md rule 6).
config:
  edition: 3

streams:
  # Mirrors recipes_select: household_id = auth_household_id().
  household_recipes:
    auto_subscribe: true
    query: >-
      SELECT id, household_id, title, servings, prep_minutes, cook_minutes,
             ingredients, steps, tags, notes,
             created_at, updated_at, updated_by, deleted_at
      FROM recipes
      WHERE household_id = auth.parameter('household_id')

  # Mirrors favorites_select: the user's own rows. RLS on write keeps a
  # user's rows inside their household, so the user filter is enough.
  user_favorites:
    auto_subscribe: true
    query: >-
      SELECT id, household_id, user_id, recipe_id,
             created_at, updated_at, updated_by, deleted_at
      FROM favorites
      WHERE user_id = auth.user_id()
```

- [ ] **Step 7: Apply and run the RLS suite**

Run: `rtk pnpm db:reset && rtk pnpm test:rls`
Expected: PASS, all files. (`db:reset` recreates the volume, applies both migrations, and seeds.) If `sync` is unhealthy after the reset, read `rtk docker compose logs sync --tail 50`: a sync config error names the stream and column.

- [ ] **Step 8: Note how PowerSync will send the new columns**

PowerSync sends `jsonb` as JSON text and is expected to send `text[]` as a JSON array in text (`["quick","eggs"]`). Task 4's `rowToRecipe` accepts both that and a Postgres array literal (`{quick,eggs}`), so either form works. Task 5's first e2e test proves it end to end: a second session reads synced ingredients and tags. Nothing to run here.

- [ ] **Step 9: Run the other suites and commit**

Run: `rtk pnpm lint && rtk pnpm typecheck && rtk pnpm test && rtk pnpm test:stack && rtk pnpm test:api && rtk pnpm test:e2e`
Expected: all exit 0 (no app code reads the new columns yet).

Message: `feat(db): recipe details, favorites, and the 30-day trash purge policy, with RLS tests and sync streams (FR-15, FR-16, FR-17, FR-18, NFR-1)`.

---

### Task 3: API: recipe columns and favorites in /api/upload; POST /api/trash/purge

**Files:**
- Modify: `apps/api/src/upload/ops.ts`
- Modify: `apps/api/src/app.ts`, `apps/api/src/app.test.ts`
- Modify: `apps/api/tests/upload/upload.test.ts`
- Test: `apps/api/tests/upload/purge.test.ts`

**Interfaces:**
- Consumes: Task 1's `recipeSchema`, `recipePatchSchema`, `favoriteSchema`, `favoritePatchSchema`; Task 2's columns, table, and policy.
- Produces: `/api/upload` accepts `table: 'favorites'` ops and the new recipe columns (ingredients and steps as JSON arrays, tags as a string array); `POST /api/trash/purge` returns `{ purged: number }`.

- [ ] **Step 1: Write the failing API tests**

Append to `apps/api/tests/upload/upload.test.ts` (inside the file, after the existing `describe('POST /api/upload', ...)`):

```ts
describe('POST /api/upload, recipe details and favorites', () => {
  const ingredient = () => ({
    id: randomUUID(),
    raw: '2 cups flour',
    quantity: 2,
    quantity_max: null,
    unit: 'cup',
    item: 'flour',
    note: null,
    heading: false,
  });

  function fullPut(actor: Actor, id: string) {
    return {
      op: 'put',
      table: 'recipes',
      id,
      data: {
        household_id: actor.householdId,
        title: 'Bread',
        servings: 4,
        prep_minutes: 15,
        cook_minutes: 40,
        ingredients: [ingredient()],
        steps: [{ id: randomUUID(), text: 'Knead' }],
        tags: ['bread'],
        notes: 'From Grandma',
      },
    };
  }

  it('stores a full recipe and a patch of its ingredients', async () => {
    const member = await signInAs(SEED.memberA);
    const id = randomUUID();
    const next = [ingredient(), ingredient()];
    const results = await upload(member, [
      fullPut(member, id),
      { op: 'patch', table: 'recipes', id, data: { ingredients: next, tags: ['bread', 'quick'] } },
    ]);
    expect(results.map((result) => result.status)).toEqual(['applied', 'applied']);
    const [row] = await as(
      member,
      (tx) => tx<{ servings: number; ingredients: unknown[]; tags: string[]; notes: string }[]>`
        select servings, ingredients, tags, notes from public.recipes where id = ${id}`,
    );
    expect(row).toMatchObject({ servings: 4, tags: ['bread', 'quick'], notes: 'From Grandma' });
    expect(row?.ingredients).toHaveLength(2);
  });

  it('rejects an invalid ingredient shape and too many ingredients', async () => {
    const member = await signInAs(SEED.memberA);
    const bad = { ...fullPut(member, randomUUID()) };
    bad.data = { ...bad.data, ingredients: [{ raw: 'no id' }] as never };
    const many = fullPut(member, randomUUID());
    many.data = { ...many.data, ingredients: Array.from({ length: 201 }, ingredient) };
    const results = await upload(member, [bad, many]);
    expect(results.map((result) => result.reason)).toEqual(['invalid', 'invalid']);
  });

  it('stars, un-stars, and re-stars a recipe', async () => {
    const viewer = await signInAs(SEED.viewerA);
    const member = await signInAs(SEED.memberA);
    const recipeId = randomUUID();
    await upload(member, [fullPut(member, recipeId)]);
    const favoriteId = randomUUID();
    const data = { household_id: viewer.householdId, user_id: viewer.userId, recipe_id: recipeId };
    const results = await upload(viewer, [
      { op: 'put', table: 'favorites', id: favoriteId, data },
      { op: 'patch', table: 'favorites', id: favoriteId, data: { deleted_at: new Date().toISOString() } },
      { op: 'patch', table: 'favorites', id: favoriteId, data: { deleted_at: null } },
    ]);
    expect(results.map((result) => result.status)).toEqual(['applied', 'applied', 'applied']);
    const rows = await as(
      viewer,
      (tx) => tx<{ deleted_at: Date | null }[]>`select deleted_at from public.favorites where id = ${favoriteId}`,
    );
    expect(rows[0]?.deleted_at).toBeNull();
  });

  it('rejects a favorite of another household recipe', async () => {
    const memberA = await signInAs(SEED.memberA);
    const adminB = await signInAs(SEED.adminB);
    const recipeId = randomUUID();
    await upload(memberA, [fullPut(memberA, recipeId)]);
    const [result] = await upload(adminB, [
      {
        op: 'put',
        table: 'favorites',
        id: randomUUID(),
        data: { household_id: adminB.householdId, user_id: adminB.userId, recipe_id: recipeId },
      },
    ]);
    expect(result?.status).toBe('rejected');
  });
});
```

`apps/api/tests/upload/purge.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { env } from '../../../../test-support/env';
import { SEED, signInAs, type Actor } from '../../../../test-support/auth';
import { adminSql, as } from '../helpers/db';

const URL = `${env.apiUrl}/trash/purge`;

async function trashedRecipe(actor: Actor, daysAgo: number): Promise<string> {
  const id = randomUUID();
  await as(
    actor,
    (tx) =>
      tx`insert into public.recipes (id, household_id, title) values (${id}, ${actor.householdId}, 'Old stew')`,
  );
  await adminSql`update public.recipes set deleted_at = now() - make_interval(days => ${daysAgo}) where id = ${id}`;
  return id;
}

async function exists(id: string): Promise<boolean> {
  return (await adminSql`select 1 from public.recipes where id = ${id}`).length === 1;
}

function purge(token: string | null): Promise<Response> {
  return fetch(URL, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

describe('POST /api/trash/purge', () => {
  it('deletes only expired trash in the caller household', async () => {
    const memberA = await signInAs(SEED.memberA);
    const adminB = await signInAs(SEED.adminB);
    const expired = await trashedRecipe(memberA, 31);
    const recent = await trashedRecipe(memberA, 5);
    const otherHousehold = await trashedRecipe(adminB, 31);

    const response = await purge(memberA.accessToken);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { purged: number };
    expect(body.purged).toBeGreaterThanOrEqual(1);
    expect(await exists(expired)).toBe(false);
    expect(await exists(recent)).toBe(true);
    expect(await exists(otherHousehold)).toBe(true);
  });

  it('a viewer purges nothing', async () => {
    const member = await signInAs(SEED.memberA);
    const viewer = await signInAs(SEED.viewerA);
    const expired = await trashedRecipe(member, 31);
    const response = await purge(viewer.accessToken);
    expect(await response.json()).toEqual({ purged: 0 });
    expect(await exists(expired)).toBe(true);
  });

  it('refuses a request without a token', async () => {
    expect((await purge(null)).status).toBe(401);
  });
});
```

In `apps/api/src/app.test.ts`, add tests in the file's existing style (it builds the app with fake `verify` and `asUser`): `POST /api/trash/purge` without a header returns 401; with a token, it calls `asUser` once and returns `{ purged: n }` where `n` is the row count the fake transaction returns. Read the file first and follow its helper names.

- [ ] **Step 2: Run them and confirm they fail**

Run: `rtk pnpm test:api && rtk vitest run apps/api/src/app.test.ts`
Expected: FAIL. The full-recipe put is accepted (Task 1's schema allows it) but the insert writes only the old columns, so `servings` reads back `null`; favorites ops are rejected `table_not_allowed`; purge returns 404.

- [ ] **Step 3: Apply the new columns and favorites in `ops.ts`**

Replace `apps/api/src/upload/ops.ts`'s import line and `ALLOWED_TABLES` with:

```ts
import {
  favoritePatchSchema,
  favoriteSchema,
  recipePatchSchema,
  recipeSchema,
} from '@recipe-app/domain';
import { z } from 'zod';
import type { UserTx } from '../db/asUser';

export const MAX_OPS = 500;
const ALLOWED_TABLES = new Set(['recipes', 'favorites']);
// jsonb columns: sent with tx.json so postgres.js does not build an array literal.
const JSON_COLUMNS = new Set(['ingredients', 'steps']);
```

Add after `isRefusal`:

```ts
/** Column values ready for postgres.js: jsonb columns wrapped, everything else as is. */
function columns(tx: UserTx, data: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [
      key,
      JSON_COLUMNS.has(key) ? tx.json(value as Parameters<UserTx['json']>[0]) : value,
    ]),
  );
}

async function applyRecipe(tx: UserTx, op: Op, candidate: Record<string, unknown>): Promise<Result> {
  if (op.op === 'put') {
    const parsed = recipeSchema.safeParse(candidate);
    if (!parsed.success) return rejected(op, 'invalid');
    const { id, ...fields } = parsed.data;
    const row = columns(tx, { ...fields, deleted_at: fields.deleted_at ?? null });
    // An existing row the caller may not update (another household's, or any
    // row for a viewer) makes the DO UPDATE branch raise 42501.
    await tx`
      insert into public.recipes ${tx({ id, ...row })}
      on conflict (id) do update set ${tx(row)}`;
    return applied(op);
  }
  const parsed = recipePatchSchema.safeParse(candidate);
  if (!parsed.success) return rejected(op, 'invalid');
  const { id, ...fields } = parsed.data;
  const rows = await tx`
    update public.recipes set ${tx(columns(tx, fields))} where id = ${id} returning id`;
  // RLS hides rows the caller may not update, so "no row" covers both cases.
  return rows.length === 0 ? rejected(op, 'not_found_or_forbidden') : applied(op);
}

async function applyFavorite(
  tx: UserTx,
  op: Op,
  candidate: Record<string, unknown>,
): Promise<Result> {
  if (op.op === 'put') {
    const parsed = favoriteSchema.safeParse(candidate);
    if (!parsed.success) return rejected(op, 'invalid');
    const { id, ...fields } = parsed.data;
    const row = { ...fields, deleted_at: fields.deleted_at ?? null };
    // A second row for the same user and recipe violates the unique
    // constraint (23505) and is rejected like any refusal.
    await tx`
      insert into public.favorites ${tx({ id, ...row })}
      on conflict (id) do update set deleted_at = excluded.deleted_at`;
    return applied(op);
  }
  const parsed = favoritePatchSchema.safeParse(candidate);
  if (!parsed.success) return rejected(op, 'invalid');
  const rows = await tx`
    update public.favorites set deleted_at = ${parsed.data.deleted_at}
    where id = ${parsed.data.id} returning id`;
  return rows.length === 0 ? rejected(op, 'not_found_or_forbidden') : applied(op);
}
```

Replace `applyOne` with:

```ts
async function applyOne(tx: UserTx, op: Op): Promise<Result> {
  if (!ALLOWED_TABLES.has(op.table)) return rejected(op, 'table_not_allowed');
  if (op.op === 'delete') return rejected(op, 'delete_not_allowed');
  const candidate = { ...(op.data ?? {}), id: op.id };
  return op.table === 'recipes'
    ? applyRecipe(tx, op, candidate)
    : applyFavorite(tx, op, candidate);
}
```

If `tx({ id, ...row })` inserts `deleted_at: null` for a new favorite, that is intended. If TypeScript rejects `Parameters<UserTx['json']>[0]`, cast with `value as never` and a comment (`// postgres.js accepts any JSON value`).

- [ ] **Step 4: Add the purge route**

In `apps/api/src/app.ts`, after the `/api/upload` route:

```ts
  // FR-18: deletes the caller's household trash older than 30 days. RLS
  // (recipes_purge) limits it to that household, to admins and members, and
  // to expired trash, so the statement needs no conditions of its own beyond
  // the 30 days.
  app.post('/api/trash/purge', async (c) => {
    const token = bearer(c.req.header('Authorization'));
    if (!token) return c.json({ error: 'unauthorized' }, 401);
    await deps.verify(token);
    const purged = await deps.asUser(token, async (tx) => {
      const rows = await tx`
        delete from public.recipes where deleted_at < now() - interval '30 days' returning id`;
      return rows.length;
    });
    return c.json({ purged });
  });
```

- [ ] **Step 5: Run the API tests and confirm they pass**

Run: `rtk pnpm test:api && rtk vitest run apps/api/src/app.test.ts`
Expected: PASS. `test:api` rebuilds nothing; if it hits the old API image, run `rtk pnpm dev:backend` first (it rebuilds `api`).

- [ ] **Step 6: Run everything and commit**

Run: `rtk pnpm lint && rtk pnpm typecheck && rtk pnpm test && rtk pnpm test:rls && rtk pnpm test:e2e`
Expected: all exit 0.

Message: `feat(api): recipe details and favorites in /api/upload, and POST /api/trash/purge (FR-15, FR-17, FR-18)`.

---

### Task 4: App data layer: local schema, upload decoding, rows, form, repository, purge call

**Files:**
- Modify: `apps/mobile/src/db/schema.ts`
- Modify: `apps/mobile/src/sync/upload.ts`, `apps/mobile/src/sync/upload.test.ts`
- Create: `apps/mobile/src/sync/purge.ts`, `apps/mobile/src/sync/purge.test.ts`
- Create: `apps/mobile/src/recipes/rows.ts`, `apps/mobile/src/recipes/rows.test.ts`
- Create: `apps/mobile/src/recipes/form.ts`, `apps/mobile/src/recipes/form.test.ts`
- Modify: `apps/mobile/src/recipes/repository.ts`, `apps/mobile/src/recipes/repository.test.ts`
- Create: `apps/mobile/src/recipes/hooks.ts`
- Modify (temporarily, until Task 5 deletes them): `apps/mobile/src/recipes/useRecipes.ts`, `apps/mobile/src/components/AddRecipeForm.tsx`
- Modify: `apps/mobile/src/db/DatabaseSessionBridge.tsx`

**Interfaces:**
- Consumes: Task 1's domain functions and schemas; Task 3's upload and purge contracts.
- Produces:
  - `type RecipeRecord = { id: string; household_id: string; title: string; servings: number | null; prep_minutes: number | null; cook_minutes: number | null; ingredients: Ingredient[]; steps: Step[]; tags: string[]; notes: string; deleted_at: string | null }`
  - `rowToRecipe(row: Record<string, unknown>): RecipeRecord | null`
  - `parseTimestamp(text: string | null | undefined): number | null` (milliseconds)
  - `trashDaysLeft(deletedAt: string, now: number): number`
  - `TRASH_DAYS = 30`
  - `type RecipeForm = { title: string; servings: string; prep: string; cook: string; ingredients: string; steps: string; tags: string; notes: string }`
  - `emptyForm(): RecipeForm`, `formFromRecipe(recipe: RecipeRecord): RecipeForm`
  - `type FormResult = { ok: true; values: RecipeValues } | { ok: false; errors: Partial<Record<keyof RecipeForm, string>> }`
  - `type RecipeValues = { title: string; servings: number | null; prep_minutes: number | null; cook_minutes: number | null; ingredients: Ingredient[]; steps: Step[]; tags: string[]; notes: string }`
  - `valuesFromForm(form: RecipeForm, previous: RecipeRecord | null, newId: () => string): FormResult`
  - Repository: `createRecipe(db, claims, values): Promise<string>`, `updateRecipe(db, claims, id, values): Promise<void>`, `trashRecipe(db, claims, id): Promise<void>`, `restoreRecipe(db, claims, id): Promise<void>`, `setFavorite(db, claims, recipeId, starred): Promise<void>`
  - SQL constants: `LIST_RECIPES_SQL`, `LIST_FAVORITES_SQL`, `RECIPE_SQL`, `STARRED_SQL`, `TRASH_SQL`, `TAGS_SQL`
  - Hooks: `useRecipeList(userId, favoritesOnly)`, `useRecipe(id, userId)`, `useTrash()`, `useHouseholdTags()`
  - `purgeDue(last: string | null, now: number): boolean`, `purgeTrashIfDue(): Promise<void>`

- [ ] **Step 1: Write the failing row and timestamp tests**

`apps/mobile/src/recipes/rows.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseTimestamp, rowToRecipe, trashDaysLeft } from './rows';

const base = {
  id: '6f1c2f0e-8f0a-4a3b-9d5e-2b7c1a9e4d10',
  household_id: '00000000-0000-0000-0000-00000000000a',
  title: 'Bread',
};
const ingredient = {
  id: '6f1c2f0e-8f0a-4a3b-9d5e-2b7c1a9e4d11',
  raw: '2 cups flour',
  quantity: 2,
  quantity_max: null,
  unit: 'cup',
  item: 'flour',
  note: null,
  heading: false,
};

describe('rowToRecipe', () => {
  it('parses JSON text columns from the local database', () => {
    const recipe = rowToRecipe({
      ...base,
      servings: 4,
      prep_minutes: 10,
      cook_minutes: null,
      ingredients: JSON.stringify([ingredient]),
      steps: JSON.stringify([{ id: '6f1c2f0e-8f0a-4a3b-9d5e-2b7c1a9e4d12', text: 'Mix' }]),
      tags: JSON.stringify(['bread']),
      notes: 'Note',
      deleted_at: null,
    });
    expect(recipe).toMatchObject({ servings: 4, tags: ['bread'], notes: 'Note' });
    expect(recipe?.ingredients[0]?.raw).toBe('2 cups flour');
  });

  it('treats missing or null new columns as empty (a recipe from before this change)', () => {
    expect(rowToRecipe({ ...base })).toEqual({
      ...base,
      servings: null,
      prep_minutes: null,
      cook_minutes: null,
      ingredients: [],
      steps: [],
      tags: [],
      notes: '',
      deleted_at: null,
    });
  });

  it('accepts tags as a Postgres array literal', () => {
    expect(rowToRecipe({ ...base, tags: '{quick,"two words"}' })?.tags).toEqual([
      'quick',
      'two words',
    ]);
  });

  it('returns null for corrupt JSON or an invalid shape', () => {
    expect(rowToRecipe({ ...base, ingredients: '[{' })).toBeNull();
    expect(rowToRecipe({ ...base, ingredients: JSON.stringify([{ raw: 'x' }]) })).toBeNull();
    expect(rowToRecipe({ id: base.id })).toBeNull();
  });
});

describe('parseTimestamp', () => {
  it('reads both the ISO form the app writes and the space form sync may send', () => {
    const iso = parseTimestamp('2026-10-16T18:44:44.102Z');
    expect(iso).toBe(Date.UTC(2026, 9, 16, 18, 44, 44, 102));
    expect(parseTimestamp('2026-10-16 18:44:44.102155Z')).toBe(iso);
    expect(parseTimestamp('2026-10-16 18:44:44+00')).toBe(Date.UTC(2026, 9, 16, 18, 44, 44));
  });

  it('returns null for empty or unreadable text', () => {
    expect(parseTimestamp(null)).toBeNull();
    expect(parseTimestamp('soon')).toBeNull();
  });
});

describe('trashDaysLeft', () => {
  const now = Date.UTC(2026, 9, 17, 12);
  it('counts whole days left in the 30-day window, rounding up', () => {
    expect(trashDaysLeft('2026-10-17T12:00:00.000Z', now)).toBe(30);
    expect(trashDaysLeft('2026-09-18T13:00:00.000Z', now)).toBe(1);
    expect(trashDaysLeft('2026-09-17T11:00:00.000Z', now)).toBe(0);
  });
});
```

- [ ] **Step 2: Write the failing form tests**

`apps/mobile/src/recipes/form.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { emptyForm, formFromRecipe, valuesFromForm } from './form';
import type { RecipeRecord } from './rows';

let counter = 0;
const newId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

describe('valuesFromForm', () => {
  it('builds a valid recipe from typed text', () => {
    const result = valuesFromForm(
      {
        title: ' Pancakes ',
        servings: '4',
        prep: '10',
        cook: '',
        ingredients: '2 cups flour\n2 eggs',
        steps: '1. Mix\n2. Cook',
        tags: 'Breakfast, quick',
        notes: 'Sunday',
      },
      null,
      newId,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.values).toMatchObject({
      title: 'Pancakes',
      servings: 4,
      prep_minutes: 10,
      cook_minutes: null,
      tags: ['breakfast', 'quick'],
      notes: 'Sunday',
    });
    expect(result.values.ingredients.map((ingredient) => ingredient.unit)).toEqual(['cup', null]);
    expect(result.values.steps.map((step) => step.text)).toEqual(['Mix', 'Cook']);
  });

  it('reports each problem beside its field', () => {
    const result = valuesFromForm(
      { ...emptyForm(), title: '  ', servings: '0', prep: 'ten', cook: '-5' },
      null,
      newId,
    );
    expect(result).toEqual({
      ok: false,
      errors: {
        title: 'Title is required',
        servings: 'Servings must be 1 to 999',
        prep: 'Prep must be 0 to 10000 minutes',
        cook: 'Cook must be 0 to 10000 minutes',
      },
    });
  });

  it('refuses more than 200 ingredient lines with a message', () => {
    const lines = Array.from({ length: 201 }, (_, index) => `${index + 1} cups water`).join('\n');
    const result = valuesFromForm({ ...emptyForm(), title: 'Soup', ingredients: lines }, null, newId);
    expect(result).toEqual({ ok: false, errors: { ingredients: 'At most 200 ingredients' } });
  });

  it('keeps ingredient ids from the recipe being edited', () => {
    const first = valuesFromForm({ ...emptyForm(), title: 'Soup', ingredients: '1 onion' }, null, newId);
    if (!first.ok) throw new Error('first save failed');
    const previous = { ...first.values, id: newId(), household_id: newId(), deleted_at: null } as RecipeRecord;
    const second = valuesFromForm(formFromRecipe(previous), previous, newId);
    if (!second.ok) throw new Error('second save failed');
    expect(second.values.ingredients[0]?.id).toBe(first.values.ingredients[0]?.id);
  });
});

describe('formFromRecipe', () => {
  it('turns a recipe back into editor text', () => {
    const form = formFromRecipe({
      id: newId(),
      household_id: newId(),
      title: 'Bread',
      servings: 2,
      prep_minutes: null,
      cook_minutes: 30,
      ingredients: [],
      steps: [{ id: newId(), text: 'Bake' }],
      tags: ['bread', 'easy'],
      notes: '',
      deleted_at: null,
    });
    expect(form).toEqual({
      title: 'Bread',
      servings: '2',
      prep: '',
      cook: '30',
      ingredients: '',
      steps: 'Bake',
      tags: 'bread, easy',
      notes: '',
    });
  });
});
```

- [ ] **Step 3: Write the failing upload, purge and repository tests**

In `apps/mobile/src/sync/upload.test.ts`, add (in the file's style):

```ts
describe('toUploadOps for recipe details and favorites', () => {
  it('decodes JSON text columns into arrays', () => {
    const [op] = toUploadOps([
      {
        op: 'PUT',
        table: 'recipes',
        id: 'r1',
        opData: {
          household_id: 'h1',
          title: 'Bread',
          ingredients: '[{"raw":"1 egg"}]',
          steps: '[]',
          tags: '["bread"]',
          notes: '',
        },
      },
    ]);
    expect(op?.data).toMatchObject({
      ingredients: [{ raw: '1 egg' }],
      steps: [],
      tags: ['bread'],
      notes: '',
    });
  });

  it('keeps unreadable JSON as text, so the server rejects it instead of the client crashing', () => {
    const [op] = toUploadOps([{ op: 'PATCH', table: 'recipes', id: 'r1', opData: { tags: '[' } }]);
    expect(op?.data).toEqual({ tags: '[' });
  });

  it('uploads only the client fields of a favorite', () => {
    const [op] = toUploadOps([
      {
        op: 'PUT',
        table: 'favorites',
        id: 'f1',
        opData: { household_id: 'h1', user_id: 'u1', recipe_id: 'r1', created_at: 'x' },
      },
    ]);
    expect(op).toEqual({
      op: 'put',
      table: 'favorites',
      id: 'f1',
      data: { household_id: 'h1', user_id: 'u1', recipe_id: 'r1' },
    });
  });
});
```

`apps/mobile/src/sync/purge.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { PURGE_INTERVAL_MS, purgeDue } from './purge';

describe('purgeDue', () => {
  const now = 1_800_000_000_000;
  it('is due when never run, when the record is unreadable, or after 24 hours', () => {
    expect(purgeDue(null, now)).toBe(true);
    expect(purgeDue('garbage', now)).toBe(true);
    expect(purgeDue(String(now - PURGE_INTERVAL_MS), now)).toBe(true);
  });

  it('is not due within 24 hours of the last run', () => {
    expect(purgeDue(String(now - PURGE_INTERVAL_MS + 1000), now)).toBe(false);
  });
});
```

Replace `apps/mobile/src/recipes/repository.test.ts` with tests against a fake `execute`/`getOptional` that record SQL and parameters (read the current file first and keep its fake-database helper):

```ts
import { describe, expect, it } from 'vitest';
import {
  createRecipe,
  restoreRecipe,
  setFavorite,
  trashRecipe,
  updateRecipe,
} from './repository';
import type { RecipeValues } from './form';

type Call = { sql: string; params: unknown[] };

function fakeDb(existingFavorite: { id: string } | null = null) {
  const calls: Call[] = [];
  return {
    calls,
    db: {
      execute: async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        return { rowsAffected: 1 } as never;
      },
      getOptional: async () => existingFavorite as never,
    },
  };
}

const member = { userId: 'u1', householdId: 'h1', role: 'member' as const };
const viewer = { ...member, role: 'viewer' as const };
const values: RecipeValues = {
  title: 'Bread',
  servings: 2,
  prep_minutes: null,
  cook_minutes: 30,
  ingredients: [],
  steps: [],
  tags: ['bread'],
  notes: '',
};

describe('recipe writes', () => {
  it('creates a recipe with JSON text columns and the household id', async () => {
    const { db, calls } = fakeDb();
    const id = await createRecipe(db, member, values);
    expect(calls[0]?.sql).toMatch(/^insert into recipes/);
    expect(calls[0]?.params).toEqual([id, 'h1', 'Bread', 2, null, 30, '[]', '[]', '["bread"]', '']);
  });

  it('updates every field but never deleted_at', async () => {
    const { db, calls } = fakeDb();
    await updateRecipe(db, member, 'r1', values);
    expect(calls[0]?.sql).not.toMatch(/deleted_at/);
    expect(calls[0]?.params.at(-1)).toBe('r1');
  });

  it('trashes and restores through deleted_at', async () => {
    const { db, calls } = fakeDb();
    await trashRecipe(db, member, 'r1');
    await restoreRecipe(db, member, 'r1');
    expect(calls[0]?.sql).toBe('update recipes set deleted_at = ? where id = ?');
    expect(typeof calls[0]?.params[0]).toBe('string');
    expect(calls[1]?.params).toEqual([null, 'r1']);
  });

  it('refuses every recipe write for a viewer', async () => {
    const { db } = fakeDb();
    await expect(createRecipe(db, viewer, values)).rejects.toThrow();
    await expect(updateRecipe(db, viewer, 'r1', values)).rejects.toThrow();
    await expect(trashRecipe(db, viewer, 'r1')).rejects.toThrow();
    await expect(restoreRecipe(db, viewer, 'r1')).rejects.toThrow();
  });
});

describe('setFavorite', () => {
  it('inserts a new favorite row the first time', async () => {
    const { db, calls } = fakeDb(null);
    await setFavorite(db, viewer, 'r1', true);
    expect(calls[0]?.sql).toMatch(/^insert into favorites/);
    expect(calls[0]?.params.slice(1)).toEqual(['h1', 'u1', 'r1']);
  });

  it('un-stars and re-stars the existing row', async () => {
    const { db, calls } = fakeDb({ id: 'f1' });
    await setFavorite(db, viewer, 'r1', false);
    await setFavorite(db, viewer, 'r1', true);
    expect(calls[0]?.sql).toBe('update favorites set deleted_at = ? where id = ?');
    expect(typeof calls[0]?.params[0]).toBe('string');
    expect(calls[1]?.params).toEqual([null, 'f1']);
  });

  it('does nothing when un-starring a recipe that was never starred', async () => {
    const { db, calls } = fakeDb(null);
    await setFavorite(db, viewer, 'r1', false);
    expect(calls).toHaveLength(0);
  });
});
```

`Claims` has `userId`, `householdId`, `role` (see `apps/mobile/src/session/claims.ts`).

- [ ] **Step 4: Run them and confirm they fail**

Run: `rtk vitest run apps/mobile`
Expected: FAIL; `rows`, `form`, `purge` cannot be resolved; repository and upload tests fail on the missing exports and behaviour.

- [ ] **Step 5: Local schema**

`apps/mobile/src/db/schema.ts`:

```ts
import { column, Schema, Table } from '@powersync/web';

// PowerSync adds the `id` column itself. Timestamps are ISO strings.
// ingredients, steps and tags hold JSON text (rows.ts parses them).
const recipes = new Table(
  {
    household_id: column.text,
    title: column.text,
    servings: column.integer,
    prep_minutes: column.integer,
    cook_minutes: column.integer,
    ingredients: column.text,
    steps: column.text,
    tags: column.text,
    notes: column.text,
    created_at: column.text,
    updated_at: column.text,
    updated_by: column.text,
    deleted_at: column.text,
  },
  { indexes: { household: ['household_id'] } },
);

// Only the signed-in user's rows sync here (user_favorites stream).
const favorites = new Table(
  {
    household_id: column.text,
    user_id: column.text,
    recipe_id: column.text,
    created_at: column.text,
    updated_at: column.text,
    updated_by: column.text,
    deleted_at: column.text,
  },
  { indexes: { recipe: ['recipe_id'] } },
);

export const AppSchema = new Schema({ recipes, favorites });

export type Database = (typeof AppSchema)['types'];
export type RecipeRow = Database['recipes'];
export type FavoriteRow = Database['favorites'];
```

- [ ] **Step 6: Rows and timestamps**

`apps/mobile/src/recipes/rows.ts`:

```ts
import { recipeSchema, type Ingredient, type Step } from '@recipe-app/domain';

export const TRASH_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export type RecipeRecord = {
  id: string;
  household_id: string;
  title: string;
  servings: number | null;
  prep_minutes: number | null;
  cook_minutes: number | null;
  ingredients: Ingredient[];
  steps: Step[];
  tags: string[];
  notes: string;
  deleted_at: string | null;
};

/** A Postgres text[] literal such as {quick,"two words"}. */
function fromArrayLiteral(text: string): string[] {
  const inner = text.slice(1, -1);
  if (inner === '') return [];
  return (inner.match(/"(?:[^"\\]|\\.)*"|[^,]+/g) ?? []).map((part) =>
    part.startsWith('"') ? part.slice(1, -1).replace(/\\(.)/g, '$1') : part,
  );
}

function jsonList(value: unknown): unknown {
  if (value === null || value === undefined || value === '') return [];
  if (typeof value !== 'string') return value;
  if (value.startsWith('{')) return fromArrayLiteral(value);
  return JSON.parse(value) as unknown;
}

/**
 * A local row as a recipe, or null when it cannot be read. Columns added
 * after a row was written arrive as null and read as empty.
 */
export function rowToRecipe(row: Record<string, unknown>): RecipeRecord | null {
  try {
    const parsed = recipeSchema.safeParse({
      id: row.id,
      household_id: row.household_id,
      title: row.title,
      servings: row.servings ?? null,
      prep_minutes: row.prep_minutes ?? null,
      cook_minutes: row.cook_minutes ?? null,
      ingredients: jsonList(row.ingredients),
      steps: jsonList(row.steps),
      tags: jsonList(row.tags),
      notes: row.notes ?? '',
    });
    if (!parsed.success) return null;
    const recipe = parsed.data;
    return {
      id: recipe.id,
      household_id: recipe.household_id,
      title: recipe.title,
      servings: recipe.servings ?? null,
      prep_minutes: recipe.prep_minutes ?? null,
      cook_minutes: recipe.cook_minutes ?? null,
      ingredients: recipe.ingredients ?? [],
      steps: recipe.steps ?? [],
      tags: recipe.tags ?? [],
      notes: recipe.notes ?? '',
      deleted_at: typeof row.deleted_at === 'string' ? row.deleted_at : null,
    };
  } catch {
    return null;
  }
}

/**
 * Milliseconds since the epoch, for timestamps written here ("…T…Z") and
 * those sync sends ("… …Z", "+00"). Safari's Date.parse accepts only the
 * strict ISO form, so the text is normalised first.
 */
export function parseTimestamp(text: string | null | undefined): number | null {
  if (!text) return null;
  const iso = text
    .trim()
    .replace(' ', 'T')
    .replace(/(\.\d{3})\d+/, '$1')
    .replace(/([+-]\d{2})$/, '$1:00');
  const value = Date.parse(iso);
  return Number.isNaN(value) ? null : value;
}

/** Whole days left before the purge, rounded up; 0 once due. */
export function trashDaysLeft(deletedAt: string, now: number): number {
  const deleted = parseTimestamp(deletedAt);
  if (deleted === null) return 0;
  return Math.max(0, Math.ceil((deleted + TRASH_DAYS * DAY_MS - now) / DAY_MS));
}
```

- [ ] **Step 7: Form conversion**

`apps/mobile/src/recipes/form.ts`:

```ts
import {
  ingredientsFromText,
  ingredientsToText,
  normalizeTags,
  recipeSchema,
  stepsFromText,
  stepsToText,
  type Ingredient,
  type Step,
} from '@recipe-app/domain';
import type { RecipeRecord } from './rows';

export type RecipeForm = {
  title: string;
  servings: string;
  prep: string;
  cook: string;
  ingredients: string;
  steps: string;
  tags: string;
  notes: string;
};

export type RecipeValues = {
  title: string;
  servings: number | null;
  prep_minutes: number | null;
  cook_minutes: number | null;
  ingredients: Ingredient[];
  steps: Step[];
  tags: string[];
  notes: string;
};

export type FormResult =
  | { ok: true; values: RecipeValues }
  | { ok: false; errors: Partial<Record<keyof RecipeForm, string>> };

// Which editor field each schema field is typed in.
const FIELD_OF: Record<string, keyof RecipeForm> = {
  title: 'title',
  servings: 'servings',
  prep_minutes: 'prep',
  cook_minutes: 'cook',
  ingredients: 'ingredients',
  steps: 'steps',
  tags: 'tags',
  notes: 'notes',
};

export function emptyForm(): RecipeForm {
  return { title: '', servings: '', prep: '', cook: '', ingredients: '', steps: '', tags: '', notes: '' };
}

export function formFromRecipe(recipe: RecipeRecord): RecipeForm {
  return {
    title: recipe.title,
    servings: recipe.servings === null ? '' : String(recipe.servings),
    prep: recipe.prep_minutes === null ? '' : String(recipe.prep_minutes),
    cook: recipe.cook_minutes === null ? '' : String(recipe.cook_minutes),
    ingredients: ingredientsToText(recipe.ingredients),
    steps: stepsToText(recipe.steps),
    tags: recipe.tags.join(', '),
    notes: recipe.notes,
  };
}

/** Empty text means "not set"; anything else must be a whole number. */
function whole(text: string): number | null {
  const value = text.trim();
  if (value === '') return null;
  return /^-?\d+$/.test(value) ? Number(value) : Number.NaN;
}

/** The editor's text as validated recipe values, or a message per field. */
export function valuesFromForm(
  form: RecipeForm,
  previous: RecipeRecord | null,
  newId: () => string,
): FormResult {
  const candidate = {
    title: form.title,
    servings: whole(form.servings),
    prep_minutes: whole(form.prep),
    cook_minutes: whole(form.cook),
    ingredients: ingredientsFromText(form.ingredients, previous?.ingredients ?? [], newId),
    steps: stepsFromText(form.steps, previous?.steps ?? [], newId),
    tags: normalizeTags(form.tags),
    notes: form.notes.trim(),
  };
  const parsed = recipeSchema
    .omit({ id: true, household_id: true, deleted_at: true })
    .safeParse(candidate);
  if (parsed.success) {
    return { ok: true, values: { ...candidate, title: parsed.data.title } };
  }
  const errors: Partial<Record<keyof RecipeForm, string>> = {};
  for (const issue of parsed.error.issues) {
    const field = FIELD_OF[String(issue.path[0])];
    if (field && !errors[field]) errors[field] = issue.message;
  }
  return { ok: false, errors };
}
```

`Number.NaN` fails zod's `number()` check with zod's own message, not "Servings must be 1 to 999". If the `servings`/`prep`/`cook` error messages in the test come out as zod's default ("Invalid input: expected number, received NaN"), map a `NaN` to the field's range message explicitly before parsing: set `errors[field]` from a small table `{ servings: 'Servings must be 1 to 999', prep: 'Prep must be 0 to 10000 minutes', cook: 'Cook must be 0 to 10000 minutes' }` and return early with all such errors merged with the schema's.

- [ ] **Step 8: Upload decoding and favorites fields**

In `apps/mobile/src/sync/upload.ts`, change the import and `CLIENT_FIELDS`, and decode JSON columns in `pickClientFields`:

```ts
import { FAVORITE_CLIENT_FIELDS, RECIPE_CLIENT_FIELDS } from '@recipe-app/domain';
```

```ts
/** Fields the client may upload, per table. Server-owned fields never leave the device. */
const CLIENT_FIELDS: Record<string, readonly string[]> = {
  recipes: RECIPE_CLIENT_FIELDS,
  favorites: FAVORITE_CLIENT_FIELDS,
};

// The local database stores these as JSON text; the API expects arrays.
const JSON_FIELDS: Record<string, readonly string[]> = {
  recipes: ['ingredients', 'steps', 'tags'],
};

function decoded(table: string, key: string, value: unknown): unknown {
  if (typeof value !== 'string' || !(JSON_FIELDS[table] ?? []).includes(key)) return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    // Left as text: the server rejects it rather than the upload loop failing.
    return value;
  }
}

function pickClientFields(table: string, data: Record<string, unknown> = {}) {
  const allowed = CLIENT_FIELDS[table] ?? [];
  return Object.fromEntries(
    Object.entries(data)
      .filter(([key, value]) => allowed.includes(key) && value !== undefined)
      .map(([key, value]) => [key, decoded(table, key, value)]),
  );
}
```

- [ ] **Step 9: Repository and hooks**

Replace `apps/mobile/src/recipes/repository.ts` with:

```ts
import type { AbstractPowerSyncDatabase } from '@powersync/web';
import { canWrite, type Claims } from '../session/claims';
import type { RecipeValues } from './form';

type Db = Pick<AbstractPowerSyncDatabase, 'execute' | 'getOptional'>;

// Live lists. The current user's id is the first parameter of the favorites
// joins; only that user's favorites are on this device anyway.
export const LIST_RECIPES_SQL = `
  select r.id, r.title, r.tags, f.id is not null as starred
  from recipes r
  left join favorites f on f.recipe_id = r.id and f.user_id = ? and f.deleted_at is null
  where r.deleted_at is null
  order by r.title collate nocase, r.id`;

export const LIST_FAVORITES_SQL = `
  select r.id, r.title, r.tags, 1 as starred
  from recipes r
  join favorites f on f.recipe_id = r.id and f.user_id = ? and f.deleted_at is null
  where r.deleted_at is null
  order by r.title collate nocase, r.id`;

export const RECIPE_SQL = 'select * from recipes where id = ?';
export const STARRED_SQL =
  'select id from favorites where recipe_id = ? and user_id = ? and deleted_at is null';
export const TRASH_SQL =
  'select id, title, deleted_at from recipes where deleted_at is not null';
export const TAGS_SQL = 'select tags from recipes where deleted_at is null';

function requireWriter(claims: Claims): void {
  if (!canWrite(claims.role)) throw new Error('Viewers cannot change recipes');
}

function columns(values: RecipeValues): unknown[] {
  return [
    values.title,
    values.servings,
    values.prep_minutes,
    values.cook_minutes,
    JSON.stringify(values.ingredients),
    JSON.stringify(values.steps),
    JSON.stringify(values.tags),
    values.notes,
  ];
}

/**
 * Writes to the local database only. PowerSync queues the row for upload.
 * created_at, updated_at, and updated_by are set by the server.
 */
export async function createRecipe(db: Db, claims: Claims, values: RecipeValues): Promise<string> {
  requireWriter(claims);
  const id = crypto.randomUUID();
  await db.execute(
    `insert into recipes (id, household_id, title, servings, prep_minutes, cook_minutes,
       ingredients, steps, tags, notes) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, claims.householdId, ...columns(values)],
  );
  return id;
}

/** Saves the whole recipe; never changes whether it is in the Trash. */
export async function updateRecipe(
  db: Db,
  claims: Claims,
  id: string,
  values: RecipeValues,
): Promise<void> {
  requireWriter(claims);
  await db.execute(
    `update recipes set title = ?, servings = ?, prep_minutes = ?, cook_minutes = ?,
       ingredients = ?, steps = ?, tags = ?, notes = ? where id = ?`,
    [...columns(values), id],
  );
}

export async function trashRecipe(db: Db, claims: Claims, id: string): Promise<void> {
  requireWriter(claims);
  await db.execute('update recipes set deleted_at = ? where id = ?', [new Date().toISOString(), id]);
}

export async function restoreRecipe(db: Db, claims: Claims, id: string): Promise<void> {
  requireWriter(claims);
  await db.execute('update recipes set deleted_at = ? where id = ?', [null, id]);
}

/** Any role may star: a favorite changes only the user's own list. */
export async function setFavorite(
  db: Db,
  claims: Claims,
  recipeId: string,
  starred: boolean,
): Promise<void> {
  const existing = await db.getOptional<{ id: string }>(
    'select id from favorites where user_id = ? and recipe_id = ?',
    [claims.userId, recipeId],
  );
  if (existing) {
    await db.execute('update favorites set deleted_at = ? where id = ?', [
      starred ? null : new Date().toISOString(),
      existing.id,
    ]);
  } else if (starred) {
    await db.execute(
      'insert into favorites (id, household_id, user_id, recipe_id) values (?, ?, ?, ?)',
      [crypto.randomUUID(), claims.householdId, claims.userId, recipeId],
    );
  }
}
```

`apps/mobile/src/recipes/hooks.ts`:

```ts
import { useQuery } from '@powersync/react';
import { useMemo } from 'react';
import {
  LIST_FAVORITES_SQL,
  LIST_RECIPES_SQL,
  RECIPE_SQL,
  STARRED_SQL,
  TAGS_SQL,
  TRASH_SQL,
} from './repository';
import { parseTimestamp, rowToRecipe, TRASH_DAYS, type RecipeRecord } from './rows';

export type ListItem = { id: string; title: string; tags: string[]; starred: boolean };
export type TrashItem = { id: string; title: string; deleted_at: string };

function tagsOf(value: unknown): string[] {
  return rowToRecipe({ id: '00000000-0000-0000-0000-000000000000', household_id: '00000000-0000-0000-0000-000000000000', title: 'x', tags: value })?.tags ?? [];
}

/** The household's recipes, or the user's favorites, live from the local database. */
export function useRecipeList(userId: string, favoritesOnly: boolean): ListItem[] {
  const { data } = useQuery<{ id: string; title: string; tags: unknown; starred: unknown }>(
    favoritesOnly ? LIST_FAVORITES_SQL : LIST_RECIPES_SQL,
    [userId],
  );
  return useMemo(
    () =>
      data.map((row) => ({
        id: row.id,
        title: row.title,
        tags: tagsOf(row.tags),
        starred: Boolean(row.starred),
      })),
    [data],
  );
}

/** undefined while loading; null when missing or unreadable. */
export function useRecipe(
  id: string,
  userId: string,
): { recipe: RecipeRecord | null | undefined; starred: boolean } {
  const { data, isLoading } = useQuery<Record<string, unknown>>(RECIPE_SQL, [id]);
  const { data: stars } = useQuery<{ id: string }>(STARRED_SQL, [id, userId]);
  const row = data[0];
  const recipe = isLoading ? undefined : row ? rowToRecipe(row) : null;
  return { recipe, starred: stars.length > 0 };
}

/** Trash from the last 30 days, newest first. */
export function useTrash(now = Date.now()): TrashItem[] {
  const { data } = useQuery<{ id: string; title: string; deleted_at: string }>(TRASH_SQL);
  return useMemo(() => {
    const cutoff = now - TRASH_DAYS * 24 * 60 * 60 * 1000;
    return data
      .map((row) => ({ ...row, at: parseTimestamp(row.deleted_at) ?? 0 }))
      .filter((row) => row.at > cutoff)
      .sort((a, b) => b.at - a.at)
      .map(({ at: _at, ...row }) => row);
  }, [data, now]);
}

/** Distinct tags on the household's recipes, alphabetically. */
export function useHouseholdTags(): string[] {
  const { data } = useQuery<{ tags: unknown }>(TAGS_SQL);
  return useMemo(
    () => [...new Set(data.flatMap((row) => tagsOf(row.tags)))].sort(),
    [data],
  );
}
```

If `useQuery` returns no `isLoading` in this `@powersync/react` version, read its type in `node_modules/@powersync/react/lib/hooks/useQuery.d.ts` and use the field it has.

- [ ] **Step 10: The purge call**

`apps/mobile/src/sync/purge.ts`:

```ts
import { config } from '../config';
import { auth } from '../session/auth';

export const PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const KEY = 'recipes.lastPurge';

export function purgeDue(last: string | null, now: number): boolean {
  if (last === null) return true;
  const at = Number(last);
  return !Number.isFinite(at) || now - at >= PURGE_INTERVAL_MS;
}

/**
 * Asks the server to delete this household's trash older than 30 days
 * (FR-18), at most once a day per device. Failures wait for the next connect.
 */
export async function purgeTrashIfDue(): Promise<void> {
  const storage = globalThis.localStorage;
  if (!storage || !purgeDue(storage.getItem(KEY), Date.now())) return;
  try {
    const { data } = await auth.getSession();
    if (!data.session) return;
    const response = await fetch(`${config.apiUrl}/trash/purge`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${data.session.access_token}` },
    });
    if (response.ok) storage.setItem(KEY, String(Date.now()));
  } catch {
    // Offline or refused: try again on the next connect.
  }
}
```

In `apps/mobile/src/db/DatabaseSessionBridge.tsx`:
- Import `canWrite` from `'../session/claims'` and `purgeTrashIfDue` from `'../sync/purge'`.
- Add `const writer = state.status === 'signedIn' && state.claims !== null && canWrite(state.claims.role);` beside the other primitives, and add `writer` to the effect's dependency list.
- Change the connect branch to:

```ts
        if (session.status === 'signedIn' && hasHousehold && online) {
          await db.connect(connector);
          if (writer) void purgeTrashIfDue();
        } else {
```

- [ ] **Step 11: Run the unit tests and confirm they pass**

Run: `rtk vitest run apps/mobile`
Expected: PASS. Fix the code (not the tests) unless a test contradicts the spec.

- [ ] **Step 12: Keep the old screens compiling until Task 5**

`AddRecipeForm.tsx` and `useRecipes.ts` still use the old repository. Task 5 deletes both; until then, make these two minimal changes so Task 4 has its own green commit:

`apps/mobile/src/recipes/useRecipes.ts`:

```ts
import { useQuery } from '@powersync/react';

export type RecipeListItem = { id: string; title: string };

// Temporary until Task 5 replaces the list screen with hooks.ts.
const SQL = 'select id, title from recipes where deleted_at is null order by title collate nocase, id';

/** Live list of the household's recipes from the local database. */
export function useRecipes() {
  return useQuery<RecipeListItem>(SQL);
}
```

In `apps/mobile/src/components/AddRecipeForm.tsx`, import `recipeTitleSchema` from `'@recipe-app/domain'` and replace the `createRecipe(db, claims, title)` call with:

```ts
      await createRecipe(db, claims, {
        title: recipeTitleSchema.parse(title),
        servings: null,
        prep_minutes: null,
        cook_minutes: null,
        ingredients: [],
        steps: [],
        tags: [],
        notes: '',
      });
```

Run: `rtk pnpm lint && rtk pnpm typecheck && rtk pnpm test`
Expected: all exit 0.

- [ ] **Step 13: Commit**

Run: `rtk pnpm lint && rtk pnpm typecheck && rtk pnpm test && rtk pnpm test:e2e`
Expected: all exit 0; the app behaves as before, and its data layer is ready for Task 5.

Message: `feat(app): local schema, upload decoding, recipe rows and form, repository, and the daily trash purge call (FR-15, FR-16, FR-17, FR-18)`.

---

### Task 5: Screens: list, recipe, editor, routes; acceptance tests for editing

**Files:**
- Create: `apps/mobile/src/session/SignedIn.tsx`, `apps/mobile/src/components/confirm.ts`, `apps/mobile/src/components/RecipeEditor.tsx`, `apps/mobile/src/components/StarButton.tsx`
- Create: `apps/mobile/src/screens/RecipeScreen.tsx`, `apps/mobile/src/screens/EditRecipeScreen.tsx`
- Modify: `apps/mobile/src/screens/RecipeListScreen.tsx`
- Create: `apps/mobile/app/recipe/new.tsx`, `apps/mobile/app/recipe/[id]/index.tsx`, `apps/mobile/app/recipe/[id]/edit.tsx`
- Modify: `apps/mobile/app/index.tsx`
- Delete: `apps/mobile/src/components/AddRecipeForm.tsx`, `apps/mobile/src/recipes/useRecipes.ts`
- Modify: `e2e/helpers.ts`; rewrite `e2e/recipes.spec.ts`

**Interfaces:**
- Consumes: Task 4's hooks, repository, `valuesFromForm`, `emptyForm`, `formFromRecipe`, `RecipeRecord`, `ListItem`.
- Produces: routes `/`, `/recipe/new`, `/recipe/[id]`, `/recipe/[id]/edit`; e2e helpers `addRecipe(page, title)` (through the editor, ends on the list) and `createFullRecipe(page, form)`; `SignedIn` and `confirm(message): Promise<boolean>` for Task 6.

- [ ] **Step 1: Write the failing acceptance tests**

Replace `addRecipe` in `e2e/helpers.ts` and add helpers:

```ts
export type RecipeInput = {
  title: string;
  servings?: string;
  prep?: string;
  cook?: string;
  ingredients?: string;
  steps?: string;
  tags?: string;
  notes?: string;
};

/** Fills the open editor. Empty fields are left as they are. */
export async function fillEditor(page: Page, input: RecipeInput): Promise<void> {
  const fields: [string, string | undefined][] = [
    ['Title', input.title],
    ['Servings', input.servings],
    ['Prep (min)', input.prep],
    ['Cook (min)', input.cook],
    ['Ingredients', input.ingredients],
    ['Steps', input.steps],
    ['Tags', input.tags],
    ['Notes', input.notes],
  ];
  for (const [label, value] of fields) {
    if (value !== undefined) await page.getByLabel(label, { exact: true }).fill(value);
  }
}

/** Creates a recipe through the editor and ends on the recipe's own screen. */
export async function createRecipe(page: Page, input: RecipeInput): Promise<void> {
  await page.getByRole('button', { name: 'New recipe' }).click();
  await fillEditor(page, input);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: input.title, level: 1 })).toBeVisible();
}

/** Creates a title-only recipe and returns to the list (the walking-skeleton flow). */
export async function addRecipe(page: Page, title: string): Promise<void> {
  await createRecipe(page, { title });
  await page.getByRole('link', { name: 'All recipes' }).click();
  await expect(page.getByText(title, { exact: true })).toBeVisible();
}
```

Rewrite `e2e/recipes.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import {
  createRecipe,
  fillEditor,
  freshEmail,
  SEED,
  session,
  signIn,
  unique,
} from './helpers';

const NFR5_MS = 10_000;

test('a recipe typed in full shows every field as typed and reaches another member', async ({
  browser,
}) => {
  const member = await session(browser, SEED.memberA);
  const admin = await session(browser, SEED.adminA);
  const title = unique('Grandma bread');
  await createRecipe(member, {
    title,
    servings: '4',
    prep: '15',
    cook: '40',
    ingredients: 'For the dough:\n2 1/2 cups flour, sifted\n1 tsp salt',
    steps: '1. Mix everything\n2. Bake',
    tags: 'Bread, Weekend',
    notes: 'Use the old pan',
  });
  for (const text of [
    'Serves 4 · Prep 15 min · Cook 40 min',
    'For the dough:',
    '2 1/2 cups flour, sifted',
    '1 tsp salt',
    'Mix everything',
    'Bake',
    'bread',
    'weekend',
    'Use the old pan',
  ]) {
    await expect(member.getByText(text, { exact: true })).toBeVisible();
  }

  // The other session reads synced JSON ingredients and the text[] tags.
  await admin.getByText(title, { exact: true }).click({ timeout: NFR5_MS });
  await expect(admin.getByText('2 1/2 cups flour, sifted', { exact: true })).toBeVisible();
  await expect(admin.getByText('weekend', { exact: true })).toBeVisible();
});

test('editing ingredients and steps reaches the other session', async ({ browser }) => {
  const member = await session(browser, SEED.memberA);
  const admin = await session(browser, SEED.adminA);
  const title = unique('Edited stew');
  await createRecipe(member, { title, ingredients: '1 onion', steps: 'Chop' });
  await member.getByRole('button', { name: 'Edit' }).click();
  await fillEditor(member, { title, ingredients: '2 onions\n1 carrot', steps: 'Chop\nSimmer' });
  await member.getByRole('button', { name: 'Save' }).click();
  await expect(member.getByText('1 carrot', { exact: true })).toBeVisible();

  await admin.getByText(title, { exact: true }).click({ timeout: NFR5_MS });
  await expect(admin.getByText('Simmer', { exact: true })).toBeVisible({ timeout: NFR5_MS });
  await expect(admin.getByText('1 onion', { exact: true })).toHaveCount(0);
});

test('an empty title or 0 servings shows messages and saves nothing', async ({ page }) => {
  await signIn(page, freshEmail('invalid'));
  await page.getByRole('button', { name: 'New recipe' }).click();
  await fillEditor(page, { title: '   ', servings: '0' });
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Title is required')).toBeVisible();
  await expect(page.getByText('Servings must be 1 to 999')).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText('No recipes yet')).toBeVisible();
});

test('cancel with changes asks before discarding', async ({ page }) => {
  await signIn(page, freshEmail('cancel'));
  await page.getByRole('button', { name: 'New recipe' }).click();
  await fillEditor(page, { title: 'Half typed' });

  page.once('dialog', (dialog) => {
    expect(dialog.message()).toBe('Discard your changes?');
    void dialog.dismiss();
  });
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Half typed');

  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText('No recipes yet')).toBeVisible();
});

test('a double tap on Save creates one recipe', async ({ page }) => {
  await signIn(page, freshEmail('double'));
  await page.getByRole('button', { name: 'New recipe' }).click();
  await fillEditor(page, { title: 'Only once' });
  await page.getByRole('button', { name: 'Save' }).dblclick();
  await expect(page.getByRole('heading', { name: 'Only once', level: 1 })).toBeVisible();
  await page.getByRole('link', { name: 'All recipes' }).click();
  await expect(page.getByText('Only once', { exact: true })).toHaveCount(1);
});

test('a recipe created and edited offline syncs once back online', async ({ browser }) => {
  const member = await session(browser, SEED.memberA);
  const admin = await session(browser, SEED.adminA);
  await expect(member.getByText('Seed pancakes', { exact: true })).toBeVisible({ timeout: 30_000 });
  await member.context().setOffline(true);
  const title = unique('Offline casserole');
  await createRecipe(member, { title, ingredients: '1 can soup' });
  await member.getByRole('button', { name: 'Edit' }).click();
  await fillEditor(member, { title, ingredients: '2 cans soup' });
  await member.getByRole('button', { name: 'Save' }).click();
  await member.context().setOffline(false);

  await admin.getByText(title, { exact: true }).click({ timeout: 45_000 });
  await expect(admin.getByText('2 cans soup', { exact: true })).toBeVisible({ timeout: 45_000 });
});

test('tag chips offer tags the household already uses', async ({ page }) => {
  await signIn(page, freshEmail('tags'));
  await createRecipe(page, { title: 'First', tags: 'dinner' });
  await page.getByRole('link', { name: 'All recipes' }).click();
  await page.getByRole('button', { name: 'New recipe' }).click();
  await fillEditor(page, { title: 'Second' });
  await page.getByRole('button', { name: 'Add tag dinner' }).click();
  await expect(page.getByLabel('Tags', { exact: true })).toHaveValue('dinner');
});

test('a viewer sees recipes but no New recipe, Edit, Move to Trash, or Trash', async ({ page }) => {
  await signIn(page, SEED.viewerA);
  await expect(page.getByText('Seed pancakes', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'New recipe' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Trash' })).toHaveCount(0);
  await page.getByText('Seed pancakes', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Seed pancakes', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Move to Trash' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^(Star|Unstar)$/ })).toBeVisible();
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `rtk pnpm test:e2e e2e/recipes.spec.ts`
Expected: FAIL: no "New recipe" button.

- [ ] **Step 3: Shared pieces**

`apps/mobile/src/components/confirm.ts`:

```ts
/**
 * Asks a yes/no question. On the web this is the browser's own dialog,
 * which every browser renders accessibly; native builds will need Alert.
 */
export async function confirm(message: string): Promise<boolean> {
  return typeof globalThis.confirm === 'function' ? globalThis.confirm(message) : true;
}
```

`apps/mobile/src/session/SignedIn.tsx`:

```tsx
import { Redirect } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { Claims } from './claims';
import { useSession } from './SessionProvider';

/** Renders its children only for a signed-in user with a household. */
export function SignedIn({ children }: { children: (claims: Claims) => ReactNode }) {
  const { state, signOut } = useSession();
  if (state.status === 'loading') return null;
  if (state.status === 'signedOut') return <Redirect href="/sign-in" />;
  if (state.claims === null) {
    return (
      <View style={{ padding: 16, gap: 12, maxWidth: 640 }}>
        <Text role="alert">
          Your account is not linked to a household. Sign out and back in; if this continues,
          contact your household admin.
        </Text>
        <Pressable role="button" onPress={() => void signOut()}>
          <Text style={{ textDecorationLine: 'underline' }}>Sign out</Text>
        </Pressable>
      </View>
    );
  }
  return <>{children(state.claims)}</>;
}
```

`apps/mobile/src/components/StarButton.tsx`:

```tsx
import { usePowerSync } from '@powersync/react';
import { Pressable, Text } from 'react-native';
import { setFavorite } from '../recipes/repository';
import type { Claims } from '../session/claims';

export function StarButton({
  claims,
  recipeId,
  starred,
}: {
  claims: Claims;
  recipeId: string;
  starred: boolean;
}) {
  const db = usePowerSync();
  return (
    <Pressable
      role="button"
      aria-label={starred ? 'Unstar' : 'Star'}
      aria-pressed={starred}
      hitSlop={8}
      onPress={() => void setFavorite(db, claims, recipeId, !starred)}
    >
      <Text style={{ fontSize: 22, color: starred ? '#c98a00' : '#888' }}>{starred ? '★' : '☆'}</Text>
    </Pressable>
  );
}
```

- [ ] **Step 4: The editor**

`apps/mobile/src/components/RecipeEditor.tsx`:

```tsx
import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useHouseholdTags } from '../recipes/hooks';
import { valuesFromForm, type RecipeForm, type RecipeValues } from '../recipes/form';
import type { RecipeRecord } from '../recipes/rows';
import { normalizeTags } from '@recipe-app/domain';
import { confirm } from './confirm';

const input = { borderWidth: 1, borderColor: '#888', borderRadius: 6, padding: 10, fontSize: 16 } as const;
const button = { backgroundColor: '#1a5d3a', borderRadius: 6, padding: 12, flex: 1 } as const;

type Props = {
  initial: RecipeForm;
  previous: RecipeRecord | null;
  onSave: (values: RecipeValues) => Promise<void>;
  onCancel: () => void;
};

/** One form for new and existing recipes. Nothing is written until it is valid. */
export function RecipeEditor({ initial, previous, onSave, onCancel }: Props) {
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<Partial<Record<keyof RecipeForm, string>>>({});
  const [busy, setBusy] = useState(false);
  const householdTags = useHouseholdTags();
  const current = normalizeTags(form.tags);
  const suggestions = householdTags.filter((tag) => !current.includes(tag));
  const changed = (Object.keys(form) as (keyof RecipeForm)[]).some((key) => form[key] !== initial[key]);

  const set = (key: keyof RecipeForm) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  async function save() {
    if (busy) return; // a double tap must not save twice
    const result = valuesFromForm(form, previous, () => crypto.randomUUID());
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setBusy(true);
    setErrors({});
    try {
      await onSave(result.values);
    } catch {
      setErrors({ title: 'Could not save the recipe. Try again.' });
      setBusy(false);
    }
  }

  async function cancel() {
    if (!changed || (await confirm('Discard your changes?'))) onCancel();
  }

  function field(key: keyof RecipeForm, label: string, extra: object = {}) {
    return (
      <View style={{ gap: 4 }}>
        <Text>{label}</Text>
        <TextInput aria-label={label} value={form[key]} onChangeText={set(key)} style={input} {...extra} />
        {errors[key] ? (
          <Text role="alert" style={{ color: '#b00020' }}>
            {errors[key]}
          </Text>
        ) : null}
      </View>
    );
  }

  const multiline = { multiline: true, numberOfLines: 6, textAlignVertical: 'top' as const };
  const numeric = { keyboardType: 'number-pad' as const, inputMode: 'numeric' as const };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12, maxWidth: 640 }}>
      {field('title', 'Title')}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}>{field('servings', 'Servings', numeric)}</View>
        <View style={{ flex: 1 }}>{field('prep', 'Prep (min)', numeric)}</View>
        <View style={{ flex: 1 }}>{field('cook', 'Cook (min)', numeric)}</View>
      </View>
      {field('ingredients', 'Ingredients', { ...multiline, placeholder: 'One per line, e.g. 2 cups flour, sifted' })}
      {field('steps', 'Steps', { ...multiline, placeholder: 'One step per line' })}
      {field('tags', 'Tags', { placeholder: 'Comma-separated, e.g. dinner, quick', autoCapitalize: 'none' })}
      {suggestions.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {suggestions.map((tag) => (
            <Pressable
              key={tag}
              role="button"
              aria-label={`Add tag ${tag}`}
              onPress={() => set('tags')([...current, tag].join(', '))}
              style={{ borderWidth: 1, borderColor: '#1a5d3a', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 }}
            >
              <Text>{tag}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {field('notes', 'Notes', multiline)}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Pressable role="button" aria-disabled={busy} onPress={() => void save()} style={button}>
          <Text style={{ color: '#fff', fontSize: 16, textAlign: 'center' }}>Save</Text>
        </Pressable>
        <Pressable role="button" onPress={() => void cancel()} style={{ ...button, backgroundColor: '#666' }}>
          <Text style={{ color: '#fff', fontSize: 16, textAlign: 'center' }}>Cancel</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
```

Move the `@recipe-app/domain` import above the local imports when lint orders them.

- [ ] **Step 5: The screens**

`apps/mobile/src/screens/EditRecipeScreen.tsx`:

```tsx
import { usePowerSync } from '@powersync/react';
import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { RecipeEditor } from '../components/RecipeEditor';
import { emptyForm, formFromRecipe } from '../recipes/form';
import { useRecipe } from '../recipes/hooks';
import { createRecipe, updateRecipe } from '../recipes/repository';
import { canWrite, type Claims } from '../session/claims';

/** New recipe when `id` is null; otherwise edits that recipe. */
export function EditRecipeScreen({ claims, id }: { claims: Claims; id: string | null }) {
  const db = usePowerSync();
  const { recipe } = useRecipe(id ?? '', claims.userId);
  if (!canWrite(claims.role)) return <Text style={{ padding: 16 }}>Viewers cannot edit recipes.</Text>;
  if (id !== null && recipe === undefined) return null;
  if (id !== null && recipe === null) {
    return <Text style={{ padding: 16 }}>This recipe could not be read.</Text>;
  }
  const previous = recipe ?? null;

  return (
    <View style={{ flex: 1 }}>
      <RecipeEditor
        initial={previous ? formFromRecipe(previous) : emptyForm()}
        previous={previous}
        onCancel={() => (id ? router.replace(`/recipe/${id}`) : router.replace('/'))}
        onSave={async (values) => {
          const savedId = id ?? (await createRecipe(db, claims, values));
          if (id) await updateRecipe(db, claims, id, values);
          router.replace(`/recipe/${savedId}`);
        }}
      />
    </View>
  );
}
```

`apps/mobile/src/screens/RecipeScreen.tsx`:

```tsx
import { usePowerSync } from '@powersync/react';
import { Link, router } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { StarButton } from '../components/StarButton';
import { confirm } from '../components/confirm';
import { useRecipe } from '../recipes/hooks';
import { restoreRecipe, trashRecipe } from '../recipes/repository';
import type { RecipeRecord } from '../recipes/rows';
import { canWrite, type Claims } from '../session/claims';

function summary(recipe: RecipeRecord): string {
  return [
    recipe.servings !== null ? `Serves ${recipe.servings}` : null,
    recipe.prep_minutes !== null ? `Prep ${recipe.prep_minutes} min` : null,
    recipe.cook_minutes !== null ? `Cook ${recipe.cook_minutes} min` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

const link = { textDecorationLine: 'underline' } as const;

export function RecipeScreen({ claims, id }: { claims: Claims; id: string }) {
  const db = usePowerSync();
  const { recipe, starred } = useRecipe(id, claims.userId);
  const writer = canWrite(claims.role);
  if (recipe === undefined) return null;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12, maxWidth: 640 }}>
      <Link href="/" style={link}>
        All recipes
      </Link>
      {recipe === null ? (
        <Text role="alert">This recipe could not be read.</Text>
      ) : (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text role="heading" aria-level={1} style={{ fontSize: 24, fontWeight: '600', flex: 1 }}>
              {recipe.title}
            </Text>
            <StarButton claims={claims} recipeId={recipe.id} starred={starred} />
          </View>
          {recipe.deleted_at ? (
            <View style={{ gap: 8 }}>
              <Text role="alert">This recipe is in the Trash</Text>
              {writer ? (
                <Pressable role="button" onPress={() => void restoreRecipe(db, claims, recipe.id)}>
                  <Text style={link}>Restore</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          {summary(recipe) ? <Text>{summary(recipe)}</Text> : null}
          {recipe.tags.length > 0 ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {recipe.tags.map((tag) => (
                <Text key={tag} style={{ backgroundColor: '#e6f0ea', borderRadius: 10, paddingHorizontal: 8 }}>
                  {tag}
                </Text>
              ))}
            </View>
          ) : null}
          {recipe.ingredients.length > 0 ? (
            <View style={{ gap: 4 }}>
              <Text role="heading" aria-level={2} style={{ fontSize: 18, fontWeight: '600' }}>
                Ingredients
              </Text>
              {recipe.ingredients.map((ingredient) => (
                <Text key={ingredient.id} style={ingredient.heading ? { fontWeight: '600', marginTop: 6 } : undefined}>
                  {ingredient.raw}
                </Text>
              ))}
            </View>
          ) : null}
          {recipe.steps.length > 0 ? (
            <View style={{ gap: 6 }}>
              <Text role="heading" aria-level={2} style={{ fontSize: 18, fontWeight: '600' }}>
                Steps
              </Text>
              {recipe.steps.map((step, index) => (
                <View key={step.id} style={{ flexDirection: 'row', gap: 8 }}>
                  <Text aria-hidden>{index + 1}.</Text>
                  <Text style={{ flex: 1 }}>{step.text}</Text>
                </View>
              ))}
            </View>
          ) : null}
          {recipe.notes ? (
            <View style={{ gap: 4 }}>
              <Text role="heading" aria-level={2} style={{ fontSize: 18, fontWeight: '600' }}>
                Notes
              </Text>
              <Text>{recipe.notes}</Text>
            </View>
          ) : null}
          {writer && !recipe.deleted_at ? (
            <View style={{ flexDirection: 'row', gap: 16 }}>
              <Pressable role="button" onPress={() => router.push(`/recipe/${recipe.id}/edit`)}>
                <Text style={link}>Edit</Text>
              </Pressable>
              <Pressable
                role="button"
                onPress={async () => {
                  if (await confirm(`Move "${recipe.title}" to the Trash?`)) {
                    await trashRecipe(db, claims, recipe.id);
                    router.replace('/');
                  }
                }}
              >
                <Text style={{ ...link, color: '#b00020' }}>Move to Trash</Text>
              </Pressable>
            </View>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}
```

The steps' numbers are `aria-hidden`, so the test's `getByText('Bake', { exact: true })` finds the step text alone.

Replace `apps/mobile/src/screens/RecipeListScreen.tsx` with:

```tsx
import { Link, router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { BuildFooter } from '../components/BuildFooter';
import { StarButton } from '../components/StarButton';
import { StatusLine } from '../components/StatusLine';
import { useRecipeList } from '../recipes/hooks';
import { canWrite, type Claims } from '../session/claims';
import { useSession } from '../session/SessionProvider';

const link = { textDecorationLine: 'underline' } as const;

export function RecipeListScreen({ claims }: { claims: Claims }) {
  const { signOut } = useSession();
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const recipes = useRecipeList(claims.userId, favoritesOnly);
  const writer = canWrite(claims.role);

  return (
    <View style={{ padding: 16, gap: 12, maxWidth: 640, flex: 1 }}>
      <Text role="heading" aria-level={1} style={{ fontSize: 24, fontWeight: '600' }}>
        Recipes
      </Text>
      <StatusLine />
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
        {(['All', 'Favorites'] as const).map((label) => {
          const selected = (label === 'Favorites') === favoritesOnly;
          return (
            <Pressable
              key={label}
              role="tab"
              aria-selected={selected}
              onPress={() => setFavoritesOnly(label === 'Favorites')}
            >
              <Text style={{ fontWeight: selected ? '700' : '400' }}>{label}</Text>
            </Pressable>
          );
        })}
        <View style={{ flex: 1 }} />
        {writer ? (
          <Link href="/trash" style={link}>
            Trash
          </Link>
        ) : null}
      </View>
      {/* Viewers cannot write: RLS refuses it, and these controls are not rendered. */}
      {writer ? (
        <Pressable
          role="button"
          onPress={() => router.push('/recipe/new')}
          style={{ backgroundColor: '#1a5d3a', borderRadius: 6, padding: 12 }}
        >
          <Text style={{ color: '#fff', fontSize: 16, textAlign: 'center' }}>New recipe</Text>
        </Pressable>
      ) : null}
      <FlatList
        data={recipes}
        keyExtractor={(recipe) => recipe.id}
        renderItem={({ item }) => (
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 8 }}>
            <Pressable style={{ flex: 1 }} onPress={() => router.push(`/recipe/${item.id}`)}>
              <Text style={{ fontSize: 18 }}>{item.title}</Text>
              {item.tags.length > 0 ? (
                <Text style={{ color: '#666' }}>{item.tags.join(' · ')}</Text>
              ) : null}
            </Pressable>
            <StarButton claims={claims} recipeId={item.id} starred={item.starred} />
          </View>
        )}
        ListEmptyComponent={
          <Text>{favoritesOnly ? 'No favorites yet' : 'No recipes yet'}</Text>
        }
      />
      <Pressable role="button" onPress={() => void signOut()}>
        <Text style={link}>Sign out</Text>
      </Pressable>
      <BuildFooter />
    </View>
  );
}
```

The list's tags render as one joined line ("bread · weekend"), so `getByText('bread', { exact: true })` in the e2e test matches only the recipe screen's tag chip. Confirm by running the test.

- [ ] **Step 6: Routes**

`apps/mobile/app/index.tsx`:

```tsx
import { RecipeListScreen } from '../src/screens/RecipeListScreen';
import { SignedIn } from '../src/session/SignedIn';

export default function Home() {
  return <SignedIn>{(claims) => <RecipeListScreen claims={claims} />}</SignedIn>;
}
```

`apps/mobile/app/recipe/new.tsx`:

```tsx
import { EditRecipeScreen } from '../../src/screens/EditRecipeScreen';
import { SignedIn } from '../../src/session/SignedIn';

export default function NewRecipe() {
  return <SignedIn>{(claims) => <EditRecipeScreen claims={claims} id={null} />}</SignedIn>;
}
```

`apps/mobile/app/recipe/[id]/index.tsx`:

```tsx
import { useLocalSearchParams } from 'expo-router';
import { RecipeScreen } from '../../../src/screens/RecipeScreen';
import { SignedIn } from '../../../src/session/SignedIn';

export default function Recipe() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <SignedIn>{(claims) => <RecipeScreen claims={claims} id={String(id)} />}</SignedIn>;
}
```

`apps/mobile/app/recipe/[id]/edit.tsx`:

```tsx
import { useLocalSearchParams } from 'expo-router';
import { EditRecipeScreen } from '../../../src/screens/EditRecipeScreen';
import { SignedIn } from '../../../src/session/SignedIn';

export default function EditRecipe() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <SignedIn>{(claims) => <EditRecipeScreen claims={claims} id={String(id)} />}</SignedIn>;
}
```

Delete `apps/mobile/src/components/AddRecipeForm.tsx` and `apps/mobile/src/recipes/useRecipes.ts` (Task 4 Step 12 kept them compiling).

- [ ] **Step 7: Run the editing tests and confirm they pass**

Run: `rtk pnpm test:e2e e2e/recipes.spec.ts`
Expected: 8 passed. If the double-tap test creates two recipes, the `busy` guard runs too late: set it before `valuesFromForm` and clear it on validation failure.

- [ ] **Step 8: Run everything**

Run: `rtk pnpm lint && rtk pnpm typecheck && rtk pnpm test && rtk pnpm test:e2e`
Expected: all exit 0. Every older spec uses the new `addRecipe` helper; `offline-start.spec.ts` and `sync.spec.ts` assert the list's status line after `addRecipe`, which now ends on the list.

- [ ] **Step 9: Commit**

Message: `feat(app): recipe screen and editor with one-line ingredients, steps, tags, and notes (FR-15, FR-16, FR-28)`.

---

### Task 6: Favorites filter and Trash screen; acceptance tests

**Files:**
- Create: `apps/mobile/src/screens/TrashScreen.tsx`, `apps/mobile/app/trash.tsx`
- Test: `e2e/favorites.spec.ts`, `e2e/trash.spec.ts`

**Interfaces:**
- Consumes: Task 4's `useTrash`, `restoreRecipe`, `trashDaysLeft`; Task 5's `SignedIn`, `StarButton`, list tabs, `createRecipe` e2e helper.

- [ ] **Step 1: Write the failing acceptance tests**

`e2e/favorites.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { createRecipe, SEED, session, unique } from './helpers';

test('starring shows a recipe under Favorites, only for the user who starred it', async ({
  browser,
}) => {
  const member = await session(browser, SEED.memberA);
  const admin = await session(browser, SEED.adminA);
  const title = unique('Starred pie');
  await createRecipe(member, { title });
  await member.getByRole('button', { name: 'Star' }).click();
  await expect(member.getByRole('button', { name: 'Unstar' })).toBeVisible();
  await member.getByRole('link', { name: 'All recipes' }).click();
  await member.getByRole('tab', { name: 'Favorites' }).click();
  await expect(member.getByText(title, { exact: true })).toBeVisible();
  await expect(member.getByText('Seed pancakes', { exact: true })).toHaveCount(0);

  await expect(admin.getByText(title, { exact: true })).toBeVisible({ timeout: 10_000 });
  await admin.getByRole('tab', { name: 'Favorites' }).click();
  await expect(admin.getByText(title, { exact: true })).toHaveCount(0);
});

test('a viewer can star a recipe', async ({ browser }) => {
  const viewer = await session(browser, SEED.viewerA);
  await viewer.getByText('Seed pancakes', { exact: true }).click({ timeout: 30_000 });
  // Independent of earlier runs: un-star first if a previous run left it starred.
  const unstar = viewer.getByRole('button', { name: 'Unstar' });
  if (await unstar.isVisible()) await unstar.click();
  await viewer.getByRole('button', { name: 'Star' }).click();
  await expect(unstar).toBeVisible();
  await viewer.getByRole('link', { name: 'All recipes' }).click();
  await viewer.getByRole('tab', { name: 'Favorites' }).click();
  await expect(viewer.getByText('Seed pancakes', { exact: true })).toBeVisible();
});
```

`e2e/trash.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import { env } from '../test-support/env';
import { createRecipe, SEED, session, unique } from './helpers';

test('Move to Trash, then Restore, on two sessions', async ({ browser }) => {
  const member = await session(browser, SEED.memberA);
  const admin = await session(browser, SEED.adminA);
  const title = unique('Trashed tart');
  await createRecipe(member, { title });

  member.once('dialog', (dialog) => void dialog.accept());
  await member.getByRole('button', { name: 'Move to Trash' }).click();
  await expect(member.getByRole('heading', { name: 'Recipes', level: 1 })).toBeVisible();
  await expect(member.getByText(title, { exact: true })).toHaveCount(0);

  await admin.getByRole('link', { name: 'Trash' }).click();
  await expect(admin.getByText(title, { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(admin.getByText('Deletes in 30 days')).toBeVisible();
  await admin.getByRole('button', { name: `Restore ${title}` }).click();
  await expect(admin.getByText(title, { exact: true })).toHaveCount(0);

  await expect(member.getByText(title, { exact: true })).toBeVisible({ timeout: 10_000 });
});

test('trash older than 30 days is deleted for good when a member comes online', async ({
  browser,
}) => {
  const sql = postgres(env.adminDbUrl, { max: 1, onnotice: () => {} });
  try {
    const member = await session(browser, SEED.memberA);
    const title = unique('Ancient soup');
    await createRecipe(member, { title });
    await expect
      .poll(async () => (await sql`select 1 from recipes where title = ${title}`).length, { timeout: 15_000 })
      .toBe(1);
    await sql`update recipes set deleted_at = now() - interval '31 days' where title = ${title}`;

    // A fresh device has never purged, so connecting triggers the purge.
    await session(browser, SEED.memberA);
    await expect
      .poll(async () => (await sql`select 1 from recipes where title = ${title}`).length, { timeout: 30_000 })
      .toBe(0);
    await member.getByRole('link', { name: 'All recipes' }).click();
    await member.getByRole('link', { name: 'Trash' }).click();
    await expect(member.getByText(title, { exact: true })).toHaveCount(0);
  } finally {
    await sql.end();
  }
});

test('a viewer opening /trash is sent to the list', async ({ browser }) => {
  const viewer = await session(browser, SEED.viewerA);
  await viewer.goto('/trash');
  await expect(viewer.getByRole('heading', { name: 'Recipes', level: 1 })).toBeVisible();
});
```

The first poll waits until the recipe has reached the server before it is backdated.

- [ ] **Step 2: Run them and confirm they fail**

Run: `rtk pnpm test:e2e e2e/favorites.spec.ts e2e/trash.spec.ts`
Expected: FAIL: the Trash link leads to a missing route (`/trash` shows the app's "not found"), so the trash tests fail; the favorites test may already pass through Task 5's star and tabs. A favorites test that passes before this task's code is a finding about the test: confirm it fails if the `LIST_FAVORITES_SQL` join is broken (temporarily change `f.user_id = ?` to `f.user_id <> ?`, run, see it fail, revert).

- [ ] **Step 3: The Trash screen and route**

`apps/mobile/src/screens/TrashScreen.tsx`:

```tsx
import { usePowerSync } from '@powersync/react';
import { Link, Redirect } from 'expo-router';
import { FlatList, Pressable, Text, View } from 'react-native';
import { useTrash } from '../recipes/hooks';
import { restoreRecipe } from '../recipes/repository';
import { trashDaysLeft } from '../recipes/rows';
import { canWrite, type Claims } from '../session/claims';

function deletesIn(days: number): string {
  if (days <= 0) return 'Deletes soon';
  return days === 1 ? 'Deletes in 1 day' : `Deletes in ${days} days`;
}

export function TrashScreen({ claims }: { claims: Claims }) {
  const db = usePowerSync();
  const items = useTrash();
  if (!canWrite(claims.role)) return <Redirect href="/" />;
  const now = Date.now();

  return (
    <View style={{ padding: 16, gap: 12, maxWidth: 640, flex: 1 }}>
      <Link href="/" style={{ textDecorationLine: 'underline' }}>
        All recipes
      </Link>
      <Text role="heading" aria-level={1} style={{ fontSize: 24, fontWeight: '600' }}>
        Trash
      </Text>
      <Text>Recipes here are deleted for good 30 days after they were moved to the Trash.</Text>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 18 }}>{item.title}</Text>
              <Text style={{ color: '#666' }}>{deletesIn(trashDaysLeft(item.deleted_at, now))}</Text>
            </View>
            <Pressable
              role="button"
              aria-label={`Restore ${item.title}`}
              onPress={() => void restoreRecipe(db, claims, item.id)}
            >
              <Text style={{ textDecorationLine: 'underline' }}>Restore</Text>
            </Pressable>
          </View>
        )}
        ListEmptyComponent={<Text>The Trash is empty</Text>}
      />
    </View>
  );
}
```

`apps/mobile/app/trash.tsx`:

```tsx
import { TrashScreen } from '../src/screens/TrashScreen';
import { SignedIn } from '../src/session/SignedIn';

export default function Trash() {
  return <SignedIn>{(claims) => <TrashScreen claims={claims} />}</SignedIn>;
}
```

- [ ] **Step 4: Run them and confirm they pass**

Run: `rtk pnpm test:e2e e2e/favorites.spec.ts e2e/trash.spec.ts`
Expected: all passed. If the purge test times out, check that the fresh session is an admin or member (memberA is), that `purgeTrashIfDue` ran (`rtk docker compose logs api --tail 20` shows a `POST /api/trash/purge`), and that `localStorage` in a new Playwright context has no `recipes.lastPurge`.

- [ ] **Step 5: Run everything and commit**

Run: `rtk pnpm lint && rtk pnpm typecheck && rtk pnpm test && rtk pnpm test:e2e`
Expected: all exit 0.

Message: `feat(app): favorites filter and a 30-day Trash with restore (FR-17, FR-18)`.

---

### Task 7: Documentation, clean verification, pull request

**Files:**
- Create: `docs/adr/0010-recipe-content-as-json.md`
- Modify: `docs/adr/README.md`, `docs/SPEC.md`, `CLAUDE.md`, `ARCHITECTURE.md`

- [ ] **Step 1: Write ADR-0010**

`docs/adr/0010-recipe-content-as-json.md`:

```markdown
# 0010. Recipe content as JSON on the recipe row

- **Status:** Accepted
- **Date:** 2026-10-17
- **Builds on:** ADR-0004 (last-write-wins sync), ADR-0006 (tenancy with RLS)

## Context
A recipe has ingredients (quantity, unit, item, prep note), steps, tags, servings, times and shared notes (FR-10, FR-15, FR-16). Devices edit offline and sync with last-write-wins (FR-30). Ingredients must stay addressable for the Phase 2 shopping list.

## Decision
Store ingredients and steps as `jsonb` arrays and tags as `text[]` on the `recipes` row. Each ingredient and step carries a stable `id` inside the JSON; editing keeps the id of an unchanged line. The API validates every element against the zod schemas in `packages/domain`; the database checks types and counts. Ingredients are typed one line each and parsed by `parseIngredientLine`; the typed text (`raw`) is always kept and is what screens show.

Favorites are per user, so they are a separate tenant table (`favorites`) with RLS on the user and household and their own sync stream.

## Alternatives considered
- **Separate `recipe_ingredients` and `recipe_steps` tables:** relational queries and per-line merges, but per-line last-write-wins can interleave or duplicate lines after concurrent offline edits, and two more tenant tables widen the RLS, sync and upload surface.
- **Tags as `tags` and `recipe_tags` tables:** supports renaming a tag everywhere; not needed yet.

## Consequences
- A save is one row: two offline edits of the same recipe never mix; the later save wins as a whole, and an edit of a different part by someone else at the same time is lost.
- Server-side ingredient queries read `jsonb`. When the shopping list or server search needs rows, a trigger can maintain a read-only index table from the JSON without changing clients.
- Element shapes live in one place (`packages/domain`), shared by the API, the app, and later AI parsing (CLAUDE.md rule 7).
```

In `docs/adr/README.md`, add after the 0009 row:

```markdown
| [0010](0010-recipe-content-as-json.md) | Recipe content as JSON on the recipe row | Accepted |
```

- [ ] **Step 2: Update SPEC, CLAUDE.md and ARCHITECTURE**

`docs/SPEC.md`:
- FR-15 row: `| FR-15 | Edit all fields; personal notes (shared with the household). Own photo arrives with import (sub-project 4) | M |`
- FR-16 row: `| FR-16 | Tags: free-form, with suggestions from the household's tags; AI suggestions arrive with import | M |`
- FR-17 row: `| FR-17 | Favorites (per user) | S |`
- FR-18 row: `| FR-18 | 30-day trash before permanent delete | S |`

`CLAUDE.md` rule 4 becomes:

```markdown
4. **Viewers can't change household data.** Enforce in RLS *and* hide controls in the UI. Their own favorites are the exception.
```

and rule 5 gains, at the end: `The only hard delete is the 30-day trash purge (recipes_purge policy, POST /api/trash/purge).`

`ARCHITECTURE.md` §6: under the conventions list, replace the ingredients bullet with:

```markdown
- Ingredients and steps are JSON arrays on the recipe row (ADR-0010), each element with a stable id; ingredients keep the typed line (`raw`) plus parsed `quantity`, `quantity_max`, `unit`, `item`, `note`, so scaling, search, and the Phase 2 shopping list can use them
- Favorites are a per-user table (`favorites`), synced only to that user
```

and in the ER diagram, remove the `INGREDIENT`, `STEP`, `RECIPE_TAG` and `TAG` entities' relationship lines (`RECIPE ||--o{ INGREDIENT`, `RECIPE ||--o{ STEP`, `RECIPE ||--o{ RECIPE_TAG`, `TAG ||--o{ RECIPE_TAG`, `HOUSEHOLD ||--o{ TAG`). Keep `USER ||--o{ FAVORITE : marks` and add `RECIPE ||--o{ FAVORITE : "starred as"`. Bump the status line's date.

- [ ] **Step 3: Verify from a clean state (tell the owner first)**

`pnpm db:reset` deletes the development database, including the owner's own account and recipes. Ask the owner before running it, and skip it if they decline (run the suites on the current database instead, after `pnpm dev:backend`).

```bash
rtk pnpm dev:backend:stop
rtk proxy docker compose --profile dev down -v
rtk pnpm install --frozen-lockfile
rtk pnpm db:reset
rtk pnpm lint && rtk pnpm typecheck && rtk pnpm test && rtk pnpm test:stack && rtk pnpm test:rls && rtk pnpm test:api && rtk pnpm test:e2e
```

Expected: every command exits 0.

- [ ] **Step 4: Commit the docs**

Message: `docs: ADR-0010 recipe content as JSON; SPEC, CLAUDE.md and ARCHITECTURE for recipes, favorites, and trash (FR-15, FR-16, FR-17, FR-18)`.

- [ ] **Step 5: Push and open the pull request (confirm with the owner first)**

Base the pull request on `main` if #1 and #2 have merged; otherwise on `feat/phone-preview`, and say so in the description. After the first CI run, report each job's result. Then ask the owner to try it on the phone: type a family recipe, star it, move one to the Trash and restore it.

---

## Spec coverage

| Spec section | Task |
|---|---|
| §1 success 1 (type a full recipe on the phone, offline too) | 1, 4, 5 |
| §1 success 2 (readable recipe, edit, sync, viewers read-only) | 5 |
| §1 success 3 (favorites) | 2, 3, 4, 6 |
| §1 success 4 (Trash, restore, 30-day purge) | 2, 3, 4, 6 |
| §1 success 5 (tenant tables, RLS, tests, sync) | 2 |
| §2 decisions | 1–6; ADR-0010 in 7 |
| §3 migration, policies, sync config, local schema | 2, 4 |
| §4 parser, text lists, tags, schemas | 1 |
| §5 routes, editing, repository, roles in UI, purge call | 4, 5, 6 |
| §6 API upload and purge | 3 |
| §7 unit tests | 1, 4 |
| §7 RLS suite | 2 |
| §7 API tests | 3 |
| §7 e2e 1–4, 8–10 | 5 |
| §7 e2e 5–7 | 6 |
| §8 documentation | 7 |
| §9 acceptance | 7 |
