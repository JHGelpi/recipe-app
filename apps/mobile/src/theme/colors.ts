import { colorVariables, palettes, type ColorName } from './palettes';

export {
  colorVariables,
  palettes,
  TEXT_PAIRS,
  themeCss,
  type ColorName,
  type Theme,
} from './palettes';

// On the web each color is a CSS variable, so switching the theme needs no re-render
// (ADR-0020). With no page (native until it has its own theme, and unit tests) it is
// the dark palette. Not Platform.OS: importing react-native would break the unit tests.
export const colors: Record<ColorName, string> =
  typeof document !== 'undefined' ? colorVariables : palettes.dark;
