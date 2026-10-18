import { Pressable, type PressableProps } from 'react-native';
import { colors, radius, space } from '../theme';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { buttonTokens, type ButtonVariant } from './variants';

type Props = Omit<PressableProps, 'style' | 'children'> & {
  label: string;
  variant?: ButtonVariant;
  icon?: IconName;
  /** Stretches to the width of its container. */
  full?: boolean;
  /** Cook mode's bigger buttons. */
  large?: boolean;
};

export function Button({
  label,
  variant = 'primary',
  icon,
  full,
  large,
  disabled,
  ...rest
}: Props) {
  const token = buttonTokens[variant];
  const text = colors[token.text];
  return (
    <Pressable
      role="button"
      disabled={disabled}
      aria-disabled={disabled || undefined}
      {...rest}
      style={({ pressed }) => ({
        minHeight: large ? 56 : 44,
        paddingHorizontal: large ? space.xl : space.lg,
        borderRadius: radius.pill,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: space.sm,
        alignSelf: full ? 'stretch' : 'flex-start',
        backgroundColor: token.background ? colors[token.background] : 'transparent',
        borderWidth: token.border ? 1.5 : 0,
        borderColor: token.border ? colors[token.border] : 'transparent',
        opacity: disabled ? 0.4 : pressed ? 0.8 : 1,
      })}
    >
      {icon ? <Icon name={icon} size={large ? 24 : 20} color={text} /> : null}
      <Text variant={large ? 'h3' : 'label'} style={{ color: text }}>
        {label}
      </Text>
    </Pressable>
  );
}
