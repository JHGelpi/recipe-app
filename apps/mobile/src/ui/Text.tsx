import { Text as NativeText, type TextProps } from 'react-native';
import { colors, type, type TypeVariant } from '../theme';

export type Tone = 'text' | 'muted' | 'accent' | 'tag' | 'danger' | 'onAccent';

/** All text in the app: the theme's fonts and colors. */
export function Text({
  variant = 'body',
  tone = 'text',
  style,
  ...props
}: TextProps & { variant?: TypeVariant; tone?: Tone }) {
  return <NativeText {...props} style={[type[variant], { color: colors[tone] }, style]} />;
}
