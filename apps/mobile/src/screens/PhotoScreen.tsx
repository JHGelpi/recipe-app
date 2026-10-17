import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { PhotoImage } from '../components/PhotoImage';

/** A photo full size; the browser's pinch-zoom works on it. */
export function PhotoScreen({ id }: { id: string }) {
  return (
    <View style={{ flex: 1, padding: 16, gap: 12 }}>
      <Pressable
        role="button"
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      >
        <Text style={{ textDecorationLine: 'underline' }}>Back</Text>
      </Pressable>
      <PhotoImage
        id={id}
        label="Photo"
        fit="contain"
        style={{ width: '100%', flex: 1, minHeight: 320 }}
      />
    </View>
  );
}
