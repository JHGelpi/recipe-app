import { describe, expect, it } from 'vitest';
import {
  applyTheme,
  deviceStorage,
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

describe('deviceStorage (final review 2)', () => {
  it('is undefined, not a throw, when the browser blocks storage', () => {
    const before = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError');
      },
    });
    try {
      expect(deviceStorage()).toBeUndefined();
    } finally {
      if (before) Object.defineProperty(globalThis, 'localStorage', before);
      else delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });
});
