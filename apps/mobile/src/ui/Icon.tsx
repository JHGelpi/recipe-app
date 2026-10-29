import createIconSet from '@expo/vector-icons/createIconSet';
import { colors } from '../theme';

// A subset of Ionicons: the full glyph map is ~35 KB of JavaScript, and the
// app uses these few (UI spec §7). Code points from glyphmaps/Ionicons.json.
const GLYPHS = {
  add: 61699,
  'alert-circle-outline': 61716,
  book: 61861,
  'book-outline': 61862,
  'calendar-outline': 61910,
  'camera-outline': 61916,
  cart: 61954,
  'cart-outline': 61955,
  'chatbubble-ellipses-outline': 61971,
  'checkmark-circle': 61982,
  'checkmark-circle-outline': 61983,
  checkmark: 61981,
  'chevron-back': 61993,
  'chevron-down': 62002,
  'chevron-forward': 62011,
  close: 62026,
  'create-outline': 62099,
  'document-text-outline': 62132,
  'ellipse-outline': 62156,
  'ellipsis-horizontal': 62158,
  'eye-outline': 62186,
  heart: 62314,
  'heart-outline': 62327,
  'images-outline': 62354,
  'journal-outline': 62369,
  'link-outline': 62393,
  'log-out-outline': 62417,
  'logo-github': 62451,
  'open-outline': 62600,
  people: 62623,
  'people-outline': 62627,
  'refresh-outline': 62744,
  remove: 62752,
  'restaurant-outline': 62774,
  search: 62815,
  'share-outline': 62834,
  'sparkles-outline': 62861,
  star: 62869,
  'star-outline': 62873,
  'time-outline': 62942,
  'trash-outline': 62966,
} as const;

// eslint-disable-next-line @typescript-eslint/no-require-imports -- Metro asset
export const IONICONS_FONT = require('@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Ionicons.ttf');

const Ionicons = createIconSet(GLYPHS, 'ionicons', IONICONS_FONT);

export type IconName = keyof typeof GLYPHS;

/** A decorative icon; the control around it carries the name. */
export function Icon({
  name,
  size = 22,
  color = colors.text,
}: {
  name: IconName;
  size?: number;
  color?: string;
}) {
  return <Ionicons name={name} size={size} color={color} aria-hidden />;
}
