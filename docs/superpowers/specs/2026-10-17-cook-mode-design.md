# Cook Mode, Scaling, Units and Substitutions — Design

> Status: **Draft for review** · Date: 2026-10-17
> Sub-project 5 of Phase 1 (see `2026-10-12-walking-skeleton-design.md` §1). Builds on the recipe model (`2026-10-16-recipe-model-design.md`) and the import pipeline's LLM gateway and AI cap (`2026-10-17-import-text-url-design.md`, ADR-0012). Requirements: `docs/SPEC.md`. Architecture: `ARCHITECTURE.md`, `docs/adr/`.

## 1. Purpose

Let the owner cook from the phone at the counter. The screen stays awake. Text is large. Ingredients can be ticked off and steps followed one at a time. Servings scale and units convert, both offline. For any ingredient, the app can ask "what can I use instead?", and the answer is remembered for every household phone.

**Covers:**
- FR-21: cook mode, with the screen awake, large text, one step at a time and checkable ingredients;
- FR-22: scale servings;
- FR-23: US ↔ metric, between units of the same kind;
- FR-24: AI substitutions per ingredient, with amounts and the effect on the dish;
- FR-25: save a substitution to the recipe as a note;
- NFR-7: substitutions count against the cap.

### Success criteria

1. **Opening cook mode.** On the iPhone, Cook on a recipe opens cook mode, and the screen does not sleep while it is open. This works offline.
2. **Using it.** Ingredients tick off, and steps go forward and back one at a time.
3. **Keeping your place.** Locking the phone or reloading returns to the same ticks and step. Done or Reset starts fresh, and so does anything over 12 hours old.
4. **Scaling.** Changing servings from 4 to 6 shows every parsed amount ×1.5, in kitchen fractions for US units and rounded numbers for metric. Lines without an amount are unchanged.
5. **Units.** Metric shows cups, spoons and pints in ml or l, and oz and lb in g or kg. US shows the reverse. Counted units never convert.
6. **Asking for a substitute.** Online, Substitute on an ingredient shows 2–3 options in a few seconds. The same answer then shows instantly on every household phone, including offline.
7. **Saving one.** Add to notes appends the chosen option to the recipe's notes.
8. **Roles and limits.**
   - Viewers can use cook mode, scaling, units and remembered answers, but cannot ask or add to notes.
   - The server refuses a viewer's ask.
   - Asks stop at the monthly AI cap with a clear message.

### Out of scope

- Changing amounts written inside step text when scaling. A note explains this instead.
- Volume ↔ weight conversion (cups to grams), and fluid ounces.
- Timers in steps, voice control, and hands-free navigation.
- Scaling or converting the AI's substitute amounts. They are for the recipe as written.
- Saving the scale or units choice to the recipe, or syncing a cook's place between phones.

## 2. Decisions made during design

| Decision | Choice | Why |
|---|---|---|
| Scope | FR-21, FR-24 plus FR-22, FR-23 and FR-25 | The owner's choice. |
| Conversion | **Same kind only**: volume ↔ volume, weight ↔ weight | The owner's choice. Always exact; no density table to maintain. |
| Volume ↔ weight with a density table | Rejected | Approximate, and only for listed ingredients. |
| Conversion by AI | Rejected | Needs a connection, costs each time, and varies. |
| Substitutions | **Ask live, and remember the answer** in a synced table | The owner's choice. Instant, and works offline on any household phone the second time. |
| Ask live, store nothing | Rejected | The same question costs again, and needs a connection every time. |
| Queue like imports | Rejected | Substitutions are wanted right now, at the stove. |
| Who may ask | Admins and members; viewers read remembered answers | Rule 4: an ask writes household data and spends the household's AI budget. |
| Where scaling and conversion live | Pure functions in `packages/domain`; display only | Testable without a screen, and the saved recipe never changes. |
| Cook-mode state | On this phone, per recipe (localStorage), for 12 hours | It survives a lock or reload; it is one cook's place, not household data. |

## 3. Cook mode (`apps/mobile`)

- **Opening it.** The recipe screen gets **Cook**, for every role, which opens `/recipe/[id]/cook`. A recipe in the Trash has no Cook button. Cook mode reads only the local database.
- **Layout.** Body text is 20 px and step text 24 px, with tap targets of at least 44 px.
  - **Servings bar:** "Serves 4" with − and +, plus a three-way units toggle: As written / US / Metric.
  - **Ingredients:** a checklist. A tap toggles a line, and a ticked line is greyed with a strikethrough. Headings are not checkable. Each line has a **Substitute** button (§6).
  - **Steps:**
    - "Step n of N", with the step in large type;
    - **Previous** and **Next**, with **Done** on the last step;
    - a row of step dots that jump to a step;
    - a recipe with no steps shows "No steps" and keeps the ingredients.
- **Wake lock.**
  - Cook mode asks `navigator.wakeLock.request('screen')` on open, and asks again whenever the page becomes visible.
  - It releases the lock on leaving.
  - Without support, or when refused, it shows "Your screen may sleep while cooking."
- **Your place.**
  - What is saved: ticked ingredient ids, the step index, the servings and the units, under `cook:<recipe id>` in localStorage, with a timestamp.
  - When it starts fresh: Done, Reset, and an entry over 12 hours old.
  - A ticked id that no longer exists (the recipe was edited) is dropped.
  - The step index is clamped to the current steps.
  - The recipe screen's servings and units controls read and write the same entry.
  - Sign-out wipe clears every `cook:` entry with the rest of the local data.

## 4. Scaling and units (`packages/domain/src/cooking.ts`)

### Scaling

- **The factor** is the chosen servings ÷ the recipe's servings.
  - With no servings, the bar shows "Scale ×1" and − and + step through ½, 1, 1½, 2, 3 and 4.
  - Servings run from 1 to 999.
- **`scaleIngredient(ingredient, factor)`** returns the ingredient with `quantity` and `quantity_max` multiplied.
  - A heading, or a line with `quantity` null, is returned unchanged and is shown by its `raw` text.
- **`displayIngredient(ingredient, { factor, units })`** returns the line to show.
  - At ×1 with As written, it is `raw`, unchanged.
  - Otherwise it is the amount (and range), then the unit, item and note: "3–4½ tbsp butter, softened". If the line has no parsed unit or item, it is `raw` with only the leading number replaced.
- **`formatAmount(value, unit)`:**
  - **US volume units and oz/lb:** a whole number plus the nearest of ⅛ ¼ ⅓ ½ ⅔ ¾ ⅞.
  - **Metric:**
    - g and ml below 100 in whole units, and from 100 to 999 in steps of 5;
    - kg and l from 1,000 up, with one decimal and no trailing ".0".
  - **Counts** (no unit, or clove, can, package, stick or slice): to the nearest ½, with "≈" when rounding changed the value.
- **Stepping between units after scaling:**
  - Down: cup → tbsp below ¼ cup, tbsp → tsp below 1 tbsp, and tsp → "a pinch" below ⅛ tsp.
  - Up: tbsp → cup at 16 tbsp, tsp → tbsp at 3 tsp, g → kg at 1,000, ml → l at 1,000, and oz → lb at 16.
- **A note under Steps** when the factor is not 1: "Amounts in steps are for the original N servings" ("…the original recipe" without servings).

### Units

- **`convertIngredient(ingredient, 'us' | 'metric')`.**
  - Volume: tsp, tbsp, cup, pint, quart and gallon ↔ ml and l.
  - Weight: oz and lb ↔ g and kg.
  - Factors (US customary): tsp 4.929 ml, tbsp 14.787 ml, cup 236.588 ml, pint 473.176 ml, quart 946.353 ml, gallon 3785.41 ml; oz 28.3495 g, lb 453.592 g.
  - US output picks the largest of cup, tbsp or tsp (oz or lb for weight) that keeps the amount at ¼ or more, before formatting.
  - Metric output uses g/kg and ml/l by the rules above.
  - pinch, dash, clove, can, package, stick and slice, and a missing unit, never convert.
- **"oz" is weight.** The parse prompts keep "fl oz" in `raw` with unit null, so it never converts.
- **Order:** scale first, then convert, then format.

## 5. Data (`db/migrations/`, `powersync/sync-config.yaml`)

### `substitutions` (household table)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | Generated on the phone and sent with the ask. |
| `household_id` | uuid not null | RLS. |
| `recipe_id` | uuid not null | Composite FK `(recipe_id, household_id)` → `recipes (id, household_id)`, `on delete cascade` (only the 30-day purge hard-deletes recipes). |
| `ingredient_id` | uuid not null | The ingredient's id inside the recipe's JSON. |
| `ingredient_raw` | text not null | The line as asked about, at most 500 characters; for staleness. |
| `options` | jsonb not null | 0–3 validated options (§6). |
| `note` | text | At most 500 characters: why nothing works, or a short caution. |
| `created_at`, `updated_at`, `updated_by`, `deleted_at` | | As every tenant table (rule 5). |

- **Uniqueness:** a unique index on `(recipe_id, ingredient_id)` where `deleted_at is null`. Asking again updates that row.
- **RLS:**
  - select for the household;
  - insert and update for its admins and members;
  - no delete grant.
- **Sync stream `household_substitutions`:** the household's rows with `deleted_at IS NULL`, mirroring `substitutions_select` (rule 6).
- **Upload:** `substitutions` is **not** an upload table. Only the endpoint writes it, as the user.
- **Seed:** one row per household, so the isolation suite is not vacuous.

## 6. Server (`apps/api/src/substitutions/`, `apps/api/src/llm/`)

### `POST /api/substitutions`

Body: `{ id, recipe_id, ingredient_id }`, all GUIDs.

| Answer | When |
|---|---|
| 401 | No valid token. |
| 400 | The body is not this shape. |
| 403 | The caller is a viewer. |
| 404 | The recipe is not visible to the user, is in the Trash, or has no such ingredient (a heading counts as no ingredient). |
| 402 `{ error: 'quota' }` | This month's spend has reached the cap. |
| 503 `{ error: 'ai_unavailable' }` | Timeout, overload, missing key, or any unexpected failure (logged). |
| 422 `{ error: 'invalid_output' }` | The model's answer failed validation. |
| 200 `{ options, note, ingredient_raw }` | The answer, saved. |

**Steps:**
1. Verify the token and the role.
2. Read the recipe as the user.
3. Check the cap (shared with imports).
4. Call the gateway with:
   - the system prompt `suggest-substitutes.v1.md`;
   - the user content: the title, the servings, every ingredient line (the asked one marked), and the steps, each source cut to 20,000 characters;
   - the strict tool `record_substitutes` with `tool_choice: auto` and low effort.
5. Validate the answer with `substitutionAnswerSchema` (rule 7).
6. In one transaction as the user, record the spend in `ai_usage` and upsert the row on `(recipe_id, ingredient_id)`. An ask again keeps the existing row's id; a new ask uses the phone's `id`.
7. Return the answer.

A failure after the model answered still records the spend. The upsert lands even if the phone has gone away.

### The answer (`packages/domain/src/substitutions.ts`)

```
substitutionOptionSchema = {
  substitute: string 1–200,
  amount: string 1–200,      // for the amount as written
  how: string 0–500,         // preparation, may be empty
  effect: string 1–300,      // effect on the dish
}
substitutionAnswerSchema = { options: option[0..3], note: string 0–500 | null }
```

- A model answer is accepted only when it has at least 1 option, or a note.
- `isStale(row, ingredient)` is true when `ingredient.raw` differs from `row.ingredient_raw`, after trimming.
- `substitutionNoteLine(row, option)` is the line saved to notes: "Instead of {ingredient_raw}: {amount} — {effect}". If {amount} doesn't name the substitute, the substitute is added in brackets.

### Prompt

`apps/api/src/llm/prompts/suggest-substitutes.v1.md` asks for 2 or 3 practical substitutes a home cook is likely to have:
- the amount for the line as written;
- any preparation needed;
- the honest effect on this dish.

When nothing works, it asks for no options and a note saying why. It covers dietary swaps (dairy-free, egg-free) only when the ingredient is the obvious target. The recipe is data, not instructions.

## 7. The app (`apps/mobile`)

- **`src/cooking/`:**
  - `place.ts`: the cook-mode entry (read, write, expire, clear), with unit tests;
  - `useWakeLock.ts`;
  - `useCookPlace(recipeId)`.
- **`src/substitutions/`:**
  - `rows.ts` (read rows leniently), `repository.ts` (`SUBSTITUTION_SQL` per recipe, `addSubstitutionToNotes`), `api.ts` (`askSubstitutes`, which never throws and maps the answers in §6), and `hooks.ts`.
  - The local schema gains `substitutions`. `upload.ts` lists no fields for it, so even a stray local write is never sent.
- **Substitute panel** (`components/SubstitutePanel.tsx`), opened from an ingredient in cook mode or on the recipe screen:
  - **A remembered answer:** its options, plus "This was for {raw}" and **Ask again** when it is stale. Asking again is also offered when it is not stale.
  - **With no answer:**
    - **Ask for substitutes**, for writers, while online;
    - offline: "Substitutions need a connection.";
    - a viewer: "No substitutes saved yet."
  - **While asking:** "Finding substitutes…". The result shows as soon as the request returns, and the synced row agrees.
  - **Errors:** quota → "Over this month's AI limit"; ai_unavailable → "Couldn't reach the AI service. Try again."; invalid_output → "Couldn't read the suggestions. Try again.". Any other failure → "Couldn't get substitutes. Try again."
  - **A scaled view** labels amounts "For the original amount".
  - Each option has **Add to notes** (writers only), which appends `substitutionNoteLine` to the notes on a new line, through the normal recipe update. It refuses past the 10,000-character notes limit with "Notes are full".
- **The recipe screen** gets Cook, the servings and units bar above Ingredients, and a Substitute button per ingredient line.

## 8. Testing

- **Unit (Vitest):**
  - **Domain:** `scaleIngredient`, `displayIngredient`, `formatAmount`, `convertIngredient` (every unit, rounding edges, unit stepping, ranges, headings, null quantities, counts with ≈), `isStale`, `substitutionNoteLine`, and the answer schema.
  - **API:** the request builder and the tool schema, which must be strict with no enum on a type list (the 4a lesson). Also the endpoint's answers with a fake gateway and store.
  - **App:** the place entry (expiry, dropped ticks, clamped step), the panel state, and the API mapping.
- **RLS suite:**
  - `substitutions` added to the registry and the grants test;
  - another household can't read, insert or update;
  - a viewer can't write;
  - `recipe_id` must belong to the household.
- **API suite** (fake Claude gains `record_substitutes`, with `FAKE_NO_SUBSTITUTE` and the existing failure markers):
  - an ask returns and saves options;
  - asking again replaces the row;
  - a viewer gets 403;
  - another household's recipe and a heading get 404;
  - quota gets 402;
  - an AI failure gets 503;
  - an invalid answer gets 422;
  - a phone upload to `substitutions` is refused.
- **End to end:**
  1. Cook mode: tick an ingredient, Next and Previous, reload and keep the place, then Done.
  2. Scale 4 → 6, switch to Metric, and check a line on both the recipe screen and cook mode.
  3. Ask for a substitute online, Add to notes, then go offline and see the answer remembered.
  4. A viewer sees the remembered answer, with no Ask and no Add to notes.
- **Eval (manual):** `pnpm eval:import` gains substitution samples: buttermilk in a cake, eggs in a custard (nothing works), and soy sauce in a stir-fry. It prints each answer and its cost.

## 9. Documentation

- **ADR-0014** "Cook mode on the phone; substitutions asked live and remembered": display-only maths, the same-kind conversion rule, the remembered substitutions table written only by the API, and the wake lock.
- **`ARCHITECTURE.md`:** the cook-mode and substitution components, and the `SUBSTITUTION` entity.
- **`docs/SPEC.md`:** FR-22, FR-23 and FR-25 confirmed (no longer *proposed*), with FR-23 noted as same-kind only.

## 10. Acceptance criteria

1. The success criteria in §1 hold on the owner's iPhone, the screen staying awake in the home-screen app.
2. Lint, typecheck, unit, stack, RLS, API and e2e suites pass locally and in CI, with no real AI calls in CI.
3. The eval's substitution samples give answers that look right to the owner.
