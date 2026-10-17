import { formatAmount, stepScale, stepServings, type UnitSystem } from '@recipe-app/domain';
import { Pressable, Text, View } from 'react-native';
import type { CookPlace } from '../cooking/place';

const UNIT_LABELS: [UnitSystem, string][] = [
  ['as_written', 'As written'],
  ['us', 'US'],
  ['metric', 'Metric'],
];
const box = {
  minWidth: 44,
  minHeight: 44,
  alignItems: 'center',
  justifyContent: 'center',
} as const;

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
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Pressable role="button" aria-label="Fewer servings" onPress={() => step(-1)} style={box}>
          <Text style={{ fontSize: size + 4 }}>−</Text>
        </Pressable>
        <Text style={{ fontSize: size, minWidth: 90, textAlign: 'center' }}>{label}</Text>
        <Pressable role="button" aria-label="More servings" onPress={() => step(1)} style={box}>
          <Text style={{ fontSize: size + 4 }}>+</Text>
        </Pressable>
      </View>
      <View style={{ flexDirection: 'row', gap: 4 }}>
        {UNIT_LABELS.map(([units, text]) => (
          <Pressable
            key={units}
            role="button"
            aria-pressed={place.units === units}
            onPress={() => onChange({ units })}
            style={{
              ...box,
              paddingHorizontal: 10,
              borderRadius: 6,
              backgroundColor: place.units === units ? '#e6f0ea' : 'transparent',
            }}
          >
            <Text style={{ fontSize: size, fontWeight: place.units === units ? '700' : '400' }}>
              {text}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
