import { formatAmount, stepScale, stepServings, type UnitSystem } from '@recipe-app/domain';
import { View } from 'react-native';
import type { CookPlace } from '../cooking/place';
import { space } from '../theme';
import { Chip, IconButton, Text } from '../ui';

const UNIT_LABELS: [UnitSystem, string][] = [
  ['as_written', 'As written'],
  ['us', 'US'],
  ['metric', 'Metric'],
];

/** FR-22, FR-23: servings (or scale) and units, for display only. */
export function ServingsBar({
  recipeServings,
  place,
  onChange,
  large = false,
}: {
  recipeServings: number | null;
  place: CookPlace;
  onChange(change: Partial<CookPlace>): void;
  large?: boolean;
}) {
  const size = large ? 20 : 16;
  const label =
    recipeServings !== null
      ? `Serves ${place.servings ?? recipeServings}`
      : `Scale ×${formatAmount(place.scale, null)}`;
  const step = (delta: 1 | -1) =>
    recipeServings !== null
      ? onChange({ servings: stepServings(place.servings ?? recipeServings, delta) })
      : onChange({ scale: stepScale(place.scale, delta) });
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <IconButton icon="remove" label="Fewer servings" filled onPress={() => step(-1)} />
        <Text variant="label" style={{ fontSize: size, minWidth: 90, textAlign: 'center' }}>
          {label}
        </Text>
        <IconButton icon="add" label="More servings" filled onPress={() => step(1)} />
      </View>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        {UNIT_LABELS.map(([units, text]) => (
          <Chip
            key={units}
            label={text}
            tone={place.units === units ? 'selected' : 'neutral'}
            aria-pressed={place.units === units}
            onPress={() => onChange({ units })}
          />
        ))}
      </View>
    </View>
  );
}
