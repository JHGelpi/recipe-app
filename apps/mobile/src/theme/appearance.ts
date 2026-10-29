import { palettes, themeCss, type Theme } from './palettes';

/** What the person chose, saved to them (light mode spec §3, ADR-0031). */
export type Appearance = 'system' | 'light' | 'dark';

export const DARK_QUERY = '(prefers-color-scheme: dark)';
export const THEME_STYLE_ID = 'dishkept-theme';

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
