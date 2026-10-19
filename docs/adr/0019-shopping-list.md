# 0019. Shopping list: added rows merged on screen, aisles by word list

- **Status:** Accepted
- **Date:** 2026-10-19

## Context

Phase 2 of SPEC §3 adds a shopping list (FR-31–FR-35). The owner chose:
- one shared list per household;
- choosing which of a recipe's ingredients to add;
- same items merged into one line, with amounts added where their units can be and the line showing its recipes;
- aisles guessed offline by a built-in word list, with the household's own fixes remembered.

Like everything else, the list must work offline, sync across the household's devices with last-save-wins, and stay read-only for Viewers (rule 4).

## Decision

1. **One row per added ingredient or typed item** in `shopping_items`: item, merge key, scaled amount, aisle, the recipe's id and a copy of its title, and a ticked time. Rows are never merged in the database.
2. **Merged on screen** by `shoppingLines()` in `packages/domain`:
   - rows are grouped by `item_key` (lowercase, simple English singulars);
   - volumes are added in millilitres and weights in grams, then shown in the first row's unit;
   - plain counts add, other units add only with the same unit, and ranges add both ends;
   - a line is ticked only when all of its rows are.
3. **Aisles:**
   - a fixed list of ten;
   - a built-in word list (`aisles.ts`), matched on the whole key and then on its last word;
   - `aisle_choices` rows that beat the guess. A choice's id is a UUID v5 of household plus item (`choiceId.ts`, using `crypto.subtle`), so phones choosing offline write the same row and later changes always find it. The API also upserts on `(household_id, item_key)` as a backstop. On screen, a choice wins over a row's own aisle.
4. **No new API routes:**
   - writes go through the upload path under RLS: Admins and Members write, everyone in the household reads;
   - sync streams mirror the select policies, and the sync service's role reads both tables;
   - cleared rows are soft-deleted and purged after 30 days with the trash;
   - the list is capped at 500 live rows.

## Alternatives considered

- **Merged rows in the database:** a simpler screen, but two phones adding the same item offline would overwrite each other (last save wins on the row), and which recipes a line came from would have to be kept by hand.
- **AI sorting into aisles:** handles odd items, but needs a connection and spends AI credit for every item.
- **Several lists, or per-store tags:** more flexible, but a choice on every add; not wanted now.
- **A random id per choice, merged by the server on `(household_id, item_key)`:** simpler, but a later change from the phone whose id lost would update a row the server never had, and be dropped.

## Consequences

- **Plural handling is simple English:** "onions", "berries" and "tomatoes" merge with their singulars; irregular plurals ("geese") don't. The household's own entries keep their spelling.
- **The word list will miss items,** which land in Other until someone moves them once.
  - A whole-key match beats the last word: "bell pepper" is Produce, but "pepper" and "black pepper" are Spices.
  - "Garlic clove" falls back to "clove", in Spices.
- **Rows added on a phone have no server timestamps until they sync.** The merge treats them as the newest rows.
- **A list row keeps its recipe's title** after the recipe is renamed or deleted; it has no foreign key to the recipe.
- **A household's list holds at most 500 live rows.** Past that, clearing ticked items makes room.
