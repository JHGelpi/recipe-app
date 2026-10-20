import type { ColorName } from '../theme';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ChipTone = 'tag' | 'neutral' | 'selected';

type ButtonToken = { text: ColorName; background: ColorName | null; border: ColorName | null };

export const buttonTokens: Record<ButtonVariant, ButtonToken> = {
  primary: { text: 'onAccent', background: 'accent', border: null },
  secondary: { text: 'accent', background: null, border: 'accent' },
  ghost: { text: 'accent', background: null, border: null },
  danger: { text: 'danger', background: null, border: 'danger' },
};

export const chipTokens: Record<ChipTone, { text: ColorName; background: ColorName }> = {
  tag: { text: 'onAccent', background: 'tag' },
  neutral: { text: 'text', background: 'raised' },
  selected: { text: 'onAccent', background: 'accent' },
};

/** Segmented tabs: the chosen one is filled, as the tab bar's active tab is (final review 4). */
export const pillTabTokens: Record<
  'selected' | 'idle',
  // Text tones only: the label is a Text.
  { text: 'onAccent' | 'muted'; background: ColorName | null }
> = {
  selected: { text: 'onAccent', background: 'accent' },
  idle: { text: 'muted', background: null },
};
