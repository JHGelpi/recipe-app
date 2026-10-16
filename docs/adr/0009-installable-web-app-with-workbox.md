# 0009. Installable web app with a Workbox-generated service worker

- **Status:** Accepted
- **Date:** 2026-10-16
- **Builds on:** ADR-0007 (web first)

## Context
ADR-0007 delivers the app on the web first. To try it as a phone app, the owner needs it on the iPhone home screen and able to open with no connection (FR-28, NFR-4). Without a service worker the app's files load from the network, so it works offline only while already open. Safari also needs a storage mode that suits it, and an offline start must not sign the user out and wipe unsynced recipes.

## Decision
- **App shell:** after `expo export`, `workbox generateSW` writes `sw.js`, which precaches every file of the build (about 11 MB, including PowerSync's four WebAssembly builds). Navigations fall back to the cached `index.html`. `/auth`, `/api`, `/sync`, `/email-templates` and `/local-ca.crt` always go to the network. The app registers the worker in production builds only.
- **Updates:** a new worker installs in the background and waits. A banner offers "Reload", which activates it. The app never reloads by itself, so typing is not lost. Caddy sends `sw.js` and every other non-hashed file with `no-cache`, and hashed bundles as `immutable`.
- **Installability:** a web app manifest, icons, and an `apple-touch-icon` in Expo's HTML template.
- **Storage:** the local database uses PowerSync's `OPFSCoopSyncVFS` on every browser, as PowerSync recommends for Safari/iOS. The app requests persistent storage.
- **Session:** the app starts from the saved session instead of waiting for it to be renewed (offline, auth-js retries renewal for about 30 seconds). When renewal fails because the network is unreachable, the app stays signed in from the saved session. Local data is wiped only on an explicit sign-out or when a different user signs in.

New dependency: `workbox-cli` (development only, `apps/mobile`).

## Alternatives considered
- **A hand-written service worker:** no dependency, but we would own precache versioning, cleanup and update handling, where service worker bugs usually are; the symptom is a phone stuck on an old version.
- **No service worker, long HTTP cache lifetimes:** Safari does not promise to keep or serve those files offline.
- **`workbox-window` for registration:** a runtime dependency for about 40 lines of browser API code.
- **Automatic reload on update:** simpler, but can discard a half-typed recipe.
- **Keep IndexedDB storage:** no switch-over, but no multi-tab support on Safari and not PowerSync's recommendation there.

## Consequences
- The first visit downloads about 11 MB; later builds download only changed files.
- Switching storage mode leaves earlier IndexedDB data unused; each browser re-downloads from the server, and anything unsynced in the old storage is stranded.
- OPFS has known issues in Safari private browsing; the app shows a message there. If PowerSync's worker file itself fails to load, the SDK's calls hang and no message appears.
- While offline with an expired token, the UI shows the last known role; writes after a demotion are rejected on upload. A user whose session was revoked sees their own local data until the server's rejection signs them out.
- In Playwright, Chromium reports `navigator.onLine === true` after a reload served by the service worker even while offline; the e2e suite re-applies offline mode after such reloads. Real devices report the network state correctly.
- The service worker is a second place where the app's files live; when debugging "old code" on a device, check the footer's build time first.
