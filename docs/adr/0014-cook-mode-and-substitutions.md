# 14. Cook mode on the phone; substitutions asked live and remembered

Date: 2026-10-17 · Status: Accepted

## Context

Cooking from the phone (FR-21) must work offline at the counter, with servings scaled (FR-22) and units converted (FR-23). Substitutions (FR-24) need the AI, but are wanted at once; the same question asked again should cost nothing and work offline.

## Decision

- **Display-only maths.** Scaling, conversion and formatting are pure functions in `packages/domain/src/cooking.ts`, used only for display. The saved recipe never changes.
  - Conversion is between units of the same kind only: volume ↔ volume and weight ↔ weight, with US customary factors. Counted units never convert.
  - Amounts written inside step text are not changed; a note says so.
- **Cook mode lives on the phone.** It reads only the local database. The cook's place (ticks, step, servings, units) is kept in localStorage per recipe for 12 hours and cleared on sign-out. The screen is held awake with the Screen Wake Lock API, asked for again whenever the page becomes visible.
- **Substitutions are asked live and remembered.**
  - `POST /api/substitutions` reads the recipe as the user, checks the shared AI cap (`ai_usage`) and calls Claude with a strict `record_substitutes` tool.
  - It validates the answer with zod and upserts it into the synced `substitutions` table, one row per recipe ingredient.
  - Only the API writes that table; phones read it, so the answer appears on every household device, offline too.
  - Admins and members may ask; viewers read.

## Alternatives considered

- **Volume ↔ weight with a density table, or conversion by AI:** approximate or variable, and the AI needs a connection and costs every time.
- **Substitutions not stored:** the same question costs again, and never works offline.
- **Substitutions queued like imports:** works offline, but answers are wanted now, at the stove.

## Consequences

- A remembered answer can describe a line that has since been edited; the app labels it "This was for …" and offers Ask again.
- The phone shows amounts the cook did not type (scaled or converted). Rounding rules are in the domain tests.
- The wake lock needs iOS 16.4+ in Safari, and 18.4+ in a home-screen app; where it is missing, cook mode says the screen may sleep.
