// apps/mobile/src/ui/ChipBar.tsx
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, ScrollView, View, type ViewStyle } from 'react-native';
import { colors, space } from '../theme';
import { chipBarEdges, chipBarPage } from './chipBarScroll';
import { IconButton } from './IconButton';

type Size = { offset: number; viewport: number; content: number };

// Web only: react-native-web passes CSS gradients through; ViewStyle has no type for them.
const fade = (to: 'left' | 'right') =>
  ({
    backgroundImage: `linear-gradient(to ${to}, ${colors.fade}, ${colors.bg})`,
  }) as unknown as ViewStyle;

/**
 * A sideways row of chips (bug batch spec §2). It scrolls by touch, the
 * keyboard, ‹ › buttons at an end with chips hidden past it, and on web a
 * vertical mouse wheel, so it works where swiping does not.
 */
export function ChipBar({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<ScrollView>(null);
  const [size, setSize] = useState<Size>({ offset: 0, viewport: 0, content: 0 });
  const edges = chipBarEdges(size.offset, size.viewport, size.content);

  // A vertical wheel scrolls the bar sideways while it overflows (web).
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = (
      ref.current as unknown as { getScrollableNode?: () => HTMLElement } | null
    )?.getScrollableNode?.();
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      if (node.scrollWidth <= node.clientWidth) return;
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      node.scrollLeft += event.deltaY;
      event.preventDefault();
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, []);

  const page = (direction: 1 | -1) =>
    ref.current?.scrollTo({
      x: chipBarPage(size.offset, size.viewport, size.content, direction),
      animated: true,
    });

  return (
    <View aria-label={label} role="group" style={{ flexDirection: 'row', alignItems: 'center' }}>
      <ScrollView
        ref={ref}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: space.sm }}
        style={{ flexGrow: 1, flexShrink: 1 }}
        scrollEventThrottle={16}
        onScroll={(event) => {
          const { contentOffset } = event.nativeEvent;
          setSize((current) => ({ ...current, offset: contentOffset.x }));
        }}
        onLayout={(event) => {
          const viewport = event.nativeEvent.layout.width;
          setSize((current) => ({ ...current, viewport }));
        }}
        onContentSizeChange={(content) => setSize((current) => ({ ...current, content }))}
      >
        {children}
      </ScrollView>
      {edges.left ? (
        <View style={{ position: 'absolute', left: 0, flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ backgroundColor: colors.bg }}>
            <IconButton
              icon="chevron-back"
              label="Scroll tags left"
              filled
              onPress={() => page(-1)}
            />
          </View>
          <View pointerEvents="none" style={[{ width: space.lg, height: 36 }, fade('left')]} />
        </View>
      ) : null}
      {edges.right ? (
        <View
          style={{ position: 'absolute', right: 0, flexDirection: 'row', alignItems: 'center' }}
        >
          <View pointerEvents="none" style={[{ width: space.lg, height: 36 }, fade('right')]} />
          <View style={{ backgroundColor: colors.bg }}>
            <IconButton
              icon="chevron-forward"
              label="Scroll tags right"
              filled
              onPress={() => page(1)}
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}
