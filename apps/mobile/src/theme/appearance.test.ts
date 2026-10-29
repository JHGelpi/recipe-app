import { describe, expect, it } from 'vitest';
import { applyTheme, installThemeCss, resolveTheme, THEME_STYLE_ID } from './appearance';
import { themeCss } from './palettes';

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
  const meta = {
    'theme-color': {} as Record<string, string>,
    'color-scheme': {} as Record<string, string>,
  };
  return {
    attributes,
    meta,
    documentElement: {
      setAttribute: (name: string, value: string) => void (attributes[name] = value),
    },
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
