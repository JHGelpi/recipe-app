import { useEffect, useRef, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, View, type ViewInstance } from 'react-native';
import { colors, radius, shadow, space } from '../theme';

/** A sheet over a dimmed screen; closes on Escape or a tap outside (as AddSheet). */
export function BottomSheet({
  open,
  label,
  onClose,
  children,
}: {
  open: boolean;
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  // react-native-web's Modal does not report Escape: listen while open.
  useEffect(() => {
    if (!open || typeof window === 'undefined') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  // react-native-web's Modal keeps focus inside once it is there but doesn't
  // move it in: a screen reader would stay on the page behind (NFR-11).
  const dialog = useRef<ViewInstance>(null);
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => (dialog.current as HTMLElement | null)?.focus?.());
    return () => cancelAnimationFrame(frame);
  }, [open]);
  return (
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
          ref={dialog}
          role="dialog"
          aria-label={label}
          aria-modal
          tabIndex={-1}
          style={{
            backgroundColor: colors.raised,
            borderTopLeftRadius: radius.card,
            borderTopRightRadius: radius.card,
            width: '100%',
            maxWidth: 640,
            maxHeight: '85%',
            alignSelf: 'center',
            ...shadow,
          }}
        >
          <ScrollView contentContainerStyle={{ padding: space.xl, gap: space.md }}>
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
