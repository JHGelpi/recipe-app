# 0002. Cross-platform mobile with Expo / React Native

- **Status:** Proposed
- **Date:** 2026-10-12

## Context
v1 must ship on iOS and Android; desktop comes later. Needs camera, share-sheet intake, keep-awake, PDF generation, and a local SQLite database. Small team, so one codebase.

## Decision
Use **Expo (React Native) with TypeScript**, Expo Router for navigation, and EAS for builds, store submission, and over-the-air updates.

## Alternatives considered
- **Flutter:** excellent UI performance, but Dart splits the language from the TypeScript backend (Edge Functions), so domain code (scaling, unit conversion, recipe schema) couldn't be shared.
- **Native Swift + Kotlin:** best platform fit, double the work.
- **PWA only:** weak share-sheet intake on iOS, limited offline storage guarantees, no store presence.

## Consequences
- One language (TypeScript) across app and backend; shared `packages/domain` for the recipe schema, scaling, and units.
- Native modules require an Expo dev client rather than Expo Go.
- A desktop path exists (React Native Web or Tauri) but isn't free.
