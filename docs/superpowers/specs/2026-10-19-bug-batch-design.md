# Bug batch: the tag bar and the deferred review findings: design

Date: 2026-10-19 · Status: approved in conversation, awaiting written review

## 1. Goal

Fix the tag bar the owner reported, and settle every minor finding the final reviews deferred in earlier sub-projects. Each finding below is either fixed, with the behaviour a person gets afterwards, or dropped, with the reason.

Success means:
- the tag bar scrolls with a mouse, a trackpad, a keyboard and a touch screen, in Chromium and Firefox;
- each fixed finding has a test that failed before its fix, unless it is a docs or comment change;
- nothing in SPEC or the ADRs changes meaning, except where §7 says so.

### Decisions made with the owner
- **Four PRs, in this order:** 1 App screens, 2 Import and AI, 3 Household, sharing and sync, 4 Production scripts. Each has its own plan, a final review, and its own PR against `main`. This spec covers all four.
- **Clear ticked** removes only fully ticked lines. A partly ticked line stays whole, and its amount counts only the rows still to buy.
- **Add to list** adds the amounts the sheet shows: the scaled amount in the units the cook chose.
- **Friend links** can be revoked in the app.
- **UI spec drift:** the UI spec is updated to match the app as built.

### Dropped, with reasons
- **About 10 MB of PowerSync WASM is precached on first load.** It is the offline database engine. Offline-first (NFR-1) needs it on the device before the first offline start.
- **The trash purge needs localStorage, so it never runs on a native build.** There is no native build yet. The native build will need its own storage for this anyway.
- **The search speed test runs in Node, not on a phone.** A note on the test's limits, not a bug.
- **SearchEntry has no title field.** Harmless; the index already holds the title.
- **A second device could kick a photo import before every page row arrives.** Theoretical: the window is the gap between page uploads, and the import retries. A fix needs a page count on the import row.
- **Ledger wording about unsynced rows.** The ledger no longer exists.

A finding that turns out to be fixed already, found while writing its plan, is recorded in that plan and skipped.

## 2. PR 1: App screens

### The tag bar (owner's report)
**Cause:** the bar overflows and scrolls, but:
- its scrollbar is hidden (`showsHorizontalScrollIndicator={false}`);
- a mouse wheel scrolls only vertically, so with a mouse or trackpad wheel the hidden tags can't be reached;
- on the owner's Firefox phone a swipe did not move it either. Gecko touch scrolling could not be reproduced here, so the fix does not depend on swiping.

**The fix** is a `ChipBar` component in `src/ui`, used by the Recipes and Favorites lists:
- **Scroll buttons:** while tags are hidden past an end, a round **‹** or **›** button sits at that end. The buttons are named "Scroll tags left" and "Scroll tags right", and each scrolls by about three quarters of the bar's width. Each button disappears when its end is reached.
- **Mouse wheel:** a vertical wheel over the bar scrolls it sideways, on web only and only while the bar overflows. The page does not scroll as well.
- **Edge fade:** a short fade on a side that has more tags.
- **Unchanged:** touch swiping and keyboard focus still scroll as before.

### Firefox: a tap lost after New recipe
While the "+" sheet animates closed (about 0.3 s), its focus trap pulls focus back. A tap on Title in that time is lost, and so is the typing after it.

**Fix:** the sheet hides at once on New recipe or Import, instead of sliding out, so nothing holds focus once the editor opens.

### Shopping list
- **Clear ticked removes only fully ticked lines.** A partly ticked line's amount counts only unticked rows.
- **Add to list adds what the sheet shows:** the scaled amount in the cook's chosen units.
- **The Add button:**
  - it is dimmed and does nothing when nothing is ticked;
  - a unit test checks its label ("Add 3 items", "Add 1 item") and its disabled state.
- **Word list:**
  - matching tries the last two words before the last word;
  - "red bell peppers" and "lemon juice" find their two-word entries;
  - "garlic clove" goes to Produce, olive to Pantry, and egg yolk to Dairy & Eggs.
- **Amounts:**
  - a quantity of 0 shows no amount;
  - an item that is only an amount ("2 cups") keeps the typed text as its item, with no amount, so it does not merge with real cups of something.
- **Sorting:** lines with the same `created_at` take their name from the row with the lowest id. The local query orders rows.
- **The line sheet** follows the live line while open. When the line's rows are all removed elsewhere, it closes.
- **Limit:** the 500-row cap holds when two phones upload at once. The API takes a per-household lock before counting.
- **Accessibility and text:**
  - a line has one tab stop for its tick, plus More;
  - sheet titles are headings;
  - Viewers see "The list is empty.";
  - a typed item over 200 characters shows "Items can be up to 200 characters.";
  - the "Added N items" banner clears after 4 seconds, or when the cook taps Add to list again.
- **Tests:** an RLS test that Viewers can't insert or update `aisle_choices`.

### Recipes, search and favorites
- Saving twice quickly saves once: the busy guard is a ref.
- A fast double tap on the star makes one favorite row.
- Clearing a search that matched nothing never shows "No recipes yet" for a frame.
- Titles sort by their folded form, so "Éclair" sorts with the E's.
- Search folds compatibility forms (NFKC: ligatures, full-width letters) and ß to "ss".
- Mark stripping applies to Latin, Greek and Cyrillic letters only, so Japanese and Indic words keep their marks.
- Tags from the server are trimmed and lowercased; empty ones are dropped.
- The result count's live region stays mounted, so screen readers announce changes.
- The word-start bonus counts a word start after a digit or a symbol ("2cups", "½cup").
- The list reads each row's tags once per row change, not on every render.
- After a new recipe is saved, the search and tag filters clear, so the new recipe shows.
- Over-long ingredient, step and tag errors name the line ("Ingredient 3 is over 500 characters").
- An ingredient with an unknown future field still reads; unknown keys are ignored. An unknown unit falls back to its raw text.
- The parser reads "1 ½ cups" and "1⁄2 cup" (the fraction slash).

### Recipe page and cook mode
- In the Trash, the page shows no servings bar, Substitute or Add to notes.
- The recipe page shows "Amounts in steps are for the original N servings" when servings are changed, as cook mode does.
- A recipe with no steps has Done in cook mode.
- A live edit from another phone that removes steps moves cook mode to the last step, never "Step 6 of 3".
- Leaving cook mode releases the wake lock even when requests overlapped.
- Clearing cook places on sign-out survives localStorage throwing.
- **Add to notes:**
  - a substitute whose name is already in its amount line is not repeated ("1 egg", not "1 egg (Egg)");
  - tapping Add to notes twice adds the line once.
- **Ask:**
  - a 404 on ask says "This recipe is no longer on the server.";
  - a stale answer label shows until a fresh answer arrives, then goes.
- **Amount display:**
  - tiny metric volumes show "a pinch" below 1 ml, not "1 ml"; a weight shows "a pinch" only below half a gram, so halved yeast still reads "⅛ oz" (final review);
  - count ranges read "½–1 clove", and a count of 1 takes the singular ("1 egg");
  - unit stepping uses the rounded value ("1 lb", not "16 oz"; "1 kg", not "1000 g").

### App shell
- `/healthz` is excluded from the service worker's fallback.
- `public/index.html` uses `http-equiv`.
- When one tab updates, the others show the update banner. Reload works even if the waiting worker became redundant; it reloads the page.
- The bridge does not re-run its wipe on online toggles after the user signed out.
- A dish photo download in flight at sign-out is discarded, not written.
- `localStorage.initialize()` opens IndexedDB once per queue.
- **Photos:**
  - when a recipe's photo changes, the old photo clears;
  - a photo that returned 404 is retried when it comes back online;
  - a list photo not yet on the device shows the app mark, and is announced as "Photo not downloaded yet".
- The "+" sheet closes whenever the tab bar hides.
- If the fonts never load, headings fall back to the system font at bold weight.
- Household: a member's email wraps, so "(you)" is never hidden.
- `make-icons.mjs` runs from any folder and closes Chromium on failure.

## 3. PR 2: Import and AI

- **Web pages:**
  - entities are decoded before tags are stripped; decoding repeats until stable, at most twice; named entities are case-insensitive, and the full HTML5 table is used;
  - an instruction string made of several `<p>`s becomes several steps;
  - a page's charset comes from its Content-Type or `<meta charset>`, and the page is decoded with `TextDecoder`, which falls back to UTF-8;
  - the HTML scanners are linear: tags are found with indexed searches, not lazy regexes across the page. A 3 MB hostile page parses in under 200 ms.
- **The AI cap:** parallel imports and asks in one household can't overshoot it. The cap check and spend reservation run under a per-household lock, and spend is settled afterwards.
- **Failures:**
  - quota failures in the same month offer no Try again, only "Try again next month" text;
  - a not-found Try again says "This import is no longer on the server";
  - Try again is not offered after photo_unreadable while the file is gone;
  - spend is kept when the upsert fails mid-request: it is recorded first, in its own transaction;
  - the "Ingredient to replace:" line goes inside the `<recipe>` block, escaped like the rest.
- **Pending imports:**
  - a pending import that has failed on the server three times while online shows Dismiss;
  - an unknown status from a newer server shows "Update the app to see this import";
  - the ready badge counts only drafts that can be read;
  - a page refused for good shows "Couldn't upload a photo";
  - a photo import with zero pages shows "No photos were saved" with Dismiss, and is not kicked again.
- **Photos:**
  - a photo upload checks the member's current role in the database before writing the file;
  - files moved after commit are repaired at API start: a pending move is finished, and an orphan is removed after a day;
  - tapping Import while a photo is still resizing says "Still preparing photos…" and imports when ready;
  - unsaved page previews are revoked on unmount;
  - pickPhotos resolves on focus return without a cancel event;
  - the photo-pages cache keeps 50 entries;
  - `photos_update` blocks changing `uploaded_at` in WITH CHECK.
- **Tests:**
  - an RLS test that Viewers can't update substitutions;
  - `pnpm test:e2e` prints a reminder at the end that the stack is in test mode;
  - the API logs its `ai_mode` at startup.
- **Code:**
  - `tx.json(... as never)` gets a typed helper;
  - the seed comment wording is fixed;
  - CLAUDE.md rule 1 says `asClaims` is for background work and for requests that verified the claims themselves.

## 4. PR 3: Household, sharing, sign-up and sync

- **Friend links (owner's choice):**
  - the Household screen lists the household's live friend links (created, expires) to anyone who can create one;
  - **Revoke** ends a link at once;
  - a revoked link's `/welcome/<code>` says the link has ended;
  - revoking goes through a new `SECURITY DEFINER` function that checks the caller, as ADR-0015.
- **Membership:**
  - removed (soft-deleted) memberships don't count toward the last-Admin rule;
  - Join can't be tapped twice;
  - if the token refresh fails after Join, the notice reads "joined";
  - pending invites and notices are read in effects, not during render;
  - `useMembershipWatch` does not refresh after cleanup;
  - a session with no claims never rewrites the stored owner key.
- **Sharing:**
  - Link reuses the recipe's live share instead of making a new one;
  - a refused share deletes its copied photo;
  - while the dish photo is still uploading, Link waits for it with "Uploading the photo…";
  - Stop and Save failures say what failed ("Couldn't stop sharing. Try again.");
  - a 5xx when reading a shared page says "Couldn't load this page. Try again.", not "no longer shared";
  - `sharing.ts` imports its schemas without `z.lazy`.
- **Sign-up:**
  - passSource prefers the friend link just opened over an older pending invite or share;
  - the in-memory rate limiter has a global cap, a per-IP cap, and expiry by time instead of scanning above 10k keys.
- **Sync:** the `user_favorites` stream also filters on `household_id`, mirroring the policy.
- **Docs:** ADR-0015 says that preview does not lock, and that the helpers became definer functions.
- **Tests:**
  - an e2e for resuming an invite after sign-in;
  - an e2e for a shared page with a photo;
  - the purge e2e checks that the recipe is gone on the server, not only in the app;
  - the purge API Viewer test uses its own household, so a parallel purge can't delete its recipe;
  - suites that need many recipes use fresh households.

## 5. PR 4: Production scripts

- **Backups:**
  - the manifest is built with `jq` from checked values, and the run fails if any `psql` fails;
  - `build` comes from `BUILD_TIME`, which is passed to the backup service;
  - backup names include the time (`YYYY-MM-DDTHHMMZ`), so two on one date don't collide;
  - the runbook line about one backup a day is removed.
- **Alert email:**
  - `alert.sh` sends a Date header and the last 30 log lines;
  - it uses STARTTLS on port 587 and implicit TLS on 465, chosen by `SMTP_PORT`;
  - `pnpm prod:test-alert` sends a test alert.
- **Restore and the drill:**
  - the drill reads one photo file back and compares its hash;
  - it refuses to build unless the checkout is a clean, current `main`;
  - `prod:restore` with no date lists the bucket and picks the latest;
  - `fetchBackup` uses `BACKUP_REMOTE`;
  - `fetchBackup` runs with `--no-deps`, so it never starts production's database.
- **Runbook:**
  - GCS key rotation says `--force-recreate backup`;
  - the JWT rotation step is rewritten so it works as written, and is tried against a throwaway project.
- **Safety:**
  - the guard reads quoted values (`APP_ENV="production"`, `'production'`);
  - `.local/` is in `.dockerignore`;
  - an interrupted test run can't leave the dev gate on: Playwright global setup turns it off;
  - the Caddyfile comment moves to the redirect it describes.

## 6. Testing

- **Each fix gets a test where it can:** unit for domain and UI logic, RLS and API suites for database and route rules, e2e for flows, and the existing shell tests (`test:backup`, `test:prod-config`) for scripts.
- **Docs and comment-only changes** need no test.
- **The tag bar** has a unit test of its scroll-button logic, and e2e tests:
  - at phone width with 14 tags, **›** appears and scrolling reaches the last tag;
  - **‹** then appears;
  - a mouse wheel scrolls the bar.
- **The Firefox focus fix** has an e2e that types into Title right after New recipe.
- **Firefox in CI:** the e2e suite also runs the tag bar and editor tests in Firefox. The Playwright project `firefox` runs only `@firefox`-tagged tests. Locally it needs `playwright install firefox` plus its system libraries, or the Playwright Docker image.

## 7. Docs

- **UI spec drift (owner's choice):** `docs/superpowers/specs/2026-10-17-ui-theme-design.md` is updated to match the app:
  - the icon corner fill is #101B31;
  - recipe meta is one line, not chips;
  - Leave household is the danger style, and Invite a friend the ghost style;
  - the review page's Imports link is a button.
- **SPEC:**
  - FR-6 gains friend link revoking;
  - FR-35 says Clear ticked removes fully ticked lines.
- **ADRs:**
  - ADR-0019 records Clear ticked and the units added;
  - ADR-0015 is corrected (PR 3).
- **ARCHITECTURE** gains `ChipBar` in the UI kit.
