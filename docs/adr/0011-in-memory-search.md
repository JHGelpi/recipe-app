# 0011. Search with an in-memory index over the local database

- **Status:** Accepted
- **Date:** 2026-10-17
- **Builds on:** ADR-0004 (offline-first), ADR-0010 (recipe content as JSON)

## Context
Users type a word and expect every recipe mentioning it in the title, ingredients or tags (FR-19), offline (FR-20), in under 300 ms over 2,000 recipes on a mid-range phone (NFR-6). ARCHITECTURE.md had assumed SQLite FTS5.

## Decision
The recipe list already loads the household's recipes from the local database. `packages/domain` builds an in-memory index from them (title, ingredient lines, tags, normalised for case, accents and whitespace) only when the data changes. Each keystroke matches every word as a plain substring and every selected tag exactly, ranked by field (title, then tag, then ingredient, with a bonus at the start of a word). The list renders results in a virtualized `FlatList`.

## Alternatives considered
- **SQLite FTS5 with the trigram tokenizer:** scales furthest and all PowerSync SQLite builds include it, but it needs triggers on PowerSync's internal `ps_data__recipes` table, matches only 3 or more characters, and is testable only end to end.
- **SQL `LIKE` over JSON at query time:** no index, but scans every recipe's JSON on every keystroke.

## Consequences
- Search is pure, unit-tested functions; partial words of any length work.
- Rebuilding the index after a change parses every listed recipe (tens of milliseconds at 2,000).
- Memory holds one search string per recipe.
- If collections outgrow memory, FTS5 with trigram can replace the index behind the same `searchRecipes` interface.
- Steps and notes are not searched, and there is no typo tolerance.
