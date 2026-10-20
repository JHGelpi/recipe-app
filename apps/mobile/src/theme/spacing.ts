import { colors } from './colors';

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
export const radius = { card: 16, field: 12, pill: 999 } as const;

/** The one soft shadow for raised items (cards in lists, "+", the sheet). */
export const shadow = {
  shadowColor: colors.shadow,
  // The softness is in the color (palettes.ts).
  shadowOpacity: 1,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 8 },
} as const;
