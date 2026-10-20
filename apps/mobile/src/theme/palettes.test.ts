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
