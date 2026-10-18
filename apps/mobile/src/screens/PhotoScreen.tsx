import { router } from 'expo-router';
import { View } from 'react-native';
import { PhotoImage } from '../components/PhotoImage';
import { colors, space } from '../theme';
import { Button } from '../ui';

/** A photo full size; the browser's pinch-zoom works on it. */
export function PhotoScreen({ id }: { id: string }) {
  return (
    <View style={{ flex: 1, padding: space.lg, gap: space.md, backgroundColor: colors.bg }}>
      <Button
        variant="ghost"
        icon="chevron-back"
        label="Back"
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      />
      <PhotoImage
        id={id}
        label="Photo"
        fit="contain"
        style={{ width: '100%', flex: 1, minHeight: 320 }}
      />
    </View>
  );
}
