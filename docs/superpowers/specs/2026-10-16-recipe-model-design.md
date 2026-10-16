# Recipe Model and Management — Design

> Status: **Draft for review** · Date: 2026-10-16
> Sub-project 2 of 7 for Phase 1 (see `2026-10-12-walking-skeleton-design.md` §1). Builds on the walking skeleton and the phone preview (`2026-10-16-phone-preview-design.md`). Requirements: `docs/SPEC.md`. Architecture: `ARCHITECTURE.md`, `docs/adr/`.

## 1. Purpose

Turn the title-only recipe into a full recipe that the owner can type in by hand on an iPhone, read, edit, star, delete and restore, offline and synced across the household.

**Who and how:** until import exists (sub-project 4), the owner will type real family recipes in by hand on the phone, so entering and editing must be quick on a small screen.

**Covers:** FR-15 (edit all fields; personal notes, household-shared), FR-16 (free-form tags), FR-17 (favorites), FR-18 (30-day trash), with FR-28 and FR-30 for the new fields, and NFR-1 for the new table.

### Success criteria

1. On the phone, online or offline, a full recipe (title, servings, prep and cook time, ingredients one per line, steps, tags, notes) can be typed in a couple of minutes.
2. A recipe opens in a readable layout. Admins and members can edit every field. Changes reach other household devices within about 10 seconds. Viewers see everything and can change nothing of the household's data, enforced in RLS and in the UI.
3. Each user can star recipes and show only their favorites.
4. Deleting moves a recipe to Trash. Admins and members can restore it within 30 days; after that the server deletes it for good.
5. Every new table has `household_id`, RLS, isolation tests and a matching sync rule.

### Out of scope

- Own photos on a recipe (FR-15): deferred to the import sub-project, which decides file storage for FR-12 anyway.
- AI tag suggestions (FR-16): deferred to the import sub-project, which brings the AI pipeline. Here, suggestions come from tags the household already uses.
- Filtering by tag or ingredient, and full-text search: the Search sub-project (FR-19, FR-20).
- Private per-user notes, a source or credit field, recipe drafts or autosave, a manual "delete forever".

## 2. Decisions made during design

| Decision | Choice | Why |
|---|---|---|
| Storing ingredients and steps | JSON arrays on the `recipes` row (option A) | One recipe is one row, so a save is atomic and "last save wins" (FR-30) applies to the whole recipe: two offline edits never produce a mix of both. Smallest change to RLS, sync and upload. Stable ingredient IDs inside the JSON keep the Phase 2 shopping list possible; a server-side index table can be derived later (option C). |
| Separate ingredient and step tables (option B) | Rejected | Per-line last-write-wins can interleave or duplicate lines after concurrent offline edits, and adds two tenant tables to the RLS, sync and upload surface. |
| Tags | `text[]` on the recipe, lowercased | Same reasoning as ingredients; suggestions come from distinct tags in the household's local recipes. |
| Entering ingredients | One line each, parsed by a pure function in `packages/domain`; the typed text is kept and always displayed | Fast to type on a phone; structure for search, scaling and cook mode later; nothing the parser misreads ever looks wrong on screen. |
| Notes | One shared notes field per recipe | The owner's choice: notes are for the household. |
| Photos | Deferred | The owner's choice; file storage is designed once, in import. |
| Favorites | Own table, per user, own sync stream | Favorites are per user; a recipe column cannot hold them. |
| Viewers and favorites | Viewers may star | The owner's choice. A favorite changes only the viewer's own list. CLAUDE.md rule 4 becomes "Viewers can't change household data". |
| Trash | `deleted_at` set means in Trash; a 30-day purge runs as the user under a narrow RLS `DELETE` policy | No privileged role or scheduler; CLAUDE.md rule 1 holds. |

### Known consequences

- Two people editing different parts of the same recipe at the same time: the later save wins and the other edit is lost. Accepted under FR-30.
- Server-side queries over ingredients read `jsonb`. The phone searches its local copy (sub-project 3).
- A household in which no admin or member ever opens the app keeps expired trash on the server; nobody can see it.

## 3. Data model, tenancy and sync

### Migration

New file `db/migrations/<timestamp>_add_recipe_details_and_favorites.sql`. The applied walking-skeleton migration is not edited.

**`recipes` gains:**

| Column | Type | Constraint |
|---|---|---|
| `servings` | `integer`, nullable | 1 to 999 |
| `prep_minutes` | `integer`, nullable | 0 to 10,000 |
| `cook_minutes` | `integer`, nullable | 0 to 10,000 |
| `ingredients` | `jsonb not null default '[]'` | `jsonb_typeof = 'array'`, at most 200 elements |
| `steps` | `jsonb not null default '[]'` | `jsonb_typeof = 'array'`, at most 100 elements |
| `tags` | `text[] not null default '{}'` | at most 30 elements |
| `notes` | `text not null default ''` | at most 10,000 characters |

Element shapes (validated by zod in the API; the database checks only types and counts):

- Ingredient: `{ id: uuid, raw: string (1–500), quantity: number | null, quantity_max: number | null, unit: Unit | null, item: string (0–500), note: string | null (≤ 500), heading: boolean }`
- Step: `{ id: uuid, text: string (1–2,000) }`
- Tag: string, 1–40 characters, lowercase, trimmed.

The existing `recipes` select, insert and update policies cover the new columns unchanged.

**Purge policy (new):**

```sql
create policy recipes_purge on public.recipes for delete to authenticated
using (
  household_id = (select public.auth_household_id())
  and (select public.auth_household_role()) in ('admin', 'member')
  and deleted_at is not null
  and deleted_at < now() - interval '30 days'
);
```

with `grant delete on public.recipes to authenticated`.

**`favorites` (new tenant table):**

| Column | Type |
|---|---|
| `id` | `uuid primary key` (client-generated) |
| `household_id` | `uuid not null references households` |
| `user_id` | `uuid not null` |
| `recipe_id` | `uuid not null references recipes on delete cascade` |
| `created_at`, `updated_at` | `timestamptz not null default now()` (server-owned, as on recipes) |
| `updated_by` | `uuid` (server-owned) |
| `deleted_at` | `timestamptz` |

- `unique (user_id, recipe_id)`; un-starring sets `deleted_at`, starring again clears it on the same row.
- RLS enabled, with select, insert and update policies all requiring `household_id = auth_household_id()`, `user_id = auth_user_id()`, and (insert and update) that `recipe_id` belongs to a recipe in the same household. Any role may write its own favorites. No client `DELETE` policy (cascade from a purged recipe only).
- The same server-owned-field triggers as `recipes` set `created_at`, `updated_at`, `updated_by`.
- Added to the publication PowerSync replicates.

### Sync config (`powersync/sync-config.yaml`)

- `household_recipes` selects the new columns as well. It still mirrors the recipes select policy.
- New stream `user_favorites`, auto-subscribed: `SELECT id, household_id, user_id, recipe_id, created_at, updated_at, updated_by, deleted_at FROM favorites WHERE user_id = auth.user_id()`. Its comment states that it mirrors the favorites select policy. The user filter is enough: a user's rows are in their own household by RLS on write.

### Local schema (`apps/mobile/src/db/schema.ts`)

`recipes` adds `servings`, `prep_minutes`, `cook_minutes` (integer), `ingredients`, `steps`, `tags` (text holding JSON), `notes` (text). New table `favorites` with the columns above.

## 4. Domain package (`packages/domain`)

### Ingredient lines

`parseIngredientLine(raw: string): ParsedIngredient` (all fields except `id`):

| Input | quantity | quantity_max | unit | item | note | heading |
|---|---|---|---|---|---|---|
| `2 1/2 cups flour, sifted` | 2.5 | null | `cup` | flour | sifted | false |
| `½ tsp salt` | 0.5 | null | `tsp` | salt | null | false |
| `1.5 lb chicken thighs` | 1.5 | null | `lb` | chicken thighs | null | false |
| `2-3 cloves garlic, minced` | 2 | 3 | `clove` | garlic | minced | false |
| `1 T butter` | 1 | null | `tbsp` | butter | null | false |
| `1 t vanilla` | 1 | null | `tsp` | vanilla | null | false |
| `3 eggs` | 3 | null | null | eggs | null | false |
| `salt to taste` | null | null | null | salt to taste | null | false |
| `For the sauce:` | null | null | null | For the sauce | null | true |

- Quantities: integers, decimals, `a/b`, mixed numbers, Unicode vulgar fractions (¼ ½ ¾ ⅓ ⅔ ⅛ and mixed like `1½`), and ranges with `-`, `–` or `to`.
- Units, canonical: `cup, tbsp, tsp, oz, lb, g, kg, ml, l, pinch, dash, clove, can, package, stick, slice, pint, quart, gallon`, with plurals, common abbreviations (`c`, `tbs`, `tbsp.`, `ozs`, `lbs`, `pkg`), and case-sensitive single-letter `T` (tablespoon) and `t` (teaspoon).
- The note is the text after the first comma. A line ending in `:` with no quantity is a heading.
- Anything unrecognised keeps the line as `item`, with null quantity and unit.

### Lists from editor text

- `ingredientsFromText(text: string, previous: Ingredient[], newId: () => string): Ingredient[]` — one per non-empty line; a line identical to an unused previous line keeps that line's `id`; others get `newId()`.
- `stepsFromText(text: string, previous: Step[], newId: () => string): Step[]` — one per non-empty line, leading `1.`, `1)`, `Step 1:` stripped; IDs kept as for ingredients.
- `normalizeTags(input: string): string[]` — split on commas, trim, lowercase, collapse spaces, drop empties and duplicates, keep order.
- `ingredientsToText`, `stepsToText` — the reverse, for opening the editor (`raw` lines; step texts).

### Schemas (zod)

`unitSchema`, `ingredientSchema`, `stepSchema`, `tagSchema`, the extended `recipeSchema` and `recipePatchSchema` (limits from §3), `favoriteSchema`, `favoritePatchSchema`, `RECIPE_CLIENT_FIELDS` (adds the new columns), `FAVORITE_CLIENT_FIELDS` (`household_id, user_id, recipe_id, deleted_at`). The API validates uploads against them; the app parses synced rows with them.

## 5. The app (`apps/mobile`)

### Routes

| Route | Content |
|---|---|
| `/` Recipes | Titles with tags and a star; an All / Favorites switch; **New recipe** and **Trash** for admins and members; status line and footer as now |
| `/recipe/[id]` | Title and star; "Serves 4 · Prep 15 min · Cook 40 min" (only the parts set); tags; ingredients as typed, headings in bold; numbered steps; notes. **Edit** and **Move to Trash** for admins and members. When the recipe is in the Trash: "This recipe is in the Trash" and **Restore** (admins and members) |
| `/recipe/new`, `/recipe/[id]/edit` | Title, Servings, Prep (min), Cook (min), Ingredients (multi-line, one per line), Steps (multi-line, one per line), Tags (comma-separated, with chips for household tags not yet on the recipe), Notes. **Save**, **Cancel** |
| `/trash` | Recipes trashed in the last 30 days, newest first, "Deletes in N days", **Restore**. Admins and members only; viewers who open it are sent to `/` |

The quick "Add recipe" form on the list is removed; **New recipe** is the only way to create a recipe.

### Editing

- **Save:** builds ingredients, steps and tags with the domain functions, validates against `recipeSchema`, writes the recipe in one local transaction, and opens it. Errors appear beside their field (for example "Title is required", "Servings must be 1 to 999"); nothing is written until the recipe is valid.
- **Cancel** with unsaved changes asks "Discard your changes?" (Discard / Keep editing).
- A save writes the whole recipe; it does not change `deleted_at`. If the recipe was moved to Trash elsewhere meanwhile, it stays there with the saved changes.
- **Move to Trash** asks for confirmation, then sets `deleted_at` to now.

### Repository (thin screens)

`apps/mobile/src/recipes/`:

- Reads: `useRecipeList({ favoritesOnly })`, `useRecipe(id)`, `useTrash()`, `useHouseholdTags()`. Rows are parsed with the domain schemas; a row whose JSON fails to parse is left out of lists and shown as "This recipe could not be read" on its own screen, never a crash.
- Writes: `createRecipe(input, claims)`, `updateRecipe(id, input)`, `trashRecipe(id)`, `restoreRecipe(id)`, `setFavorite(recipeId, starred, claims)`.
- `favoritesOnly` and the star use the current user's non-deleted `favorites` rows.

### Roles in the UI

Viewers see no New recipe, Edit, Move to Trash, Restore or Trash controls; they see the star. RLS enforces the same on the server.

### Purge call

After the bridge connects as an admin or member, the app calls `POST /api/trash/purge` if the last successful call recorded in `localStorage` (`recipes.lastPurge`) is more than 24 hours ago or missing. A failure is ignored until the next connect. The Trash screen and lists never show recipes trashed more than 30 days ago.

## 6. The API (`apps/api`)

- `/api/upload` handles the new recipe columns and a `favorites` table: `put` (upsert by `id`), `patch`, and soft delete via `deleted_at`, each validated with the domain schemas and applied under `asUser`, one savepoint per op, as today. A favorites `put` that collides with the `(user_id, recipe_id)` unique constraint is rejected like any other refused op.
- `POST /api/trash/purge`: verifies the token, then under `asUser` runs `delete from recipes where deleted_at < now() - interval '30 days'`. RLS limits it to the caller's household and to admins and members. Returns `{ purged: n }`. A viewer gets `{ purged: 0 }`.

## 7. Testing

### Unit (Vitest)

- Parser table: the cases in §4 plus about 30 more (spacing, plurals, abbreviations, `to` ranges, `1½`, commas inside parentheses, empty input).
- `ingredientsFromText` and `stepsFromText` keep IDs for unchanged lines, assign new ones otherwise; step numbering stripped; `normalizeTags`.
- Schemas: each limit in §3 rejected one past the edge and accepted at it; malformed ingredient objects rejected.
- Repository mapping: rows to recipes; corrupt JSON skipped.
- The once-a-day purge check.

### RLS isolation suite

- `favorites` in `registry.ts`, so the coverage guard requires it.
- Favorites: another household cannot read or write them; another user in the same household cannot read or write mine; a viewer can write their own; nobody can favorite another household's recipe.
- Recipes: viewers cannot update the new columns; `CHECK` constraints reject oversized arrays and non-array JSON.
- Purge policy: an admin or member can delete their household's recipe trashed 31 days ago; nobody can delete one trashed 29 days ago or one not trashed; a viewer cannot; another household cannot.

### API

- Upload accepts a full recipe; rejects an invalid ingredient shape and oversized lists; handles favorites insert, un-star and re-star; rejects a favorite of another household's recipe.
- Purge removes only expired trash in the caller's household; a viewer purges nothing; no token gives 401.

### End to end (Playwright, against the built app)

1. A full recipe typed in the editor shows every field as typed and reaches a second member's session within 10 seconds.
2. Editing ingredients and steps reaches the other session.
3. An empty title or 0 servings shows the messages and saves nothing.
4. Cancel with changes asks before discarding.
5. Starring shows the recipe under Favorites; another member does not see the star; a viewer can star.
6. Move to Trash removes the recipe from the list and it appears in Trash on the other session; Restore brings it back.
7. A recipe trashed 31 days ago (set in the test database) is gone from the server and the app after the purge call.
8. A viewer sees no New recipe, Edit, Move to Trash or Trash controls, but sees the star.
9. A recipe created and edited offline syncs once back online.
10. Tag chips offer tags the household already uses.

Existing specs move to the new `addRecipe` helper (through the editor) and must still pass.

## 8. Documentation

- **ADR-0010** "Recipe content as JSON on the recipe row": option A, recipe-level last-write-wins, stable ingredient IDs, the growth path to a derived index table.
- `docs/SPEC.md`: FR-17 and FR-18 lose *(proposed)*; FR-15 notes that own photos arrive with import; FR-16 notes that AI suggestions arrive with import.
- `CLAUDE.md`: rule 4 becomes "**Viewers can't change household data.** Enforce in RLS *and* hide controls in the UI. Their own favorites are the exception."
- `ARCHITECTURE.md` §6: ingredients, steps and tags on the recipe row; the `favorites` table.

## 9. Acceptance criteria

1. The success criteria in §1 hold on the owner's iPhone.
2. Lint, typecheck, unit, stack, RLS, API and e2e suites pass locally and in CI.
3. `favorites` is in the RLS registry and the sync config mirrors both policies.
