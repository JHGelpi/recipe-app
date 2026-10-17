import { Image, Text, View, type ImageStyle } from 'react-native';
import { usePhotoUri } from '../photos/usePhotoUri';

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
}: {
  id: string;
  label: string;
  style: ImageStyle;
  fit?: 'cover' | 'contain';
}) {
  const view = usePhotoUri(id);
  // testIDs let end-to-end tests tell a loaded photo from its placeholder.
  if (view.state === 'ready' && view.uri) {
    return (
      <Image
        testID="photo-shown"
        source={{ uri: view.uri }}
        accessibilityLabel={label}
        resizeMode={fit}
        style={style}
      />
    );
  }
  return (
    <View
      testID="photo-placeholder"
      role="img"
      aria-label={label}
      style={[style, { backgroundColor: '#eee', alignItems: 'center', justifyContent: 'center' }]}
    >
      {view.state === 'offline' ? (
        <Text style={{ color: '#666', fontSize: 12, textAlign: 'center' }}>
          Available when online
        </Text>
      ) : null}
    </View>
  );
}
