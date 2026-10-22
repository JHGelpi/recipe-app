import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, useWindowDimensions, View } from 'react-native';
import { PhotoImage } from '../components/PhotoImage';
import { useEntryPhotos } from '../cooklog/hooks';
import { colors, space } from '../theme';
import { Button, Text } from '../ui';

/** FR-39: an entry's photos full screen; swipe, or Previous and Next. */
export function CookPhotosScreen({ entryId, start }: { entryId: string; start: number }) {
  const photos = useEntryPhotos(entryId);
  const { width } = useWindowDimensions();
  const ref = useRef<ScrollView>(null);
  const [at, setAt] = useState(start);
  const shown = Math.min(Math.max(at, 0), Math.max(photos.length - 1, 0));

  // Opens on the tapped photo once the list and the width are known.
  useEffect(() => {
    ref.current?.scrollTo({ x: shown * width, animated: false });
    // Only when the photos or the width change, not on every swipe.
  }, [photos.length, width]);

  const go = (index: number) => {
    setAt(index);
    ref.current?.scrollTo({ x: index * width, animated: true });
  };
  const back = () => (router.canGoBack() ? router.back() : router.replace(`/diary/${entryId}`));

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View
        style={{ flexDirection: 'row', alignItems: 'center', padding: space.lg, gap: space.md }}
      >
        <Button variant="ghost" icon="chevron-back" label="Back" onPress={back} />
        {photos.length > 0 ? (
          <Text tone="muted" role="status">{`${shown + 1} of ${photos.length}`}</Text>
        ) : null}
      </View>
      <ScrollView
        ref={ref}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(event) =>
          setAt(Math.round(event.nativeEvent.contentOffset.x / Math.max(width, 1)))
        }
        onScroll={(event) =>
          setAt(Math.round(event.nativeEvent.contentOffset.x / Math.max(width, 1)))
        }
        scrollEventThrottle={100}
        style={{ flex: 1 }}
      >
        {photos.map((id, index) => (
          <View key={id} style={{ width, padding: space.lg }}>
            <PhotoImage
              id={id}
              label={`Photo ${index + 1} of ${photos.length}`}
              fit="contain"
              style={{ width: '100%', flex: 1, minHeight: 320 }}
            />
          </View>
        ))}
      </ScrollView>
      {photos.length > 1 ? (
        <View style={{ flexDirection: 'row', gap: space.md, padding: space.lg }}>
          <View style={{ flex: 1 }}>
            <Button
              full
              variant="secondary"
              label="Previous"
              disabled={shown === 0}
              onPress={() => go(shown - 1)}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              full
              variant="secondary"
              label="Next"
              disabled={shown === photos.length - 1}
              onPress={() => go(shown + 1)}
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}
