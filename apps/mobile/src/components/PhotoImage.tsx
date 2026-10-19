import { Image, View, type ImageStyle } from 'react-native';
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Metro asset
const MARK = require('../../assets/brand/mark.png');
import { usePhotoUri } from '../photos/usePhotoUri';
import { colors } from '../theme';
import { Text } from '../ui';

/**
 * A household photo by id. While it cannot be shown it is a quiet grey box:
 * "Available when online" offline, blank when another device has not
 * uploaded it yet (Review Focus 5).
 */
export function PhotoImage({
  id,
  label,
  style,
  fit = 'cover',
  placeholder,
}: {
  id: string;
  label: string;
  style: ImageStyle;
  fit?: 'cover' | 'contain';
  /** "mark": the app mark while the photo is not on this device (list thumbnails). */
  placeholder?: 'mark';
}) {
  const view = usePhotoUri(id);
  // testIDs let end-to-end tests tell a loaded photo from its placeholder.
  if (view.state === 'ready' && view.uri) {
    // The wrapper owns the role, name and testID, as the placeholder does;
    // react-native-web's Image would put them on different elements.
    return (
      <View
        testID="photo-shown"
        role="img"
        aria-label={label}
        style={[style, { overflow: 'hidden' }]}
      >
        <Image
          source={{ uri: view.uri }}
          resizeMode={fit}
          style={{ width: '100%', height: '100%' }}
        />
      </View>
    );
  }
  if (placeholder === 'mark') {
    const side = typeof style.width === 'number' ? style.width : 64;
    return (
      <View
        testID="photo-placeholder"
        role="img"
        aria-label="Photo not downloaded yet"
        style={[
          style,
          { backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' },
        ]}
      >
        <Image source={MARK} style={{ width: side * 0.6, height: side * 0.6, opacity: 0.85 }} />
      </View>
    );
  }
  return (
    <View
      testID="photo-placeholder"
      role="img"
      aria-label={label}
      style={[
        style,
        { backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center' },
      ]}
    >
      {view.state === 'offline' ? (
        <Text variant="caption" tone="muted" style={{ textAlign: 'center' }}>
          Available when online
        </Text>
      ) : null}
    </View>
  );
}
