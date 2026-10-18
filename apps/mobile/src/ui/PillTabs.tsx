import { Pressable, View } from 'react-native';
import { colors, radius, space } from '../theme';
import { Text } from './Text';

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
        borderRadius: radius.pill,
        padding: space.xs,
        gap: space.xs,
      }}
    >
      {tabs.map((tab) => {
        const on = tab.value === value;
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
              backgroundColor: on ? colors.raised : 'transparent',
            }}
          >
            <Text variant="label" tone={on ? 'text' : 'muted'}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
