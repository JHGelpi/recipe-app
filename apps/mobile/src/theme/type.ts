// Until the bundled fonts load (or if they never do), the system font shows,
// never the browser's serif default (Review Focus 3).
const FALLBACK = ', system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export const fonts = {
  heading: `Outfit_600SemiBold${FALLBACK}`,
  body: `PlusJakartaSans_400Regular${FALLBACK}`,
  medium: `PlusJakartaSans_500Medium${FALLBACK}`,
  bold: `PlusJakartaSans_700Bold${FALLBACK}`,
} as const;

export const type = {
  h1: { fontFamily: fonts.heading, fontSize: 28, lineHeight: 34 },
  h2: { fontFamily: fonts.heading, fontSize: 20, lineHeight: 26 },
  h3: { fontFamily: fonts.heading, fontSize: 17, lineHeight: 22 },
  body: { fontFamily: fonts.body, fontSize: 16, lineHeight: 24 },
  small: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20 },
  caption: { fontFamily: fonts.body, fontSize: 12, lineHeight: 16 },
  label: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 20 },
} as const;

export type TypeVariant = keyof typeof type;
