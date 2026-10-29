# 0031. Units and Appearance belong to the person, in a per-person table

- **Status:** Accepted
- **Date:** 2026-10-28
- **Amends:** ADR-0020 (the Appearance stored per device) and FR-23's device setting

## Context
ADR-0020 kept Appearance in each device's `localStorage`, and FR-23's default Units followed it. A person who signs in on a second device, or signs out and back in, had to choose again (issue #60). Both settings belong to the person: they must follow them to every device, survive a household move (ADR-0015), and be theirs alone, whatever their role.

## Decision
- **A per-person table, `person_settings`:** `id` is the person's own id, so every device writes the same row. It also has `user_id`, `units` (`as_written`/`us`/`metric`), `appearance` (`system`/`light`/`dark`) and the usual `created_at`, `updated_at`, `updated_by` and `deleted_at`.
- **No `household_id`, an exception to CLAUDE.md rule 1.** The row is not household data, and keying it by household would lose it on a move. RLS limits select, insert and update to `user_id = auth_user_id()`. There is no delete grant.
  - The RLS registry lists it under `PERSON_TABLES`, and `person-settings.test.ts` covers it: own row only, even within a household; Viewers; a move; values; grants.
- **Rule 6:** the `my_settings` stream selects `WHERE user_id = auth.user_id()`, the same rule as the RLS select.
- **Rule 4:** every role writes their own row, Viewers too, as with favorites and ratings.
- **Uploads go through `/api/upload`.**
  - A put inserts the row, or on conflict updates both settings. Someone else's row is hidden by RLS, so the update is refused.
  - A patch changes only the setting that changed, so choices made on two devices each win for their own setting, and the last save wins (FR-30).
- **The app:**
  - `PersonSettingsSync` watches the row while someone is signed in, and feeds the existing Units and Appearance stores. A choice is applied at once and saved to the row; offline, it syncs later.
  - Other tabs share the local database, so they follow by their own sync. The `storage` event listeners are gone.
- **No flash at start:**
  - The app copies the synced settings to `localStorage` (`dishkept.personSettings`), tagged with the person's id.
  - `index.html`'s pre-paint script uses that copy only when the saved session belongs to the same person. Signed out, or for anyone else, it uses the system's theme.
  - Signing out clears the copy. Changing the script means updating its hash in the Caddyfile's Content-Security-Policy (ADR-0026); `csp.test.ts` says so.
- **Starting values:** As written and System. The old device keys (`dishkept.units`, `dishkept.appearance`) are deleted unread. Before sign-in, Appearance is System.

## Alternatives considered
- **A household-scoped row per person:** follows rule 1 literally, but every move would have to copy or reset it.
- **Columns on `memberships`:** the person's membership row is also per household, and it is written only by definer functions.
- **Keeping `localStorage` and syncing it through the API:** a second sync path beside PowerSync, and a second source of truth.

## Consequences
- New per-person data follows this pattern: key on `user_id`, add the table to `PERSON_TABLES`, and mirror its RLS in a user-keyed stream.
- A choice reaches the database a moment after the tap. A reload in that moment loses it, as any unsaved local change would be lost.
- The cooking place (a recipe's units, servings and step for 12 hours) stays on the device, as before.
