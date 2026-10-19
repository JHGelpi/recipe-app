# Shopping list (Phase 2): design

Date: 2026-10-18 · Status: approved in conversation, awaiting written review

## 1. Goal

Phase 2 of SPEC §3: add a recipe's ingredients to a shopping list, merge duplicates, and group the list by aisle.

Success means:
- the owner plans a few meals and taps **Add to list** on each, unticking what they already have;
- in the store they shop from one tidy list on the phone, with or without signal;
- everyone in the household sees the same list, and changes sync like recipes;
- Viewers see the list but cannot change it (CLAUDE.md rule 4).

### Decisions made with the owner
- **One shared list** per household.
- **Adding from a recipe:** pick which ingredients. All start ticked at the servings being viewed; the cook unticks what they have.
- **Merging:** one line per item, with amounts added when their units can be added. Other amounts sit side by side on the line. The line shows which recipes it is for.
- **Aisles:** a built-in word list guesses the aisle offline. A household's own fixes are remembered and beat the guess.

### Out of scope
- Several lists, or per-store tags.
- Remembering pantry staples.
- A custom aisle order for a store.
- Sharing the list outside the household.
- Meal planning (Phase 3).

## 2. Requirements (added to SPEC §5 as "Shopping list (Phase 2)")

| ID | Requirement | Priority |
|---|---|---|
| FR-31 | One shopping list per household, shared and synced; works offline | M |
| FR-32 | Add a recipe's ingredients at the viewed servings, choosing which ones | M |
| FR-33 | Same items merge into one line, adding amounts where units allow; the line shows its recipes | M |
| FR-34 | Items are grouped by aisle: a built-in guess, overridden by the household's own choices | M |
| FR-35 | Tick items off while shopping, clear ticked items, remove items, add typed items | M |

## 3. What the cook sees

### Navigation
- A fifth tab, **List**, between **+** and Household, with an icon and an accessible name of "Shopping list".
- When items are left to buy, the name reads "Shopping list, N to buy" and a small count badge shows N, where N counts unticked lines.
- The tab bar is hidden in the same places as today.

### Adding from a recipe
- An **Add to list** button sits in the recipe page's action row, next to Cook. It is hidden for Viewers and for recipes in the Trash.
- It opens a sheet. Its title is "Add to shopping list", and its servings follow the servings bar.
- The sheet lists every ingredient line with a checkbox, all ticked, showing the scaled amount the way the recipe page does. Heading lines ("For the sauce") are left out.
- An ingredient with no parsed item (unparsed text) is listed with its raw text, and is added with that text as its item.
- **Add N items** adds the ticked lines. **Cancel**, Escape or tapping outside closes the sheet. The button is disabled when nothing is ticked.
- After adding, the sheet closes and a banner says "Added N items to your list".

### The list screen (`/list`)
- **Heading:** `h1` "Shopping list", then the status line.
- **Typed items:** a field labelled "Add an item" at the top. Its text goes through the same ingredient reader as recipes ("2 lemons" becomes quantity 2, item "lemons"). It is added on Enter or with the **Add** button. Hidden for Viewers.
- **Lines:**
  - grouped by aisle, under `h2` aisle headings, in a fixed order: **Produce, Meat & Seafood, Dairy & Eggs, Bakery, Pantry, Spices, Frozen, Drinks, Household, Other**;
  - empty aisles are not shown;
  - within an aisle, lines are in alphabetical order by item.
- **A line shows:**
  - a round tick button, whose accessible name is "Got <item>" or, when ticked, "Need <item>";
  - the item name;
  - the merged amount, in muted text, such as "3", "2 ¾ cups" or "1 can + 200 g";
  - a **More** icon button named "More for <item>".
- **More opens a small sheet with:**
  - "For": the recipes the line came from, plus "Added by hand" for typed items;
  - **Move to aisle**, which lists the aisles;
  - **Remove** for the whole line;
  - for each recipe, **Remove items from <recipe title>**.
  - Viewers see only "For".
- **Ticking:** a ticked line moves to a **Got it** section at the bottom, struck through. Unticking moves it back.
- **Clearing:**
  - **Clear ticked** appears when anything is ticked. It removes the ticked lines' rows, with no confirmation, since they are bought.
  - **Clear list** asks "Clear the whole shopping list?" first.
- **Empty list:** shows "Your list is empty. Add ingredients from a recipe, or type an item above."
- **Viewers:** see the lines and the "For" view only. No ticks, no field, no clear buttons.

## 4. Data

### `shopping_items` (tenant table, synced)
| Column | Notes |
|---|---|
| `id` uuid | client-generated |
| `household_id` | NOT NULL; RLS |
| `item` text | as written ("onions", "Lemons"), 1–200 chars |
| `item_key` text | `itemKey(item)`, used for merging and aisle choices |
| `quantity`, `quantity_max` numeric, null | already scaled to the chosen servings |
| `unit` text, null | a `Unit` from `packages/domain`, or null |
| `note` text, null | prep note from the recipe line ("diced") |
| `aisle` text | one of the 10 aisle ids, set when added |
| `recipe_id` uuid, null | null for typed items; no foreign key, so removing or purging a recipe never breaks the list |
| `recipe_title` text, null | copied when added, so the line still names its recipe after a rename or the Trash |
| `checked_at` timestamptz, null | set when ticked |
| `created_at`, `updated_at`, `updated_by`, `deleted_at` | standard (rule 5) |

### `aisle_choices` (tenant table, synced)
| Column | Notes |
|---|---|
| `id` uuid | **derived:** a UUID v5 of `household_id` + `item_key`, so two phones choosing offline write the same row |
| `household_id` | NOT NULL; RLS |
| `item_key` text | unique per household |
| `aisle` text | one of the 10 aisle ids |
| standard columns | as above |

### Rules
- **RLS** on both tables in one migration:
  - select for anyone in the household;
  - insert and update for Admins and Members;
  - no delete grant; removal is soft (`deleted_at`).
- **Aisle values** are checked against the 10 ids in the database and in a zod schema in `packages/domain`.
- **Sync config:** both tables are added to the household bucket, mirroring RLS (rule 6).
- **Registry:** both tables are added to `apps/api/tests/rls/registry.ts` and the seed (one row per household each).
- **Upload:** the existing upload path (`/api/upload`, `applyOps`) gains both tables, validated with their zod schemas. No new routes.
- **Purge:** `POST /api/trash/purge` also hard-deletes `shopping_items` whose `deleted_at` is over 30 days old. Rule 5's only hard delete stays the 30-day purge.

## 5. Domain logic (`packages/domain/src/shopping.ts`, pure, with tests)

- **`itemKey(item: string): string`:**
  - lowercase, trimmed, inner spaces collapsed;
  - singular for simple English plurals: `-ies` becomes `-y` (berries → berry); `-oes` becomes `-o` (tomatoes → tomato); a trailing `-s` is dropped unless the word ends in `-ss`, `-us` or `-is` (onions → onion, but not glass or hummus);
  - a small list of exceptions stays as it is (`asparagus`, `couscous`, `molasses`, `swiss`).
- **`aisleFor(key: string, choices: Map<string, Aisle>): Aisle`:**
  - a household choice wins;
  - otherwise the built-in word list (about 300 words), matched on the whole key and then on its last word ("red onion" → "onion" → Produce);
  - otherwise `other`.
- **`AISLES`:** ordered ids and labels:
  - `produce` Produce, `meat` Meat & Seafood, `dairy` Dairy & Eggs, `bakery` Bakery;
  - `pantry` Pantry, `spices` Spices, `frozen` Frozen, `drinks` Drinks;
  - `household` Household, `other` Other.
- **`shoppingLines(items): Line[]`:**
  - rows are grouped by `item_key`;
  - a line's `item` is its earliest row's `item`, and its `aisle` is its most recently updated row's aisle;
  - `sources` lists the distinct `recipe_title`s, plus a hand-added marker;
  - `checked` is true only when every row is ticked;
  - `rowIds` lists the line's rows.
- **Amounts inside a line:**
  - **Volumes** add in millilitres and show in the unit of the first volume row, converted with the existing converter. US stays US and metric stays metric.
  - **Weights** add the same way, in grams.
  - **Plain counts** (no unit) add.
  - **Every other unit** (can, clove, pinch, slice…) adds only with the same unit.
  - **Ranges** add both ends.
  - **Rows with no quantity** add "to taste" once, when the line has other amounts. Otherwise the line shows no amount.
  - The parts are joined with " + " in this order: counts, volume, weight, others, to taste.
- **`addRows(recipe, servingsFactor, chosenIds, choices)`** builds the rows for the add sheet. It uses `scaleIngredient` from `cooking.ts`, skips heading lines, and works out each row's aisle.

## 6. Behaviour details

- **Ticking a line** sets `checked_at` on every row in it. Unticking clears them all. A line with mixed rows (one phone added more onions after the others were ticked) shows as unticked, in its aisle.
- **Move to aisle** writes `aisle_choices` and updates the `aisle` of every row of that `item_key` on the list. Rows added later take the choice.
- **Remove** soft-deletes a line's rows. **Remove items from <recipe>** soft-deletes that recipe's rows on the list.
- **Clear ticked** soft-deletes rows of ticked lines. **Clear list** soft-deletes every row.
- **Offline:** every action is a local write, and the upload queue sends it later. The status line shows unsynced changes as for recipes.
- **Conflicts:** rows are last-save-wins, as everywhere. Two phones adding the same item make two rows that merge on screen, so nothing is lost.
- **Limits:** at most 500 live rows per household, checked in the add sheet and in the upload validation. Past that, the sheet says "Your list is full. Clear ticked items first."

## 7. Testing

- **Unit (`packages/domain`):**
  - `itemKey`: plurals, exceptions, case and spaces;
  - `aisleFor`: whole-word and last-word matches, a choice wins, unknown words go to `other`;
  - `shoppingLines`: counts, US volumes, metric volumes, weights, mixed kinds, ranges, no-amount items, mixed ticks, sources, aisle from the latest row;
  - `addRows`: scaling, skipped headings, unparsed lines.
- **Unit (`apps/mobile`):** the List tab's name and badge for a count; the add sheet's button label and disabled state.
- **RLS suite:** both tables are isolated by household and Viewers can't insert or update them. The registry, the coverage guard and the "authenticated grants" test are updated.
- **API:** upload accepts valid rows for both tables and rejects a bad aisle and a 201-character item. The purge removes old deleted list rows only.
- **End to end:**
  - add a recipe with two ingredients unticked; only the others appear, under their aisles;
  - a second recipe's onions merge into the same line, and "For" lists both recipes;
  - tick off a line, which moves to Got it; **Clear ticked** removes it;
  - a typed "2 lemons" lands in Produce; **Move to aisle** for it is remembered when lemons are added again;
  - a change made offline syncs when back online, and another member's session sees it;
  - a Viewer sees the list with no controls;
  - the tab's name counts the items to buy.

## 8. Docs

- **ADR-0019:**
  - one shared list;
  - added rows merged at display time, rather than merged rows (offline-safe, keeps sources);
  - the aisle word list plus household choices with derived ids.
- **ARCHITECTURE:**
  - the data model gains `SHOPPING_ITEM` and `AISLE_CHOICE`;
  - "Navigation & Screens" gains the List tab;
  - §8 "Phase 2 shopping list" is marked built.
- **SPEC:** FR-31 to FR-35, and §3 marks Phase 2 as built.
