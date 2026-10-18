import { Link, type Href } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { colors, radius, space } from '../theme';
import { Text } from './Text';

/** A card row: thumbnail or icon, title, muted subtitle, extras, actions. */
export function RowCard({
  title,
  subtitle,
  meta,
  leading,
  trailing,
  href,
  onPress,
}: {
  title: string;
  subtitle?: string | null;
  meta?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  /** Makes the row a link named by its title. */
  href?: Href;
  onPress?: () => void;
}) {
  const body = (
    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
      {/* Two lines at most, so the actions stay on screen (Review Focus 1). */}
      <Text variant="h3" numberOfLines={2}>
        {title}
      </Text>
      {subtitle ? (
        <Text variant="small" tone="muted" numberOfLines={1}>
          {subtitle}
        </Text>
      ) : null}
      {meta}
    </View>
  );
  const main = { flex: 1, minWidth: 0, minHeight: 44, justifyContent: 'center' } as const;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        backgroundColor: colors.surface,
        borderRadius: radius.card,
        padding: space.md,
      }}
    >
      {leading}
      {href ? (
        <Link href={href} asChild>
          <Pressable role="link" aria-label={title} style={main}>
            {body}
          </Pressable>
        </Link>
      ) : onPress ? (
        <Pressable onPress={onPress} style={main}>
          {body}
        </Pressable>
      ) : (
        <View style={main}>{body}</View>
      )}
      {trailing}
    </View>
  );
}
