import { useSyncExternalStore } from 'react';
import { View } from 'react-native';
import { colors, space } from '../theme';
import { Banner, Button } from '../ui';
import { applyUpdate, subscribeUpdate, updateReady } from './serviceWorker';

/** Offers the new version; never reloads by itself, so typing is not lost. */
export function UpdateBanner() {
  const ready = useSyncExternalStore(subscribeUpdate, updateReady, () => false);
  if (!ready) return null;
  return (
    <View style={{ padding: space.sm, backgroundColor: colors.bg }}>
      <Banner action={<Button variant="ghost" label="Reload" onPress={applyUpdate} />}>
        A new version is ready.
      </Banner>
    </View>
  );
}
