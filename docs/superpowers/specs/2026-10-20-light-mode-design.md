# Light mode: design

Date: 2026-10-20 · Status: approved in conversation, awaiting written review

## 1. Goal

Let each person choose how Dishkept looks: **System**, **Light** or **Dark**. Until now the app has been dark only (UI theme spec §1).

Success means:
- a light palette in which every text colour passes WCAG AA (4.5:1) on every background it is drawn on, as the dark palette already does;
- the choice is made on the Household screen and remembered on this device;
- System follows the phone or computer's setting, and changes live when that setting does;
- the page never flashes the wrong theme while it loads;
- screens don't change: they keep using `colors.*` from `src/theme` (ADR-0017), and no colour literals appear outside the theme.

### Decisions made with the owner
- **Choices:** System, Light, Dark. The default is System.
- **Scope:** each device remembers its own choice. It isn't synced, so there's no schema, RLS or sync-rule change.
- **Approach:** CSS variables. Each `colors.*` value becomes `var(--name)`, and the theme is switched on the page's root element.

### Out of scope
- **The iPhone status bar style:** it stays `black`, because iOS reads it only when the shortcut is added.
- **The web manifest's colours:** they stay dark. Browsers read them only at install.
- **A native (iOS/Android) theme:** native gets the dark palette until it has its own build (ADR-0007).
- **Colours of generated content** (the recipe PDF, share text): unchanged.

## 2. Palettes (`apps/mobile/src/theme/colors.ts`)

| Token | Dark (unchanged) | Light |
|---|---|---|
| `bg` | `#0E121A` | `#F6F7F9` |
| `surface` | `#1A1F2C` | `#FFFFFF` |
| `raised` | `#242A3A` | `#ECEFF4` |
| `line` | `#2A3142` | `#D3D9E3` |
| `accent` | `#00F5D4` | `#00756A` |
| `tag` | `#FF9F1C` | `#A85400` |
| `text` | `#F8F9FA` | `#0E121A` |
| `muted` | `#9AA3B5` | `#535C6E` |
| `danger` | `#FF6B6B` | `#C42B2B` |
| `onAccent` | `#0E121A` | `#FFFFFF` |
| `scrim` | `rgba(14, 18, 26, 0.72)` | `rgba(14, 18, 26, 0.48)` |
| `fade` | `rgba(14, 18, 26, 0)` | `rgba(246, 247, 249, 0)` |
| `shadow` | `#000000` | `#000000` |

In light mode the mint and amber are darker, because bright mint on white is about 1.3:1. The lowest light pair is `accent` on `raised`, at 4.86.

## 3. How the theme is applied

### `colors.ts`
- `palettes: { dark, light }` hold the hex values, with the same keys. `ColorName` is the key type.
- `colors` maps each name to `var(--<name>)` on web. On native it is `palettes.dark` (`Platform.OS`).
- `themeCss()` returns the stylesheet text:
  - `:root[data-theme="dark"]` and `:root[data-theme="light"]`, each declaring `--<name>: <value>;` for every token;
  - plus `color-scheme: dark` or `light` for each theme.
- `TEXT_PAIRS` is unchanged.

Every place that uses `colors.*` keeps working unchanged. react-native-web passes any string starting with `var(` straight through (`isWebColor`), including the ChipBar's `linear-gradient` and the `color=` props on icons and spinners.

### Theme choice (`apps/mobile/src/theme/appearance.ts`)
- `type Appearance = 'system' | 'light' | 'dark'` and `type Theme = 'light' | 'dark'`.
- `readAppearance(storage)` returns the saved choice from `localStorage['dishkept.appearance']`, or `'system'` when the value is missing or unknown.
- `resolveTheme(appearance, prefersDark: boolean): Theme`.
- `applyTheme(doc, theme)`:
  - sets `data-theme` on `<html>`;
  - sets `<meta name="theme-color">` to that palette's `bg`;
  - sets `<meta name="color-scheme">` to the theme.
- `useAppearance()` is a hook returning `{ appearance, setAppearance }`:
  - it saves the choice, then applies the resolved theme at once;
  - while the choice is System, it listens to `matchMedia('(prefers-color-scheme: dark)')` and re-applies the theme on change.

  The listener also has to run when the Household screen isn't open. So a small `<AppearanceSync />`, mounted once in the root layout, owns it. The hook only reads and writes the choice. Signed-out pages (sign-in, shared recipes, invites) use the same root layout, so they follow the choice too.
- The theme survives sign-out: the key isn't cleared with the session.

### Before the first paint (`apps/mobile/public/index.html`)
An inline script in `<head>`, written in plain ES5 and wrapped in `try`, runs before any CSS or JS bundle:
- it reads `dishkept.appearance` and resolves it with `matchMedia`;
- it sets `data-theme` on `<html>`, and falls back to `dark` if anything throws;
- it sets `theme-color` and `color-scheme` to match.

The inline style block declares only what's needed before the bundle loads:
- the page background for each theme: `html[data-theme="light"]` and `html[data-theme="dark"]`, each with that palette's `bg`;
- the focus outline as `var(--accent)`, with a fallback to the dark accent's hex.

At startup, the app adds `themeCss()` as a `<style id="dishkept-theme">` in `<head>`, once, before the first render (in the root layout module). From then on, the background is `var(--bg)`.

`index.html`'s hex values have to match `palettes`. A unit test reads the file and checks each one, so the two can't drift.

## 4. The setting (`HouseholdScreen.tsx`)

- An **Appearance** card, placed before Trash, holds a `PillTabs` with System · Light · Dark.
- Everyone sees it, viewers included: it's a device setting, not household data, so rule 4 doesn't apply.
- Choosing a tab switches the theme at once. There's no save button.

## 5. Docs

- **ADR-0020, "Light mode with CSS variables":** it covers the per-device choice, the variables, the pre-paint script, and native using dark for now. It amends ADR-0017's "dark only".
- **The UI theme spec §1:** a pointer to this spec beside "Dark only".
- **`docs/SPEC.md`:** NFR-11 becomes "Supports OS dynamic text size, VoiceOver/TalkBack, WCAG AA contrast in light and dark themes; the theme follows the device setting or the person's choice." Commits and tests cite NFR-11.

## 6. Testing

- **Unit (`apps/mobile/src/theme`):**
  - the contrast test runs every `TEXT_PAIRS` pair on both palettes;
  - both palettes have the same keys;
  - `themeCss()` declares every token for both themes;
  - `readAppearance` handles missing, unknown and valid values;
  - `resolveTheme` covers all six cases (three choices, each with the system dark and light);
  - `index.html`'s background, theme-color and fallback hex values match `palettes`.
- **e2e (Playwright, `e2e/appearance.spec.ts`):**
  - with `colorScheme: 'light'` emulated and no saved choice, the page loads light: `<html data-theme="light">`, and the body background is `rgb(246, 247, 249)`. With `'dark'` emulated, it loads dark;
  - on Household, choosing Dark switches the page at once. After a reload, it is still dark under an emulated light system;
  - choosing System, then changing the emulated scheme, switches the page live;
  - the theme is applied before the bundle runs: with the JS bundle blocked (`page.route` aborts `**/_expo/**/*.js`) and Light saved, `<html>` still gets `data-theme="light"` and the light background.
- No existing e2e test checks colours. Playwright emulates a light system by default, so the suite would start running light. To keep it running exactly as it does today, `playwright.config.ts` pins `colorScheme: 'dark'`, and `appearance.spec.ts` overrides it per test.
