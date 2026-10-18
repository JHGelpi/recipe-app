import { router } from 'expo-router';
import { useEffect } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { colors, radius, shadow, space } from '../theme';
import { Button, Text } from '../ui';
import { importLabel } from './tabs';

/** "+" in the tab bar: New recipe or Import (UI spec §4). */
export function AddSheet({
  open,
  ready,
  onClose,
}: {
  open: boolean;
  ready: number;
  onClose: () => void;
}) {
  // react-native-web's Modal does not report Escape: listen while open (Review Focus 4).
  useEffect(() => {
    if (!open || typeof window === 'undefined') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  const go = (path: '/recipe/new' | '/import') => {
    onClose();
    router.push(path);
  };
  return (
    // onRequestClose: the Android back button, when this runs natively.
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable
          role="button"
          aria-label="Close"
          onPress={onClose}
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            backgroundColor: colors.scrim,
          }}
        />
        <View
          role="dialog"
          aria-label="Add a recipe"
          style={{
            backgroundColor: colors.raised,
            borderTopLeftRadius: radius.card,
            borderTopRightRadius: radius.card,
            padding: space.xl,
            gap: space.md,
            width: '100%',
            maxWidth: 640,
            alignSelf: 'center',
            ...shadow,
          }}
        >
          <Text variant="h2">Add a recipe</Text>
          <Button full icon="create-outline" label="New recipe" onPress={() => go('/recipe/new')} />
          <Button
            full
            variant="secondary"
            icon="camera-outline"
            label={ready > 0 ? `Import · ${ready} ready` : 'Import'}
            aria-label={importLabel(ready)}
            onPress={() => go('/import')}
          />
        </View>
      </View>
    </Modal>
  );
}
