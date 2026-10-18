// The font files, apart from the rest of the theme: requiring .ttf assets
// only works in the app bundle, not in unit tests.
// One file per weight: the packages' main entries would bundle all 23.
import { Outfit_600SemiBold } from '@expo-google-fonts/outfit/600SemiBold';
import { PlusJakartaSans_400Regular } from '@expo-google-fonts/plus-jakarta-sans/400Regular';
import { PlusJakartaSans_500Medium } from '@expo-google-fonts/plus-jakarta-sans/500Medium';
import { PlusJakartaSans_700Bold } from '@expo-google-fonts/plus-jakarta-sans/700Bold';

/** The font files `useFonts` loads; the layout adds the icon font beside them. */
export const FONT_FILES = {
  Outfit_600SemiBold,
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_700Bold,
};
