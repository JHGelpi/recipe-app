// The Dishkept palette (UI spec §2). The only place colors are written.
export const colors = {
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
  shadow: '#000000',
} as const;

export type ColorName = keyof typeof colors;

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
