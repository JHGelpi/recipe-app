import { Pressable, View } from 'react-native';
import { colors, radius, space } from '../theme';
import { Text } from './Text';
import { pillTabTokens } from './variants';

/** Segmented tabs (Example 4). */
export function PillTabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View
      role="tablist"
      style={{
        flexDirection: 'row',
        backgroundColor: colors.surface,
        // So the track shows inside a card, which is surface too.
        borderWidth: 1,
        borderColor: colors.line,
        borderRadius: radius.pill,
        padding: space.xs,
        gap: space.xs,
      }}
    >
      {tabs.map((tab) => {
        const on = tab.value === value;
        const token = pillTabTokens[on ? 'selected' : 'idle'];
        return (
          <Pressable
            key={tab.value}
            role="tab"
            aria-selected={on}
            onPress={() => onChange(tab.value)}
            style={{
              flex: 1,
              minHeight: 44,
              borderRadius: radius.pill,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: token.background ? colors[token.background] : 'transparent',
            }}
          >
            <Text variant="label" tone={token.text}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
