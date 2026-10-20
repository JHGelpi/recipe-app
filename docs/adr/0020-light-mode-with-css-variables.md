# 0020. Light mode with CSS variables, chosen per device

- **Status:** Accepted
- **Date:** 2026-10-20

## Context

ADR-0017 made Dishkept dark only. The owner wants each person to choose System, Light or Dark, as they prefer. The design system already keeps every colour in `src/theme`, and 35 files read them as `colors.*`.

## Decision

1. **Two palettes** in `src/theme/palettes.ts`, with the same tokens. Every `TEXT_PAIRS` pair passes AA in both. Light mode's mint and amber are darker (`#00756A`, `#A85400`), because bright mint on white is unreadable.
2. **CSS variables on the web.** Each `colors.*` value is `var(--<name>)`, and react-native-web passes it through unchanged. A stylesheet built from the palettes gives the variables their values under `:root[data-theme="dark"|"light"]`. Switching the theme sets one attribute, and nothing re-renders.
3. **Chosen per device.** `localStorage['dishkept.appearance']` holds `system`, `light` or `dark`; System is the default. It isn't synced, and it survives signing out.
4. **No flash.** An inline script in `index.html` sets `data-theme`, the theme colour and the colour scheme before the first paint. Its few hex values are tied to the palettes by a unit test.
5. **Kept in step** by `AppearanceSync` in the root layout. It follows the system setting while the choice is System, and follows choices made in other tabs.
6. **Native** gets the dark palette as hex values until it has its own theme.

## Consequences

- Screens don't change, and a new screen gets both themes for free.
- Colours that leave the page (the manifest, the iOS status bar, the PDF) stay dark.
- `colors.*` values on the web are strings like `var(--bg)`, not hex. Code that needs a real colour value uses `palettes`.

## Alternatives considered

- **A React theme context:** every styled component would re-render on a switch, and all 35 files would change.
- **Synced per person:** a schema, RLS and sync-rule change for a preference that is usually about the device and the room's light.
