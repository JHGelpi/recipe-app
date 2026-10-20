# Light mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** People choose System, Light or Dark on the Household screen; each device remembers its choice, and the page never flashes the wrong theme.

**Architecture:** On the web, every `colors.*` value becomes `var(--name)`. A stylesheet built from the two palettes declares the variables under `:root[data-theme="dark"|"light"]`. An inline script in `index.html` sets `data-theme` before the first paint. The app then installs the stylesheet and keeps the theme in step with the saved choice, other tabs, and the system setting.

**Tech Stack:** Expo / React Native Web 0.21 (passes `var(...)` colours through), React 19 `useSyncExternalStore`, Vitest (node environment), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-20-light-mode-design.md`

## Global Constraints

- Colours are written only in `apps/mobile/src/theme/palettes.ts`, plus the few pre-paint hex values in `apps/mobile/public/index.html`, which a unit test ties to `palettes` (ADR-0017; spec §3).
- Every pair in `TEXT_PAIRS` passes 4.5:1 in both palettes (NFR-11).
- The storage key is `dishkept.appearance`, and its values are `system`, `light` and `dark`. Missing or unknown values mean `system`. Signing out doesn't clear it.
- The choices are labelled exactly `System`, `Light` and `Dark`, in that order, in a card titled `Appearance`, placed before Trash. Everyone sees it, viewers included.
- No schema, RLS or sync-rule change: the choice is stored on the device only.
- **Out of scope** (leave unchanged):
  - the manifest's colours;
  - `apple-mobile-web-app-status-bar-style`;
  - the PDF and share text.
- Native and unit tests get the dark palette as hex values. Web gets the variables.
- Commits follow Conventional Commits, cite NFR-11, and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Before `pnpm lint`:** run `rm -rf .vitest`.
- **After any `pnpm test:e2e` run:** run `pnpm dev:backend`, then `docker compose restart sync`.
- **Never** run `pnpm db:reset`.

## Review Focus

1. **Storage that throws** (Safari private mode, or blocked cookies). The app still loads, in the system theme. Choosing a theme still switches the page for this visit. Owned by Task 2 (`readAppearance`/`saveAppearance` tests).
2. **A stored value from elsewhere** (`"blue"`, an empty string, or `"Light"` with a capital). It's treated as System, not as dark and not as a crash. Owned by Task 2, plus Task 3's script (it only accepts the exact `light` and `dark`).
3. **Two tabs open.** Choosing in one switches the other without a reload. Owned by Task 4 (the e2e "every open tab" test).
4. **Signing out, or a session that expires.** The choice survives, so the sign-in page keeps the chosen theme. Owned by Task 4 (the e2e sign-out check).
5. **Meta tags missing** (an `index.html` edited later, or a page without them). `applyTheme` must not throw, and the theme still switches. Owned by Task 2 (the `applyTheme` test with no meta tags).

---

## File structure

| File | Responsibility |
|---|---|
| `apps/mobile/src/theme/palettes.ts` (new) | Both palettes (the only hex values), `ColorName`, `Theme`, `TEXT_PAIRS`, `colorVariables`, `themeCss()`. Pure, so unit tests import it. |
| `apps/mobile/src/theme/colors.ts` | `colors`: the variables on web, the dark palette elsewhere. Re-exports from `palettes.ts`. |
| `apps/mobile/src/theme/appearance.ts` (new) | Pure helpers: `Appearance`, the key, `readAppearance`, `saveAppearance`, `resolveTheme`, `applyTheme`, `installThemeCss`, `systemPrefersDark`. |
| `apps/mobile/src/theme/useAppearance.ts` (new) | The page's current choice. `useAppearance()` for the setting, `AppearanceSync` for the listeners. |
| `apps/mobile/public/index.html` | The pre-paint script, a background per theme, and the focus outline as `var(--accent)`. |
| `apps/mobile/app/_layout.tsx` | Installs the theme CSS once at module load and mounts `<AppearanceSync />`. |
| `apps/mobile/src/screens/HouseholdScreen.tsx` | The Appearance card. |
| `playwright.config.ts` | Pins `colorScheme: 'dark'` for the existing suite. |
| `e2e/appearance.spec.ts` (new) | First load, the pre-paint script, the setting, other tabs, sign-out. |
| Docs | ADR-0020, the ADR index, an ADR-0017 note, the UI theme spec pointer, SPEC NFR-11. |

---

### Task 1: Two palettes, and colours as CSS variables

**Files:**
- Create: `apps/mobile/src/theme/palettes.ts`
- Modify: `apps/mobile/src/theme/colors.ts` (whole file)
- Modify: `apps/mobile/src/theme/index.ts`
- Modify: `apps/mobile/src/theme/contrast.test.ts`
- Modify: `apps/mobile/src/ui/variants.test.ts`
- Create: `apps/mobile/src/theme/palettes.test.ts`

**Interfaces:**
- Produces:
  - `palettes: Record<Theme, Record<ColorName, string>>`;
  - `type ColorName` (the token names, as before);
  - `type Theme = 'dark' | 'light'`;
  - `TEXT_PAIRS` (unchanged);
  - `colorVariables: Record<ColorName, string>` (`var(--<name>)`);
  - `themeCss(): string`;
  - `colors: Record<ColorName, string>`.

  All are exported from `src/theme` (index.ts).

- [ ] **Step 1: Write the failing tests**

Replace `apps/mobile/src/theme/contrast.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import { contrast } from './contrast';
import { palettes, TEXT_PAIRS, type Theme } from './palettes';

describe('contrast (WCAG 2)', () => {
  it('is 21 for black on white and 1 for a color on itself', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 1);
    expect(contrast('#FFFFFF', '#000000')).toBeCloseTo(21, 1);
    expect(contrast('#1A1F2C', '#1A1F2C')).toBeCloseTo(1, 5);
  });

  describe.each(['dark', 'light'] as Theme[])('the %s palette (NFR-11)', (theme) => {
    it.each(TEXT_PAIRS)('%s text on %s passes AA (4.5:1)', (text, background) => {
      expect(contrast(palettes[theme][text], palettes[theme][background])).toBeGreaterThanOrEqual(
        4.5,
      );
    });
  });
});
```

Create `apps/mobile/src/theme/palettes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { colors } from './colors';
import { colorVariables, palettes, themeCss, type ColorName } from './palettes';

const names = Object.keys(palettes.dark) as ColorName[];

describe('palettes (light mode spec §2)', () => {
  it('give both themes the same tokens', () => {
    expect(Object.keys(palettes.light).sort()).toEqual([...names].sort());
  });

  it('keep the dark palette as it was', () => {
    expect(palettes.dark).toMatchObject({ bg: '#0E121A', accent: '#00F5D4', text: '#F8F9FA' });
  });

  it('name each token as a CSS variable', () => {
    for (const name of names) expect(colorVariables[name]).toBe(`var(--${name})`);
  });

  it('declare every token for both themes in the theme stylesheet', () => {
    const css = themeCss();
    for (const theme of ['dark', 'light'] as const) {
      const block = css.match(new RegExp(`:root\\[data-theme="${theme}"\\] \\{([^}]*)\\}`))?.[1];
      expect(block, theme).toBeDefined();
      expect(block).toContain(`color-scheme: ${theme};`);
      for (const name of names) expect(block).toContain(`--${name}: ${palettes[theme][name]};`);
    }
  });

  it('are the dark hex values where there is no page (native, unit tests)', () => {
    expect(colors).toEqual(palettes.dark);
  });
});
```

In `apps/mobile/src/ui/variants.test.ts`, run every check on both palettes. Replace the file with:

```ts
import { describe, expect, it } from 'vitest';
import { contrast, palettes, type Theme } from '../theme';
import { buttonTokens, chipTokens } from './variants';

// A variant with no fill sits on whatever is behind it: any of these.
const UNDERLAYS = ['bg', 'surface', 'raised'] as const;

describe.each(['dark', 'light'] as Theme[])('variant colors pass AA in %s (UI spec §2)', (theme) => {
  const colors = palettes[theme];

  it.each(Object.entries(buttonTokens))('button %s', (_, token) => {
    for (const under of token.background ? [token.background] : UNDERLAYS) {
      expect(contrast(colors[token.text], colors[under])).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(Object.entries(chipTokens))('chip %s', (_, token) => {
    expect(contrast(colors[token.text], colors[token.background])).toBeGreaterThanOrEqual(4.5);
  });
});

it('accent and tag fills carry onAccent text, which each palette picks to suit them', () => {
  for (const token of [...Object.values(buttonTokens), ...Object.values(chipTokens)]) {
    if (token.background === 'accent' || token.background === 'tag') {
      expect(token.text).toBe('onAccent');
    }
  }
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run apps/mobile/src/theme apps/mobile/src/ui/variants.test.ts`
Expected: FAIL, with "Failed to resolve import './palettes'" (and `palettes` is not exported from `../theme`).

- [ ] **Step 3: Write the palettes**

Create `apps/mobile/src/theme/palettes.ts`:

```ts
// The Dishkept palettes (UI spec §2, light mode spec §2). The only place colors are written,
// apart from index.html's few pre-paint values, which a test ties to these.
const dark = {
  bg: '#0E121A',
  surface: '#1A1F2C',
  raised: '#242A3A',
  line: '#2A3142',
  accent: '#00F5D4',
  tag: '#FF9F1C',
  text: '#F8F9FA',
  muted: '#9AA3B5',
  danger: '#FF6B6B',
  onAccent: '#0E121A',
  // Behind sheets; not a text color.
  scrim: 'rgba(14, 18, 26, 0.72)',
  // The tag bar's edge fade: the background, fully transparent.
  fade: 'rgba(14, 18, 26, 0)',
  shadow: '#000000',
} as const;

export type ColorName = keyof typeof dark;
export type Theme = 'dark' | 'light';

// Mint and amber are darker here: bright mint on white is about 1.3:1.
const light: Record<ColorName, string> = {
  bg: '#F6F7F9',
  surface: '#FFFFFF',
  raised: '#ECEFF4',
  line: '#D3D9E3',
  accent: '#00756A',
  tag: '#A85400',
  text: '#0E121A',
  muted: '#535C6E',
  danger: '#C42B2B',
  onAccent: '#FFFFFF',
  scrim: 'rgba(14, 18, 26, 0.48)',
  fade: 'rgba(246, 247, 249, 0)',
  shadow: '#000000',
};

export const palettes: Record<Theme, Record<ColorName, string>> = { dark, light };

const names = Object.keys(dark) as ColorName[];

/** Each token as the CSS variable that carries it on the web (ADR-0020). */
export const colorVariables = Object.fromEntries(
  names.map((name) => [name, `var(--${name})`]),
) as Record<ColorName, string>;

/** The stylesheet that gives the variables their values under each theme. */
export function themeCss(): string {
  return (Object.keys(palettes) as Theme[])
    .map((theme) => {
      const values = names.map((name) => `--${name}: ${palettes[theme][name]};`).join(' ');
      return `:root[data-theme="${theme}"] { color-scheme: ${theme}; ${values} }`;
    })
    .join('\n');
}

/** Every text color the app draws on every background it draws it on. */
export const TEXT_PAIRS: readonly [ColorName, ColorName][] = [
  ['text', 'bg'],
  ['text', 'surface'],
  ['text', 'raised'],
  ['muted', 'bg'],
  ['muted', 'surface'],
  ['muted', 'raised'],
  ['accent', 'bg'],
  ['accent', 'surface'],
  ['accent', 'raised'],
  ['tag', 'bg'],
  ['tag', 'surface'],
  ['danger', 'bg'],
  ['danger', 'surface'],
  ['danger', 'raised'],
  ['onAccent', 'accent'],
  ['onAccent', 'tag'],
];
```

Replace `apps/mobile/src/theme/colors.ts` with:

```ts
import { colorVariables, palettes, type ColorName } from './palettes';

export {
  colorVariables,
  palettes,
  TEXT_PAIRS,
  themeCss,
  type ColorName,
  type Theme,
} from './palettes';

// On the web each color is a CSS variable, so switching the theme needs no re-render
// (ADR-0020). With no page (native until it has its own theme, and unit tests) it is
// the dark palette. Not Platform.OS: importing react-native would break the unit tests.
export const colors: Record<ColorName, string> =
  typeof document !== 'undefined' ? colorVariables : palettes.dark;
```

In `apps/mobile/src/theme/index.ts`, replace the first line with:

```ts
export {
  colors,
  colorVariables,
  palettes,
  TEXT_PAIRS,
  themeCss,
  type ColorName,
  type Theme,
} from './colors';
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `pnpm vitest run apps/mobile/src/theme apps/mobile/src/ui/variants.test.ts && pnpm typecheck`
Expected: PASS: 16 pairs × 2 themes, plus the palette and variant tests. Typecheck is clean. If typecheck fails because a caller relied on `colors` being a literal `as const` type, widen that caller's type to `string`, and ledger it as a ruling.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/theme apps/mobile/src/ui/variants.test.ts
git commit -m "feat(theme): a light palette beside the dark one, and colors as CSS variables on the web (NFR-11)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Reading, resolving and applying the choice

**Files:**
- Create: `apps/mobile/src/theme/appearance.ts`
- Create: `apps/mobile/src/theme/appearance.test.ts`

**Interfaces:**
- Consumes: `palettes`, `themeCss`, `type Theme` from `./palettes`.
- Produces:
  - `type Appearance = 'system' | 'light' | 'dark'`;
  - `APPEARANCE_KEY = 'dishkept.appearance'`;
  - `DARK_QUERY = '(prefers-color-scheme: dark)'`;
  - `THEME_STYLE_ID = 'dishkept-theme'`;
  - `readAppearance(storage: AppearanceStore | undefined): Appearance`;
  - `saveAppearance(storage: AppearanceStore | undefined, appearance: Appearance): boolean`;
  - `resolveTheme(appearance: Appearance, prefersDark: boolean): Theme`;
  - `applyTheme(doc: ThemeDocument, theme: Theme): void`;
  - `installThemeCss(doc: Document): void`;
  - `systemPrefersDark(): boolean`.

- [ ] **Step 1: Write the failing tests**

Create `apps/mobile/src/theme/appearance.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  applyTheme,
  installThemeCss,
  readAppearance,
  resolveTheme,
  saveAppearance,
  THEME_STYLE_ID,
  type Appearance,
} from './appearance';
import { themeCss } from './palettes';

function memoryStore(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

const throwing = {
  getItem: (): string | null => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
};

describe('readAppearance (light mode spec §3)', () => {
  it.each(['system', 'light', 'dark'] as Appearance[])('reads a saved %s', (saved) => {
    expect(readAppearance(memoryStore({ 'dishkept.appearance': saved }))).toBe(saved);
  });

  it.each([undefined, '', 'blue', 'Light'])('treats %j as System', (saved) => {
    const store = memoryStore(saved === undefined ? {} : { 'dishkept.appearance': saved });
    expect(readAppearance(store)).toBe('system');
  });

  it('is System when there is no storage, or reading it throws (Review Focus 1)', () => {
    expect(readAppearance(undefined)).toBe('system');
    expect(readAppearance(throwing)).toBe('system');
  });
});

describe('saveAppearance', () => {
  it('saves under dishkept.appearance', () => {
    const store = memoryStore();
    expect(saveAppearance(store, 'light')).toBe(true);
    expect(store.values.get('dishkept.appearance')).toBe('light');
  });

  it('reports false, without throwing, when storage refuses (Review Focus 1)', () => {
    expect(saveAppearance(throwing, 'dark')).toBe(false);
    expect(saveAppearance(undefined, 'dark')).toBe(false);
  });
});

describe('resolveTheme', () => {
  it.each([
    ['system', true, 'dark'],
    ['system', false, 'light'],
    ['light', true, 'light'],
    ['light', false, 'light'],
    ['dark', true, 'dark'],
    ['dark', false, 'dark'],
  ] as const)('%s with a dark system %s is %s', (appearance, prefersDark, theme) => {
    expect(resolveTheme(appearance, prefersDark)).toBe(theme);
  });
});

function fakeDocument(withMeta: boolean) {
  const attributes: Record<string, string> = {};
  const meta = { 'theme-color': {} as Record<string, string>, 'color-scheme': {} as Record<string, string> };
  return {
    attributes,
    meta,
    documentElement: { setAttribute: (name: string, value: string) => void (attributes[name] = value) },
    querySelector: (selector: string) => {
      const name = selector.match(/name="([^"]+)"/)?.[1] as keyof typeof meta | undefined;
      if (!withMeta || !name) return null;
      return { setAttribute: (attr: string, value: string) => void (meta[name][attr] = value) };
    },
  };
}

describe('applyTheme', () => {
  it('sets data-theme, the theme color and the color scheme', () => {
    const doc = fakeDocument(true);
    applyTheme(doc, 'light');
    expect(doc.attributes['data-theme']).toBe('light');
    expect(doc.meta['theme-color'].content).toBe('#F6F7F9');
    expect(doc.meta['color-scheme'].content).toBe('light');
  });

  it('still sets data-theme when the meta tags are missing (Review Focus 5)', () => {
    const doc = fakeDocument(false);
    expect(() => applyTheme(doc, 'dark')).not.toThrow();
    expect(doc.attributes['data-theme']).toBe('dark');
  });
});

describe('installThemeCss', () => {
  it('adds the theme stylesheet to <head> once', () => {
    const added: { id: string; textContent: string }[] = [];
    const doc = {
      getElementById: (id: string) => added.find((style) => style.id === id) ?? null,
      createElement: () => ({ id: '', textContent: '' }),
      head: { appendChild: (style: { id: string; textContent: string }) => void added.push(style) },
    } as unknown as Document;
    installThemeCss(doc);
    installThemeCss(doc);
    expect(added).toEqual([{ id: THEME_STYLE_ID, textContent: themeCss() }]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run apps/mobile/src/theme/appearance.test.ts`
Expected: FAIL with "Failed to resolve import './appearance'".

- [ ] **Step 3: Write the helpers**

Create `apps/mobile/src/theme/appearance.ts`:

```ts
import { palettes, themeCss, type Theme } from './palettes';

/** What the person chose on this device (light mode spec §3). */
export type Appearance = 'system' | 'light' | 'dark';

// index.html's pre-paint script reads the same key; keep them in step.
export const APPEARANCE_KEY = 'dishkept.appearance';
export const DARK_QUERY = '(prefers-color-scheme: dark)';
export const THEME_STYLE_ID = 'dishkept-theme';

export type AppearanceStore = Pick<Storage, 'getItem' | 'setItem'>;

/** The saved choice; System when none is saved, it is unknown, or storage can't be read. */
export function readAppearance(storage: AppearanceStore | undefined): Appearance {
  try {
    const saved = storage?.getItem(APPEARANCE_KEY);
    return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system';
  } catch {
    // Safari's private mode and blocked storage throw here.
    return 'system';
  }
}

/** Saves the choice; false when storage refuses, and then it lasts until the page reloads. */
export function saveAppearance(
  storage: AppearanceStore | undefined,
  appearance: Appearance,
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(APPEARANCE_KEY, appearance);
    return true;
  } catch {
    return false;
  }
}

export function resolveTheme(appearance: Appearance, prefersDark: boolean): Theme {
  if (appearance !== 'system') return appearance;
  return prefersDark ? 'dark' : 'light';
}

/** Dark when the browser can't say, as the app looked before light mode. */
export function systemPrefersDark(): boolean {
  return globalThis.matchMedia?.(DARK_QUERY).matches ?? true;
}

type Attributes = { setAttribute(name: string, value: string): void };
export type ThemeDocument = {
  documentElement: Attributes;
  querySelector(selector: string): Attributes | null;
};

/** Switches the page: the variables follow data-theme, and the browser's own chrome follows the metas. */
export function applyTheme(doc: ThemeDocument, theme: Theme): void {
  doc.documentElement.setAttribute('data-theme', theme);
  doc.querySelector('meta[name="theme-color"]')?.setAttribute('content', palettes[theme].bg);
  doc.querySelector('meta[name="color-scheme"]')?.setAttribute('content', theme);
}

/** Gives the color variables their values; index.html only carries the pre-paint few. */
export function installThemeCss(doc: Document): void {
  if (doc.getElementById(THEME_STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = THEME_STYLE_ID;
  style.textContent = themeCss();
  doc.head.appendChild(style);
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run apps/mobile/src/theme && pnpm typecheck`
Expected: PASS. Typecheck is clean.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/theme/appearance.ts apps/mobile/src/theme/appearance.test.ts
git commit -m "feat(theme): read, save, resolve and apply the device's appearance choice (NFR-11)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The right theme before the first paint

**Files:**
- Modify: `apps/mobile/public/index.html` (head: after the `color-scheme` meta, and the `expo-reset` style)
- Create: `apps/mobile/src/theme/indexHtml.test.ts`
- Modify: `playwright.config.ts` (`use`)
- Create: `e2e/appearance.spec.ts`

**Interfaces:**
- Consumes: `palettes` (Task 1); `APPEARANCE_KEY` (Task 2; the script repeats the literal `dishkept.appearance`).
- Produces:
  - `<html data-theme="dark|light">` set before the bundle runs;
  - `look(page)` and `cssBg(page)`, helpers inside `e2e/appearance.spec.ts` that Task 4 extends.

- [ ] **Step 1: Write the failing unit test**

Create `apps/mobile/src/theme/indexHtml.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APPEARANCE_KEY } from './appearance';
import { palettes, type Theme } from './palettes';

// index.html paints before the bundle loads, so it repeats a few palette values.
const html = readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8');

describe('index.html before the bundle (light mode spec §3)', () => {
  it.each(['dark', 'light'] as Theme[])('paints the %s background from the palette', (theme) => {
    const rule = new RegExp(
      `html\\[data-theme="${theme}"\\][^{]*\\{\\s*background-color:\\s*(#[0-9A-Fa-f]{6});`,
    );
    expect(html.match(rule)?.[1]?.toUpperCase()).toBe(palettes[theme].bg);
  });

  it('gives the script both backgrounds for the theme color', () => {
    const map = html.match(/\{ dark: '(#[0-9A-Fa-f]{6})', light: '(#[0-9A-Fa-f]{6})' \}/);
    expect([map?.[1], map?.[2]]).toEqual([palettes.dark.bg, palettes.light.bg]);
  });

  it('reads the key the app saves to', () => {
    expect(html).toContain(`localStorage.getItem('${APPEARANCE_KEY}')`);
  });

  it('outlines focus with the theme accent, falling back to the dark one', () => {
    expect(html.match(/outline: 2px solid var\(--accent, (#[0-9A-Fa-f]{6})\)/)?.[1]).toBe(
      palettes.dark.accent,
    );
  });
});
```

- [ ] **Step 2: Write the failing e2e tests**

Create `e2e/appearance.spec.ts`:

```ts
import { expect, test, type Page } from './fixtures';

const LIGHT_BG = 'rgb(246, 247, 249)';
const DARK_BG = 'rgb(14, 18, 26)';

/** The page's theme as the browser sees it. */
async function look(page: Page) {
  return page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    background: getComputedStyle(document.body).backgroundColor,
    themeColor: document.querySelector('meta[name="theme-color"]')?.getAttribute('content'),
  }));
}

const LIGHT = { theme: 'light', background: LIGHT_BG, themeColor: '#F6F7F9' };
const DARK = { theme: 'dark', background: DARK_BG, themeColor: '#0E121A' };

test.describe('under a light system setting', () => {
  test.use({ colorScheme: 'light' });

  test('with nothing chosen, the page loads light (NFR-11)', async ({ page }) => {
    await page.goto('/');
    expect(await look(page)).toEqual(LIGHT);
  });
});

test.describe('under a dark system setting', () => {
  test.use({ colorScheme: 'dark' });

  test('with nothing chosen, the page loads dark (NFR-11)', async ({ page }) => {
    await page.goto('/');
    expect(await look(page)).toEqual(DARK);
  });

  test('a saved Light is painted before the app’s code runs', async ({ page, context }) => {
    await context.addInitScript(() => localStorage.setItem('dishkept.appearance', 'light'));
    // With the bundle blocked, only index.html's own script can set the theme.
    await page.route('**/_expo/static/js/**', (route) => route.abort());
    await page.goto('/');
    expect(await look(page)).toEqual(LIGHT);
  });

  test('an unknown saved value is treated as System (Review Focus 2)', async ({ page, context }) => {
    await context.addInitScript(() => localStorage.setItem('dishkept.appearance', 'Light'));
    await page.route('**/_expo/static/js/**', (route) => route.abort());
    await page.goto('/');
    expect(await look(page)).toEqual(DARK);
  });
});
```

In `playwright.config.ts`, add to the top-level `use` block, after `baseURL`:

```ts
    // The suite was written against the dark theme; light mode has its own spec
    // (appearance.spec.ts), which sets the scheme per test.
    colorScheme: 'dark',
```

- [ ] **Step 3: Run them to see them fail**

Run: `pnpm vitest run apps/mobile/src/theme/indexHtml.test.ts`
Expected: FAIL. No `html[data-theme=...]` rule, no `{ dark: ..., light: ... }` map, no `getItem`, and the outline is `#00f5d4` with no `var(`.

Run: `pnpm test:e2e e2e/appearance.spec.ts`
Expected: FAIL. `theme` is `undefined` in every test, and the light tests get the dark background.

- [ ] **Step 4: Write the pre-paint script and styles**

In `apps/mobile/public/index.html`, directly after `<meta name="color-scheme" content="dark" />`, insert:

```html
    <!-- The saved appearance, or the system's, before anything paints (ADR-0020).
         Plain ES5; the app keeps it in step from here (src/theme/useAppearance.ts). -->
    <script>
      (function () {
        var theme = 'dark';
        try {
          var saved = localStorage.getItem('dishkept.appearance');
          if (saved === 'light' || saved === 'dark') theme = saved;
          else theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        } catch (e) {}
        document.documentElement.setAttribute('data-theme', theme);
        var bg = { dark: '#0E121A', light: '#F6F7F9' }[theme];
        var themeColor = document.querySelector('meta[name="theme-color"]');
        if (themeColor) themeColor.setAttribute('content', bg);
        var scheme = document.querySelector('meta[name="color-scheme"]');
        if (scheme) scheme.setAttribute('content', theme);
      })();
    </script>
```

In the `expo-reset` style, replace:

```css
      /* The theme's background, so no white shows before the app draws. */
      html,
      body {
        background-color: #0e121a;
      }
      /* Keyboard focus is always visible: the theme's mint (UI spec §2). */
      :focus-visible {
        outline: 2px solid #00f5d4;
        outline-offset: 2px;
      }
```

with:

```css
      /* The theme's background, so nothing else shows before the app draws.
         The values match src/theme/palettes.ts (indexHtml.test.ts). */
      html[data-theme="dark"],
      html[data-theme="dark"] body {
        background-color: #0E121A;
      }
      html[data-theme="light"],
      html[data-theme="light"] body {
        background-color: #F6F7F9;
      }
      /* Keyboard focus is always visible: the theme's accent (UI spec §2). */
      :focus-visible {
        outline: 2px solid var(--accent, #00F5D4);
        outline-offset: 2px;
      }
```

Then run `pnpm exec prettier --write apps/mobile/public/index.html`. Re-run the unit test after it: if prettier reflows the script's `{ dark: ..., light: ... }` map or changes the hex case, update the test's pattern rather than fighting the formatter, and ledger it as a ruling.

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run apps/mobile/src/theme/indexHtml.test.ts`
Expected: PASS (5 tests).

Run: `pnpm test:e2e e2e/appearance.spec.ts e2e/install.spec.ts`
Expected: PASS. That's the 4 appearance tests, plus the install tests: the `theme-color` meta is still a single tag.

Then run `pnpm dev:backend && docker compose restart sync`.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/public/index.html apps/mobile/src/theme/indexHtml.test.ts playwright.config.ts e2e/appearance.spec.ts
git commit -m "feat(web): the saved or system theme is set before the first paint (NFR-11)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The Appearance setting, kept in step everywhere

**Files:**
- Create: `apps/mobile/src/theme/useAppearance.ts`
- Modify: `apps/mobile/src/theme/index.ts`
- Modify: `apps/mobile/app/_layout.tsx`
- Modify: `apps/mobile/src/screens/HouseholdScreen.tsx` (before the Trash `RowCard`, around line 349)
- Modify: `e2e/appearance.spec.ts`

**Interfaces:**
- Consumes: from Task 2, `readAppearance`, `saveAppearance`, `resolveTheme`, `applyTheme`, `installThemeCss`, `systemPrefersDark`, `APPEARANCE_KEY`, `DARK_QUERY`, `type Appearance`. From Task 3, `look()` in the e2e file.
- Produces:
  - `useAppearance(): { appearance: Appearance; setAppearance(next: Appearance): void }`;
  - `AppearanceSync(): null`;
  - `installTheme(): void` (installs the CSS and applies the current theme; it does nothing without `document`).

- [ ] **Step 1: Write the failing e2e tests**

Append to `e2e/appearance.spec.ts` (and change its imports to add `freshEmail` and `signIn` from `./helpers`):

```ts
/** The app's own colors resolve through the installed variables. */
async function cssBg(page: Page) {
  return page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
  );
}

async function openAppearance(page: Page) {
  await page.getByRole('link', { name: 'Household' }).click();
  await expect(page.getByText('Appearance')).toBeVisible();
}

test.describe('the Appearance setting', () => {
  test.use({ colorScheme: 'light' });

  test('Dark is kept after a reload and after signing out (NFR-11, Review Focus 4)', async ({
    page,
  }) => {
    await signIn(page, freshEmail('appearance'));
    await openAppearance(page);
    await expect(page.getByRole('tab', { name: 'System' })).toHaveAttribute('aria-selected', 'true');
    expect(await cssBg(page)).toBe('#F6F7F9');

    await page.getByRole('tab', { name: 'Dark' }).click();
    await expect.poll(() => look(page)).toEqual(DARK);
    expect(await cssBg(page)).toBe('#0E121A');

    await page.reload();
    await expect(page.getByRole('tab', { name: 'Dark' })).toHaveAttribute('aria-selected', 'true');
    expect(await look(page)).toEqual(DARK);

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByLabel('Email')).toBeVisible();
    expect(await look(page)).toEqual(DARK);
  });

  test('a choice reaches every open tab, and System follows the device live (Review Focus 3)', async ({
    page,
    context,
  }) => {
    await signIn(page, freshEmail('appearance-tabs'));
    const other = await context.newPage();
    await other.goto('/');
    await expect.poll(() => look(other)).toEqual(LIGHT);

    await openAppearance(page);
    await page.getByRole('tab', { name: 'Dark' }).click();
    await expect.poll(() => look(other)).toEqual(DARK);

    await page.getByRole('tab', { name: 'System' }).click();
    await expect.poll(() => look(other)).toEqual(LIGHT);
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect.poll(() => look(page)).toEqual(DARK);
    await other.close();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm test:e2e e2e/appearance.spec.ts`
Expected: the 4 Task 3 tests PASS. The 2 new ones FAIL, waiting for the text "Appearance".

- [ ] **Step 3: Write the runtime**

Create `apps/mobile/src/theme/useAppearance.ts`:

```ts
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import {
  APPEARANCE_KEY,
  applyTheme,
  DARK_QUERY,
  installThemeCss,
  readAppearance,
  resolveTheme,
  saveAppearance,
  systemPrefersDark,
  type Appearance,
} from './appearance';

const store = () => globalThis.localStorage as Storage | undefined;

// The page's current choice. Held here too, so a choice storage refused still lasts the visit.
let current: Appearance | undefined;
const listeners = new Set<() => void>();

function appearanceNow(): Appearance {
  return (current ??= readAppearance(store()));
}

function apply(): void {
  if (typeof document === 'undefined') return;
  applyTheme(document, resolveTheme(appearanceNow(), systemPrefersDark()));
}

function choose(next: Appearance): void {
  current = next;
  apply();
  listeners.forEach((listener) => listener());
}

/** Installs the color variables and applies the current theme, once, before the first render. */
export function installTheme(): void {
  if (typeof document === 'undefined') return;
  installThemeCss(document);
  apply();
}

/** The setting on the Household screen: the device's choice, saved at once. */
export function useAppearance(): { appearance: Appearance; setAppearance(next: Appearance): void } {
  const appearance = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    appearanceNow,
    appearanceNow,
  );
  const setAppearance = useCallback((next: Appearance) => {
    saveAppearance(store(), next);
    choose(next);
  }, []);
  return { appearance, setAppearance };
}

/** Mounted once in the root layout: follows the system setting and choices made in other tabs. */
export function AppearanceSync(): null {
  useEffect(() => {
    const media = globalThis.matchMedia?.(DARK_QUERY);
    const onSystem = () => apply();
    const onStorage = (event: StorageEvent) => {
      if (event.key === APPEARANCE_KEY) choose(readAppearance(store()));
    };
    media?.addEventListener('change', onSystem);
    globalThis.addEventListener?.('storage', onStorage);
    return () => {
      media?.removeEventListener('change', onSystem);
      globalThis.removeEventListener?.('storage', onStorage);
    };
  }, []);
  return null;
}
```

In `apps/mobile/src/theme/index.ts`, add:

```ts
export { type Appearance } from './appearance';
export { AppearanceSync, installTheme, useAppearance } from './useAppearance';
```

In `apps/mobile/app/_layout.tsx`:
- change the theme import to `import { AppearanceSync, colors, installTheme } from '../src/theme';`;
- after the imports, add:

```ts
// The color variables must exist before anything renders with them (ADR-0020).
installTheme();
```

- inside `<SessionProvider>`, before `<DatabaseProvider>`, add `<AppearanceSync />`.

In `apps/mobile/src/screens/HouseholdScreen.tsx`:
- add `PillTabs` to the `../ui` import;
- add `useAppearance` and `type Appearance` to the `../theme` import;
- after the imports, add:

```ts
const APPEARANCE_TABS: readonly { value: Appearance; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];
```

- in the component body, next to the other hooks, add `const { appearance, setAppearance } = useAppearance();`;
- directly before `{canWrite(claims.role) ? (` for the Trash `RowCard`, add:

```tsx
      {/* A device setting, not household data, so viewers have it too (rule 4 doesn't apply). */}
      <Card title="Appearance">
        <PillTabs tabs={APPEARANCE_TABS} value={appearance} onChange={setAppearance} />
      </Card>
```

- [ ] **Step 4: Run the tests**

Run: `pnpm typecheck && pnpm vitest run apps/mobile/src`
Expected: PASS.

Run: `pnpm test:e2e e2e/appearance.spec.ts e2e/household.spec.ts e2e/look.spec.ts`
Expected: PASS (6 appearance tests, plus household and look).

Then run `pnpm dev:backend && docker compose restart sync`.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/theme apps/mobile/app/_layout.tsx apps/mobile/src/screens/HouseholdScreen.tsx e2e/appearance.spec.ts
git commit -m "feat(household): choose System, Light or Dark; every tab and the system setting follow (NFR-11)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Docs, and the whole suite

**Files:**
- Create: `docs/adr/0020-light-mode-with-css-variables.md`
- Modify: `docs/adr/README.md` (the index table)
- Modify: `docs/adr/0017-dishkept-design-system.md` (under its `**Dark only.**` decision line)
- Modify: `docs/superpowers/specs/2026-10-17-ui-theme-design.md` (the `**Dark only.**` line in §1)
- Modify: `docs/SPEC.md` (the NFR-11 row)

- [ ] **Step 1: Write ADR-0020**

Create `docs/adr/0020-light-mode-with-css-variables.md`:

```markdown
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
```

- [ ] **Step 2: Update the index, ADR-0017, the UI spec and SPEC**

In `docs/adr/README.md`, after the 0019 row, add:

```markdown
| [0020](0020-light-mode-with-css-variables.md) | Light mode with CSS variables, chosen per device | Accepted |
```

In `docs/adr/0017-dishkept-design-system.md`, directly after the line that starts `- **Dark only.**`, add:

```markdown
  - Amended by [ADR-0020](0020-light-mode-with-css-variables.md): a light palette and a System · Light · Dark choice per device.
```

In `docs/superpowers/specs/2026-10-17-ui-theme-design.md`, change `- **Dark only.** No light mode in this sub-project.` to:

```markdown
- **Dark only.** No light mode in this sub-project. Light mode came later: `2026-10-20-light-mode-design.md`.
```

In `docs/SPEC.md`, replace the NFR-11 row with:

```markdown
| NFR-11 | Accessibility | Supports OS dynamic text size, VoiceOver/TalkBack, WCAG AA contrast in light and dark themes; the theme follows the device setting or the person's choice (ADR-0020). |
```

- [ ] **Step 3: Lint, and run the whole suite**

Run: `rm -rf .vitest && pnpm lint && pnpm typecheck && pnpm test`
Expected: all pass. The unit count grows by the new theme tests.

Run: `pnpm test:e2e`
Expected: everything passes: 113 passed and 1 skipped before, plus the 6 appearance tests. Then run `pnpm dev:backend && docker compose restart sync`.

- [ ] **Step 4: Commit**

```bash
git add docs/adr/0020-light-mode-with-css-variables.md docs/adr/README.md docs/adr/0017-dishkept-design-system.md docs/superpowers/specs/2026-10-17-ui-theme-design.md docs/SPEC.md
git commit -m "docs: ADR-0020 light mode with CSS variables; NFR-11 covers both themes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
