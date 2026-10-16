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
