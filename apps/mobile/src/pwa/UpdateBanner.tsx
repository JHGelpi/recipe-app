import { useSyncExternalStore } from 'react';
import { Pressable, Text, View } from 'react-native';
import { applyUpdate, subscribeUpdate, updateReady } from './serviceWorker';

/** Offers the new version; never reloads by itself, so typing is not lost. */
export function UpdateBanner() {
  const ready = useSyncExternalStore(subscribeUpdate, updateReady, () => false);
  if (!ready) return null;
  return (
    <View
      role="status"
      style={{
        backgroundColor: '#1a5d3a',
        padding: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <Text style={{ color: '#fff', flex: 1 }}>A new version is ready.</Text>
      <Pressable role="button" onPress={applyUpdate}>
        <Text style={{ color: '#fff', fontWeight: '600', textDecorationLine: 'underline' }}>
          Reload
        </Text>
      </Pressable>
    </View>
  );
}
