import { Image, View } from 'react-native';
import { colors, radius } from '../theme';
import { PhotoImage } from './PhotoImage';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- Metro asset
const MARK = require('../../assets/brand/mark.png');

/**
 * A recipe's dish photo, or the app mark when it has none. The mark is
 * decorative: screen readers hear only the recipe's title (Review Focus 5).
 */
export function Thumb({
  photoId,
  label,
  size = 64,
}: {
  photoId: string | null;
  label: string;
  size?: number;
}) {
  const box = { width: size, height: size, borderRadius: radius.field };
  if (photoId) return <PhotoImage id={photoId} label={label} style={box} />;
  return (
    <View
      testID="thumb-placeholder"
      aria-hidden
      style={[
        box,
        { backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' },
      ]}
    >
      <Image source={MARK} style={{ width: size * 0.6, height: size * 0.6, opacity: 0.85 }} />
    </View>
  );
}
