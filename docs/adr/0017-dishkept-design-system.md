# 17. Dishkept: a small design system of our own, dark only

Date: 2026-10-17 · Status: Accepted

## Context

The app had no shared styles: each screen wrote its own colors, and it looked like a prototype. The owner supplied a theme board (Dishkept: Dark Slate, Muted Indigo, Mint Glow, Amber, Off-White; Outfit and Plus Jakarta Sans), an icon and examples with rounded dark cards, pill tabs and a bottom tab bar.

## Decision

- **Theme tokens** in `apps/mobile/src/theme` (colors, type, spacing). Every text and background pair is tested for WCAG AA.
- **About ten building blocks** in `apps/mobile/src/ui` (Text, Button, IconButton, Card, Chip, PillTabs, TextField, RowCard, Banner, Thumb, Screen). Screens use only these.
- **A lint rule** rejects color literals outside `src/theme`, and `react-native` `Text` and `TextInput` outside `src/ui`.
- **A bottom tab bar** (Recipes, Favorites, +, Household) rendered by the root layout. Favorites is its own route, `/favorites`.
- **Fonts** (`@expo-google-fonts/outfit`, `@expo-google-fonts/plus-jakarta-sans`) and an Ionicons subset (`@expo/vector-icons`) are bundled and precached. The app never waits for them.
- **Dark only.** The app is named **Dishkept**. Icons are generated from the owner's artwork by `pnpm icons:make`.

## Alternatives considered

- **A UI kit** (React Native Paper, Tamagui, NativeWind): its own look to override, and a much bigger dependency for a web-first offline app.
- **Recoloring in place:** dark screens that still look like the prototype, and drift apart again.
- **Fonts from Google's CDN:** they break offline.

## Consequences

- New screens are built from `src/ui`. A new look means changing tokens and blocks, not screens.
- A light mode later means a second token set and a switch, with no screen changes.
- Bundled fonts and the icon font add about 0.7 MB to the precache (not the entry bundle).
