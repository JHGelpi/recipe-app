# Search — Design

> Status: **Draft for review** · Date: 2026-10-17
> Sub-project 3 of 7 for Phase 1 (see `2026-10-12-walking-skeleton-design.md` §1). Builds on the recipe model (`2026-10-16-recipe-model-design.md`). Requirements: `docs/SPEC.md`. Architecture: `ARCHITECTURE.md`, `docs/adr/`.

## 1. Purpose

Let the owner find a recipe by typing a word and seeing every recipe that mentions it, then narrowing with tags, offline and fast on a phone.

**How it is used (the owner's choice):** type a word, find it anywhere, as in SPEC journey 4. For example, "chicken", or "chick" as the start of a word, finds every recipe with it in the title, ingredients or tags; tag filters narrow the result.

**Covers:** FR-19 (search by title, ingredient and tag; combinable filters) and FR-20 (offline search), with NFR-4 and NFR-6 (local search under 300 ms over 2,000 recipes).

### Success criteria

1. A search box on the Recipes list filters as you type, offline included.
2. A word matches the title, the ingredients and the tags, as part of a word and in any letter case.
3. Several words must all match, in any fields.
4. Tag chips narrow the list. Several selected tags require all of them. Typed words, tags and the All / Favorites tabs combine.
5. A search over 2,000 recipes returns in under 300 ms on a mid-range phone; title matches are listed first.
6. Clearing the box and the chips brings the full list back.

### Out of scope

- Searching steps and notes.
- Typo tolerance ("chiken" does not find "chicken").
- Server-side search.
- "What can I make with these ingredients" matching.
- Remembering the search between visits to the list.

## 2. Decisions made during design

| Decision | Choice | Why |
|---|---|---|
| Where search runs | On the phone, over the local database | Offline-first (NFR-4); no server round trip. |
| How | An in-memory index built from the recipes the list already loads (option A) | Simplest correct choice at family scale. It does not depend on PowerSync internals, partial words of any length work, and ranking is easy to get right and to test as pure functions. |
| SQLite FTS5 with the trigram tokenizer (option B) | Rejected for now; the growth path | It needs triggers on PowerSync's internal `ps_data__recipes` table, matches only 3 or more characters, and is testable only end to end. All four PowerSync SQLite builds include FTS5 and trigram, so the switch stays open. |
| SQL `LIKE` over JSON at query time (option C) | Rejected | Scans every recipe's JSON on every keystroke; the least headroom. |
| Fields searched | Title, ingredient lines as typed, tags | Steps and notes would match too much ("oven"). |
| Matching | Every word must appear as a substring, after normalising case, accents and spaces; tags match exactly | Predictable; partial words work. |
| Ranking | Best field per word: title 3, tag 2, ingredient 1; +1 at the start of a word; ties alphabetical | Title hits first, as people expect. |
| List rendering | Virtualized `FlatList` again | With search there is no need to keep every row in the page; 2,000 rows render fast. Reverses the recipe-model ruling to render every row. |
| Row reading for the list | A light parser (JSON plus shape checks), not the full zod schema per row | The full schema per row on every change was flagged in review; the list needs only titles, tags and ingredient text. |

### Known consequences

- Rebuilding the index parses every listed recipe's ingredients when the data changes: about 50–100 ms for 2,000 recipes on a phone, never per keystroke.
- Memory holds one search string per recipe; fine at family scale.
- Tests can no longer assume a recipe far down a long list is in the page; they find it through search.

## 3. Search functions (`packages/domain/src/search.ts`)

Pure functions with unit tests, shared with a future native build.

```ts
type SearchSource = { id: string; title: string; ingredients: string[]; tags: string[] };
type SearchEntry = { id: string; title: string; sortKey: string; text: { title: string; ingredients: string; tags: string }; tags: string[] };

normalizeSearchText(text: string): string
buildSearchIndex(recipes: SearchSource[]): SearchEntry[]
searchRecipes(index: SearchEntry[], query: string, selectedTags: string[]): string[]  // ordered ids
```

- **Normalisation** (`normalizeSearchText`, used for both sides): Unicode NFD with combining marks removed, lowercase, whitespace runs collapsed to one space, trimmed.
- **Entry texts:** `title` normalised; `ingredients` is the normalised ingredient lines joined with `\n`, so a word never spans two lines; `tags` is the normalised tags joined with `\n`. `tags` (the array) keeps the recipe's tags for exact matching.
- **Query:** normalised and split on spaces into words, duplicates removed. An empty query has no words.
- **Match:** a recipe matches when every word is a substring of at least one of its three texts, and every selected tag is in its `tags` array exactly.
- **Score** (only when there are words): the sum, over words, of the best field the word is found in (title 3, tag 2, ingredient 1), plus 1 when that occurrence starts a word (at the start of the text or after a space, newline or punctuation).
- **Order:** with words, by score descending, then by `sortKey` (the title, lowercased) and `id`. Without words, by `sortKey` and `id`, matching the current list order.

## 4. The list screen (`apps/mobile`)

### Data

- The list query also selects `ingredients`: `select r.id, r.title, r.tags, r.ingredients, starred …`, for both the All and Favorites queries.
- A light row reader turns each row into a `SearchSource`: tags from JSON text or a Postgres array literal (as `rowToRecipe` accepts); ingredients from JSON text, keeping each element's `raw` when it is a string. Anything unreadable becomes an empty list. The row still lists by its title.
- `useMemo` builds the index from the rows; it rebuilds only when the query result changes.

### Controls

- A search box labelled "Search recipes", with a clear (✕) button (shown when there is text) and `returnKeyType="search"`. The typed text goes through React's `useDeferredValue` before searching.
- Tag chips: the distinct tags of the current tab's recipes, alphabetical, in a horizontally scrolling row. Selected chips come first, filled, with `aria-pressed`/selected state. Tapping toggles.
- The All / Favorites tabs stay; search and tags apply within the chosen tab. Switching tabs keeps the search text and selected tags. A selected tag that does not exist in the new tab stays selected, and simply matches nothing.
- While searching or filtering, a result line: "1 recipe" or "N recipes".
- When nothing matches: "No recipes match" and a **Clear search** button that empties the box and deselects all chips.

### Rendering

`FlatList` (virtualized) for the results, with the existing row layout (title, tags, star).

### Tests that look for a recipe in the list

A new e2e helper `findRecipe(page, title)` types the title into the search box and returns the title's locator. Tests that look for a title in the list use it. Tests that check a title is absent search for it and expect "No recipes match" (or a zero count). Waiting for "Seed pancakes" to sync also goes through search.

## 5. Testing

### Unit (Vitest)

- `normalizeSearchText`: case, accents both ways (`jalapeño` / `jalapeno`), whitespace.
- Matching: partial word in title, ingredients and tags; several words across fields; one- and two-letter words; a word spanning two ingredient lines does not match.
- Tags: exact match, several required, combined with words.
- Empty query and no tags: everything, alphabetical.
- Ranking: title over ingredient; word start over middle; ties by title.
- A recipe with unreadable ingredients is found by title.
- Speed: index of 2,000 synthetic recipes (10 ingredients and 3 tags each) built, and a three-word search run, each under a generous budget (build 1,000 ms, search 100 ms in Node) so a slow CI runner does not fail it.
- Row reader: malformed ingredient JSON, a non-string `raw`, missing columns, tags as JSON and as an array literal.

### End to end (Playwright, against the built app)

1. Part of a title finds the recipe. Part of an ingredient finds another, ranked below a recipe with the word in its title.
2. Two words list only recipes containing both.
3. Two selected tag chips narrow to recipes having both, combined with a typed word.
4. Search within Favorites.
5. No match shows "No recipes match"; Clear search brings back the list.
6. Search works offline.
7. Existing specs use `findRecipe`; sync between sessions proves a synced recipe can be found by search.

## 6. Documentation

- **ADR-0011** "Search with an in-memory index over the local database": option A, the 2,000-recipe budget, FTS5 with trigram as the growth path behind the same `searchRecipes` interface.
- `ARCHITECTURE.md`: the Mobile App's Search component becomes "In-memory index over the local DB (ADR-0011)"; the Search row in the responsibilities stays offline.
- `docs/SPEC.md`: FR-19 notes that steps and notes are not searched yet.

## 7. Acceptance criteria

1. The success criteria in §1 hold on the owner's iPhone.
2. Lint, typecheck, unit, stack, RLS, API and e2e suites pass locally and in CI.
3. The speed test passes, and searching on the phone with the household's recipes feels instant.
