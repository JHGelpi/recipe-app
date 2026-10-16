# 0007. Web-first delivery via Expo web

- **Status:** Accepted
- **Date:** 2026-10-12
- **Amends:** ADR-0002

## Context
ADR-0002 chose Expo for iOS and Android. Building for a real iPhone needs a paid Apple Developer membership, which the project does not have yet, and iOS builds cannot be made from the Windows/WSL development machine. The offline-first and tenancy architecture (FR-28, FR-30, NFR-1) still needs to be proven end to end now.

## Decision
Deliver **web first from the same Expo codebase**. Expo Router and React Native Web build the app as a single-page web app; the on-device database is SQLite in the browser through the PowerSync web SDK. Native iOS and Android become additional build targets later, not a rewrite. The local database sits behind one platform-specific module (`apps/mobile/src/db/database.web.ts`, with a native counterpart to come).

Sign-in is an **email one-time code**. A magic link opens in Safari, not in the home-screen app, and the two do not share a session on iOS.

Sync is defined with PowerSync **Sync Streams**.

New dependencies: `@powersync/web`, `@powersync/react`, Vitest, Playwright.

## Alternatives considered
- **Stay native, enrol in the Apple Developer Program now:** keeps the spec as written; costs $99 a year and blocks all device testing until approval.
- **Drop Expo for a plain web stack (Vite + React):** slightly simpler web tooling, but a later native app would mean rebuilding the UI. Kept as the fallback if PowerSync's web SDK had not worked under Expo.
- **Android only:** buildable locally, but the product owner's device is an iPhone.

## Consequences
- No store accounts, native builds, or dev client are needed to develop and test.
- FR-8's share-sheet import (sharing a URL into the app) is not possible in an iOS web app. Paste-a-link still works; share-sheet import becomes native-only.
- NFR-12 (store compliance, Sign in with Apple) applies only once a native build exists.
- Users should add the app to the home screen: Safari can clear storage for sites that go unused.
- The app must be served over HTTPS (or `localhost`) for browser storage to work, so trying it on a phone needs the hosted environment. That, a service worker for cold-start offline, and Safari-specific storage options are a follow-up sub-project.
- A role change takes effect only when the access token next refreshes (up to an hour). The roles and invites sub-project must handle this.
- An open sync stream does not fail when the network drops, so the app disconnects sync on the browser's `offline` event and reconnects on `online`, keeping local data and the upload queue. `useNetworkOnline` uses browser events only; native builds need NetInfo there.
