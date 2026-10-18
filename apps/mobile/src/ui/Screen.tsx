import { Link, type Href } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { colors, space } from '../theme';
import { Icon } from './Icon';

const column = {
  width: '100%',
  maxWidth: 640,
  alignSelf: 'center',
  padding: space.lg,
  gap: space.lg,
} as const;

/** A page: the theme's background, a centred column, an optional back link. */
export function Screen({
  children,
  back,
  scroll = true,
}: {
  children: ReactNode;
  /** The back arrow keeps the old link's name, e.g. "All recipes". */
  back?: { href: Href; label: string };
  scroll?: boolean;
}) {
  const header = back ? (
    <Link href={back.href} asChild>
      <Pressable
        role="link"
        aria-label={back.label}
        style={{ width: 44, height: 44, justifyContent: 'center', marginLeft: -space.sm }}
      >
        <Icon name="chevron-back" size={26} />
      </Pressable>
    </Link>
  ) : null;
  if (!scroll) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <View style={[column, { flex: 1 }]}>
          {header}
          {children}
        </View>
      </View>
    );
  }
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ paddingBottom: space.xl }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={column}>
        {header}
        {children}
      </View>
    </ScrollView>
  );
}
