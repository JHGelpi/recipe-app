import type { ReactNode } from 'react';
import { View } from 'react-native';
import { colors, radius, space } from '../theme';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

const ICONS = {
  accent: 'checkmark-circle-outline',
  tag: 'alert-circle-outline',
  danger: 'alert-circle-outline',
} as const;

export function Banner({
  tone = 'accent',
  icon,
  role = 'status',
  action,
  children,
}: {
  tone?: 'accent' | 'tag' | 'danger';
  icon?: IconName;
  role?: 'status' | 'alert';
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <View
      role={role}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        backgroundColor: colors.surface,
        borderRadius: radius.card,
        borderLeftWidth: 4,
        borderLeftColor: colors[tone],
        padding: space.md,
      }}
    >
      <Icon name={icon ?? ICONS[tone]} color={colors[tone]} />
      <View style={{ flex: 1 }}>
        {typeof children === 'string' ? <Text>{children}</Text> : children}
      </View>
      {action}
    </View>
  );
}
