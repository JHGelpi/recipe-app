import { useState, type ReactNode } from 'react';
import { TextInput, View, type TextInputProps } from 'react-native';
import { colors, radius, space, type } from '../theme';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

type Props = TextInputProps & {
  /** Shown above the field and used as its accessible name. */
  label: string;
  hideLabel?: boolean;
  error?: string | null;
  icon?: IconName;
  trailing?: ReactNode;
  /** An AI guess to check (FR-11): amber until edited. */
  warn?: boolean;
};

export function TextField({
  label,
  hideLabel,
  error,
  icon,
  trailing,
  warn,
  style,
  onFocus,
  onBlur,
  ...rest
}: Props) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: space.xs }}>
      {hideLabel ? null : (
        <Text variant="small" tone="muted">
          {label}
        </Text>
      )}
      <View
        style={{
          flexDirection: 'row',
          alignItems: rest.multiline ? 'flex-start' : 'center',
          gap: space.sm,
          backgroundColor: colors.surface,
          borderRadius: radius.field,
          borderWidth: 2,
          borderColor: error
            ? colors.danger
            : focused
              ? colors.accent
              : warn
                ? colors.tag
                : colors.control,
          paddingHorizontal: space.md,
        }}
      >
        {icon ? <Icon name={icon} size={18} color={colors.muted} /> : null}
        <TextInput
          aria-label={label}
          placeholderTextColor={colors.muted}
          {...rest}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          style={[
            type.body,
            { flex: 1, minHeight: 44, paddingVertical: space.sm, color: colors.text },
            style,
          ]}
        />
        {trailing}
      </View>
      {error ? (
        <Text variant="small" tone="danger" role="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
