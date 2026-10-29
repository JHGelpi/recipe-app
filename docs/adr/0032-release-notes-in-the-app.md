# 0032. Release notes in one file that sets the version, bundled into the app

- **Status:** Accepted
- **Date:** 2026-10-28

## Context
People had no way to learn what changed after an update, and the app had no version number, only a build time in the footer (FR-47, issue #102). The notes must work offline (rule 3). They must also appear once per device after an update and never on a first visit. And a deploy that adds no notes must show nothing.

## Decision
- **One file:** `RELEASE_NOTES.md` at the repo root holds every release, newest first (`## 1.1.0 · 2026-10-28`, then `- ` bullets). The newest entry's number is the app version; nothing else sets it. The parser lives in `packages/domain/src/releaseNotes.ts`.
- **Bundled as a generated module:** Metro only resolves files inside its watch folders, which don't include the repo root, so `pnpm release-notes` copies the text into `apps/mobile/src/whatsNew/releaseNotesText.ts`. The copy is committed, like `htmlEntities.ts`. `scripts/release-notes.test.mjs` runs in `pnpm test` and fails when the file doesn't parse or the copy is stale.
- **What a device has seen:** the device stores the version it has seen notes up to, in local storage (`dishkept.whatsNew.seen`), and signing out keeps it. At start, before the service worker registers, a device with no stored value is classified once:
  - A first visit (no service worker in control) counts the current version as seen.
  - A device that already ran the app counts as having seen none, so it gets 1.1.0 once.
  The sheet shows every newer release, and only to someone signed in. "Got it" stores the current version.
- **Deploy:** the proxy image carries the file at `/etc/dishkept/RELEASE_NOTES.md`, outside every served root. `pnpm prod:deploy` compares the running image's newest version with the checkout's and warns when they match.

## Alternatives considered
- **A Metro transformer importing the `.md` directly**, as the API's esbuild does for prompts. That needs the repo root in Metro's watch folders, which then crawls `.local/` (Caddy's data) and everything else at the root. A small generated file with a staleness check is simpler.
- **Generating at build time only (gitignored):** typecheck and unit tests would then need a generation step first in every environment.
- **The version in `package.json`:** a second place to keep in step with the notes, which is exactly what the issue rules out.
- **Showing the sheet on the Reload tap only:** it would miss updates brought in by another tab or a restart. Comparing versions at start catches every route.

## Consequences
- Releasing with user-visible changes means adding an entry and running `pnpm release-notes`. CI catches a forgotten regeneration, and `prod:deploy` points out a forgotten entry.
- A device whose local storage is cleared while its service worker stays sees every release's notes once more. That's harmless.
- The footer shows "Version x.y.z · Build …", so a bug report can name the version.
