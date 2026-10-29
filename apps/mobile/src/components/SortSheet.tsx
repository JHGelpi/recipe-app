import { RECIPE_SORT_LABELS, RECIPE_SORTS, type RecipeSort } from '@recipe-app/domain';
import { Pressable, View, type Role } from 'react-native';
import { colors, space } from '../theme';
import { Icon, Text } from '../ui';
import { BottomSheet } from './BottomSheet';

/** FR-49: the recipe list's orders; the current one is checked, a pick closes it. */
export function SortSheet({
  open,
  sort,
  onPick,
  onClose,
}: {
  open: boolean;
  sort: RecipeSort;
  onPick: (sort: RecipeSort) => void;
  onClose: () => void;
}) {
  return (
    <BottomSheet open={open} label="Sort recipes" onClose={onClose}>
      <Text variant="h2" role="heading" aria-level={2}>
        Sort recipes
      </Text>
      <View role="menu" aria-label="Sort recipes">
        {RECIPE_SORTS.map((option) => {
          const on = option === sort;
          return (
            <Pressable
              key={option}
              // React Native's Role list lacks it; react-native-web passes it to the DOM (NFR-11).
              role={'menuitemradio' as Role}
              aria-checked={on}
              aria-label={RECIPE_SORT_LABELS[option]}
              onPress={() => {
                onPick(option);
                onClose();
              }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44 }}
            >
              <Text style={{ flex: 1 }}>{RECIPE_SORT_LABELS[option]}</Text>
              {on ? <Icon name="checkmark" color={colors.accent} /> : null}
            </Pressable>
          );
        })}
      </View>
    </BottomSheet>
  );
}
