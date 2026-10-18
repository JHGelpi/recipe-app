# Dishkept look and feel: design

Date: 2026-10-17 · Status: approved in conversation, awaiting written review

## 1. Goal

Give the app the look of the owner's theme board (`apps/mobile/assets/ui/app_theme.jpg`) and examples (`Example1–4`), use `app_icon.png` as the app icon, and rename the app **Dishkept** ("Keep Your Kitchen Inspired").

Success means:
- every screen uses one shared theme and set of building blocks, with no colors written directly in screens;
- people move around with a bottom tab bar, as in Example 1 and the board's phone;
- the home-screen icon, browser tab, sign-in screen, PDF and share text say Dishkept;
- nothing the app does changes: offline rules, role checks, data and addresses stay as they are, and the existing end-to-end suite still passes, with updates only where navigation moved.

### Decisions made with the owner
- **Rename** to Dishkept. The list heading stays "Recipes".
- **Bottom tab bar** (Recipes · Favorites · raised **+** · Household). Trash and Sign out move into Household.
- **Recipe list:** rows with thumbnails, not big photo cards.
- **Approach:** a small design system of our own (a theme plus about ten building blocks). No UI kit.
- **Dark only.** No light mode in this sub-project.
- **Icon:** crop the supplied 400 px `app_icon.png`; a larger original can replace it later.

### Out of scope
- Light mode, or following the system setting.
- New features, or changes to what any screen does.
- Native (iOS/Android) builds; this stays web first (ADR-0007).
- Animations beyond press feedback and the "+" sheet sliding up.

## 2. Theme (`apps/mobile/src/theme/`)

### Colors
| Token | Value | Use |
|---|---|---|
| `bg` | `#0E121A` Dark Slate | screen background |
| `surface` | `#1A1F2C` Muted Indigo | cards, inputs, list rows |
| `raised` | `#242A3A` | tab bar, pressed states, sheet |
| `line` | `#2A3142` | hairline borders, dividers |
| `accent` | `#00F5D4` Mint Glow | primary buttons, links, active tab, focus ring |
| `tag` | `#FF9F1C` Amber | tag chips, warnings |
| `text` | `#F8F9FA` Off-White | main text |
| `muted` | `#9AA3B5` | subtitles, times, placeholders |
| `danger` | `#FF6B6B` | errors, destructive actions |
| `onAccent` | `#0E121A` | text on mint or amber |

Rules:
- every text and background pair the theme defines meets WCAG AA (4.5:1 for body text, 3:1 for large text and icons), checked by a unit test;
- mint and amber backgrounds carry `onAccent` text, never white;
- focus is always visible: a 2 px mint ring on keyboard focus.

### Type
- **Headings: Outfit** (600). Sizes `h1` 28, `h2` 20, `h3` 17.
- **Body and UI: Plus Jakarta Sans** (400 and 500). Sizes `body` 16, `small` 14, `caption` 12. Cook mode keeps its large step text, at 24 or more.
- Fonts are bundled with the app (`@expo-google-fonts/outfit`, `@expo-google-fonts/plus-jakarta-sans`, loaded with `expo-font`), so the service worker precaches them and they work offline. Nothing is loaded from Google's servers.
- The app never waits for fonts: text shows in the system font until they load.

### Shape and spacing
- Spacing steps of 4: `xs` 4, `sm` 8, `md` 12, `lg` 16, `xl` 24.
- Radii: `card` 16, `field` 12, `pill` 999.
- Raised items (cards in lists, the "+" button, the sheet) get one soft shadow.
- Every tap target is at least 44 × 44.

### Icons
`@expo/vector-icons`, Ionicons only, bundled like the fonts. Used in the tab bar, icon buttons, time and serving meta, banners and the back arrow.

## 3. Building blocks (`apps/mobile/src/ui/`)

Each one is a thin component over React Native primitives and the theme, and keeps the accessibility roles the screens use today.

| Block | What it is |
|---|---|
| `Screen` | Dark background, safe-area padding, scrolls. Optional title bar with a back arrow (an icon button with the name the old link had, e.g. "All recipes"). |
| `Card` | Indigo rounded panel, with an optional heading. |
| `Button` | Pill. `primary` (mint, `onAccent` text), `secondary` (outlined), `danger` (coral). Optional icon. Disabled at 40% opacity with `aria-disabled`. |
| `IconButton` | Round, 44 px, an icon with a required accessible name. |
| `PillTabs` | Segmented tabs (Example 4), `role="tab"` with `aria-selected`. |
| `Chip` | `tag` (amber), `neutral` (indigo with a line border), `selected` (mint). Pressable when given `onPress`. |
| `TextField` | Label above, indigo field, mint focus ring, error text in coral below. |
| `ListRow` | Card row: optional thumbnail or icon, title, muted subtitle, optional chips and a trailing chevron or actions. |
| `Banner` | Indigo strip with a mint, amber or coral icon, for the status, notice and update banners. |
| `TabBar` | §4. |
| `Thumb` | A recipe's dish photo, square and rounded, or the placeholder: the app mark on `surface`. |

A lint rule rejects color literals (`#…`, `rgb(…)`, `rgba(…)`) in `apps/mobile/src` and `apps/mobile/app`, except in `src/theme/`.

## 4. Navigation

### Tab bar
Shown on signed-in screens: the list, Favorites, recipe, edit, new, import, review import, Household and Trash.

| Item | Accessible name | Goes to |
|---|---|---|
| Recipes | "Recipes" | `/` |
| Favorites | "Favorites" | `/favorites` (new route) |
| **+** (raised mint circle) | "Add a recipe", or "Add a recipe, N imports ready" | opens the sheet |
| Household | "Household" | `/household` |

- The items are links, and the current one is marked `aria-current="page"`.
- **The sheet:** a bottom sheet over a dimmed screen, holding **New recipe** and **Import** buttons. Import keeps its "Import, N ready" name and count. It closes on Escape, a tap outside, or a choice. Viewers, who can't add recipes, don't get the **+**.
- **Hidden** in cook mode, the photo viewer, sign-in, the invite page and the shared page `/s/<code>`.
- **No address changes:** every existing address stays. `/favorites` is the one new address. It shows the list filtered to favorites and replaces the list's All / Favorites switch.

### Household
Adds two rows at the end:
- **Trash**, for Admins and Members only, as today;
- **Sign out**, a secondary button.

## 5. Screens

- **Sign-in:** the icon (96 px), "Dishkept" in Outfit `h1`, the tagline in `muted`, then one `Card` with the email and code fields and a primary button. The build footer stays at the bottom in `caption`.
- **Recipes (`/`) and Favorites (`/favorites`):**
  - `h1` heading ("Recipes" or "Favorites");
  - the status line ("Online · 0 unsynced") in `small` `muted`;
  - a search pill (`TextField` with a search icon and the existing clear button);
  - the tag filters as horizontally scrolling `Chip`s;
  - then a `ListRow` per recipe: `Thumb`, title, the first tag as an amber chip, and total time (prep + cook) with a clock icon when known;
  - the empty-state and "No recipes match" text, unchanged.
- **Recipe:**
  - back arrow ("All recipes");
  - the dish photo full width (16 radius), or the add-photo control as today;
  - the title in `h1` with the star `IconButton`;
  - meta chips: Serves · Prep · Cook;
  - an action row with a primary **Cook** button and icon buttons for **Share** and **Edit**;
  - a "⋯" `IconButton` ("More") holding Move to Trash or Restore;
  - `Card`s for Ingredients (with the servings bar), Steps, Notes, Source and Shared links;
  - the Trash alert as a `Banner`.
- **Cook mode:**
  - full-screen `bg`;
  - step text at 24 or more;
  - a mint progress bar ("Step 3 of 7");
  - Back and Next as large pill buttons pinned to the bottom;
  - ingredients and substitutions in a `Card`;
  - no tab bar.
- **Edit, New, Import, Review import:** form `Card`s with `TextField`s; the main action is a full-width primary button; errors appear as `Banner`s.
- **Household:**
  - members as `ListRow`s with a role `Chip`;
  - an invites `Card`, and rename in a `Card`;
  - Leave and Invite a friend as secondary buttons;
  - then Trash and Sign out (§4).
- **Trash:** `ListRow`s with Restore.
- **Invite page:** a `Card` with the preview and the Join primary button.
- **Shared page (`/s/<code>`):**
  - a small header with the icon and "Dishkept";
  - then the recipe in `Card`s;
  - the **Save to my recipes** primary button, or the "already in your household" `Banner`;
  - no tab bar.
- **Photo viewer:** black background, close `IconButton`.
- **Banners** for offline, update ready, the household notice and the saved flash, all using `Banner`.

## 6. Icon, name and manifest

- **Icon files:**
  - Crop `app_icon.png` to its navy rounded square: the supplied file includes the board's gradient and a stray "P" at the top right.
  - Fill the corners with `#0E121A` so it's full-bleed. iOS and Android round the corners themselves.
  - Generate:
    - `public/icons/apple-touch-icon.png` (180);
    - `icon-192.png`, `icon-512.png`;
    - `icon-maskable-512.png`, with the mark inside the central 80% safe zone on `#0E121A`;
    - `favicon.png` (48);
    - `assets/brand/mark.png` (the in-app logo).
  - The script lives in `scripts/` so a larger original can be dropped in and rerun. 512 px will be slightly soft, upscaled from about 360 px of real icon.
- **Manifest:** `name` and `short_name` become "Dishkept", the description becomes "Keep Your Kitchen Inspired", and `background_color` and `theme_color` become `#0E121A`.
- **`index.html`:**
  - `<title>` Dishkept;
  - `theme-color` `#0E121A`;
  - `apple-mobile-web-app-title` Dishkept;
  - the status-bar style becomes `black-translucent`;
  - `color-scheme: dark`.
- **`app.json`:** `name` Dishkept, `userInterfaceStyle` `dark`, and the icon pointed at the generated 1024 px square.
- **Text:** the PDF footer becomes "Shared from Dishkept". The install hint and any other user-facing "Recipes" app name become "Dishkept".

## 7. Performance and offline

- Fonts and the icon font are separate files, precached by the service worker like the PDF chunk. The app's first screen does not wait for them.
- The entry bundle grows by at most 40 KB (theme, building blocks and the tab bar); measured as in sub-project 7.

## 8. Testing

- **Unit:**
  - the theme's contrast pairs pass AA (a `contrast()` helper in `src/theme`, with its own tests);
  - the tab bar's item list for each role (a Viewer gets no **+**);
  - the sheet's Import label with a ready count.
- **Lint:** the no-color-literal rule passes on the whole app.
- **End to end:**
  - the existing suite passes;
  - steps that used the old list links change: "Household" and "Trash" links become the tab bar and the Household row, the All / Favorites tabs become the Recipes and Favorites tab-bar links, "New recipe" and "Import" are reached through **+**, and Sign out through Household;
  - new tests:
    - the tab bar is on the list and recipe screens and absent in cook mode and on a signed-out shared page;
    - **+** offers New recipe and Import, and a Viewer has no **+**;
    - `/favorites` lists only starred recipes;
    - the manifest says Dishkept and its icons load.
- **Screenshots:** Playwright captures each main screen at 390 × 844 for the owner to look over before the PR (not compared automatically).

## 9. Docs

- **ADR-0017:** the design system, the font and icon dependencies, dark only, and the rename.
- **ARCHITECTURE:** the "Navigation & Screens" component gains the tab bar and the `ui`/`theme` layer.
- **SPEC:** a note that the app is named Dishkept.
- **CLAUDE.md:** a convention line: screens use `src/ui` and `src/theme`, with no color literals.
