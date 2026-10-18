import { Pressable, View, type ViewStyle } from 'react-native';
import { colors, radius, space } from '../theme';
import { Text } from './Text';
import { chipTokens, type ChipTone } from './variants';

export function Chip({
  label,
  tone = 'neutral',
  onPress,
  'aria-label': ariaLabel,
  'aria-pressed': ariaPressed,
}: {
  label: string;
  tone?: ChipTone;
  onPress?: () => void;
  'aria-label'?: string;
  'aria-pressed'?: boolean;
}) {
  const token = chipTokens[tone];
  const style: ViewStyle = {
    backgroundColor: colors[token.background],
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    maxWidth: 200,
    justifyContent: 'center',
  };
  // A long tag shortens with an ellipsis (Review Focus 1).
  const text = (
    <Text variant="small" numberOfLines={1} style={{ color: colors[token.text] }}>
      {label}
    </Text>
  );
  if (!onPress) return <View style={style}>{text}</View>;
  return (
    <Pressable
      role="button"
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      hitSlop={4}
      onPress={onPress}
      style={[style, { minHeight: 36 }]}
    >
      {text}
    </Pressable>
  );
}
