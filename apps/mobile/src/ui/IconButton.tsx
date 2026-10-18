import { Pressable, type PressableProps } from 'react-native';
import { colors } from '../theme';
import { Icon, type IconName } from './Icon';

type Props = Omit<PressableProps, 'style' | 'children'> & {
  icon: IconName;
  /** The accessible name; there is no visible text. */
  label: string;
  tone?: 'text' | 'muted' | 'accent' | 'tag' | 'danger';
  filled?: boolean;
  size?: number;
};

export function IconButton({ icon, label, tone = 'text', filled, size = 22, ...rest }: Props) {
  return (
    <Pressable
      role="button"
      aria-label={label}
      hitSlop={4}
      {...rest}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? colors.raised : filled ? colors.surface : 'transparent',
      })}
    >
      <Icon name={icon} size={size} color={colors[tone]} />
    </Pressable>
  );
}
