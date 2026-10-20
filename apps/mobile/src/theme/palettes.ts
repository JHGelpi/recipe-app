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
