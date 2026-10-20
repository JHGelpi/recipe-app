import { palettes, themeCss, type Theme } from './palettes';

/** What the person chose on this device (light mode spec §3). */
export type Appearance = 'system' | 'light' | 'dark';

// index.html's pre-paint script reads the same key; keep them in step.
export const APPEARANCE_KEY = 'dishkept.appearance';
export const DARK_QUERY = '(prefers-color-scheme: dark)';
export const THEME_STYLE_ID = 'dishkept-theme';

export type AppearanceStore = Pick<Storage, 'getItem' | 'setItem'>;

/** localStorage, or undefined where the browser blocks it: even reading the property throws there. */
export function deviceStorage(): AppearanceStore | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

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
