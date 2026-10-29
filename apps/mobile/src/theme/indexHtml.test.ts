import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SETTINGS_CACHE_KEY } from '../settings/cache';
import { AUTH_STORAGE_KEY } from '../session/storageKey';
import { palettes, type Theme } from './palettes';

// index.html paints before the bundle loads, so it repeats a few palette values.
// Prettier writes its CSS with single quotes and lowercase hex.
const html = readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8');

describe('index.html before the bundle (light mode spec §3)', () => {
  it.each(['dark', 'light'] as Theme[])('paints the %s background from the palette', (theme) => {
    const rule = new RegExp(
      `html\\[data-theme=['"]${theme}['"]\\][^{]*\\{\\s*background-color:\\s*(#[0-9A-Fa-f]{6});`,
    );
    expect(html.match(rule)?.[1]?.toUpperCase()).toBe(palettes[theme].bg);
  });

  it('gives the script both backgrounds for the theme color', () => {
    const map = html.match(/\{ dark: '(#[0-9A-Fa-f]{6})', light: '(#[0-9A-Fa-f]{6})' \}/);
    expect([map?.[1], map?.[2]]).toEqual([palettes.dark.bg, palettes.light.bg]);
  });

  it('reads the keys the app saves to: the session and the person’s cached settings', () => {
    expect(html).toContain(`localStorage.getItem('${AUTH_STORAGE_KEY}')`);
    expect(html).toContain(`localStorage.getItem('${SETTINGS_CACHE_KEY}')`);
  });

  it('outlines focus with the theme accent, falling back to the dark one', () => {
    expect(
      html.match(/outline: 2px solid var\(--accent, (#[0-9A-Fa-f]{6})\)/)?.[1]?.toUpperCase(),
    ).toBe(palettes.dark.accent);
  });
});
