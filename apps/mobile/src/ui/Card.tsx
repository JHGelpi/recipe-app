import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radius, space } from '../theme';
import { Text } from './Text';

export function Card({
  title,
  level = 2,
  children,
  style,
}: {
  title?: string;
  level?: 2 | 3;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        {
          backgroundColor: colors.surface,
          borderRadius: radius.card,
          padding: space.lg,
          gap: space.md,
        },
        style,
      ]}
    >
      {title ? (
        <Text role="heading" aria-level={level} variant={level === 2 ? 'h2' : 'h3'}>
          {title}
        </Text>
      ) : null}
      {children}
    </View>
  );
}
