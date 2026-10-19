// Until the bundled fonts load (or if they never do), the system font shows,
// never the browser's serif default (Review Focus 3), at each variant's own
// weight (index.html turns off faux bold over the single-weight fonts).
const FALLBACK = ', system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export const fonts = {
  heading: `Outfit_600SemiBold${FALLBACK}`,
  body: `PlusJakartaSans_400Regular${FALLBACK}`,
  medium: `PlusJakartaSans_500Medium${FALLBACK}`,
  bold: `PlusJakartaSans_700Bold${FALLBACK}`,
} as const;

export const type = {
  h1: { fontFamily: fonts.heading, fontSize: 28, lineHeight: 34, fontWeight: '600' },
  h2: { fontFamily: fonts.heading, fontSize: 20, lineHeight: 26, fontWeight: '600' },
  h3: { fontFamily: fonts.heading, fontSize: 17, lineHeight: 22, fontWeight: '600' },
  body: { fontFamily: fonts.body, fontSize: 16, lineHeight: 24, fontWeight: '400' },
  small: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, fontWeight: '400' },
  caption: { fontFamily: fonts.body, fontSize: 12, lineHeight: 16, fontWeight: '400' },
  label: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 20, fontWeight: '500' },
} as const;

export type TypeVariant = keyof typeof type;
