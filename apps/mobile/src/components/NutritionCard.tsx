import { formatNutrition, type Nutrition } from '@recipe-app/domain';
import { View } from 'react-native';
import { space } from '../theme';
import { Card, Chip, Text } from '../ui';

/**
 * FR-43: nutrition per serving, shown only when known. Scaling servings
 * (FR-22) does not change it: it is always per serving.
 */
export function NutritionCard({ nutrition }: { nutrition: Nutrition | null | undefined }) {
  const parts = formatNutrition(nutrition);
  if (parts.length === 0) return null;
  return (
    <Card title="Nutrition">
      <Text tone="muted">Per serving</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {parts.map((part) => (
          <Chip key={part} label={part} />
        ))}
      </View>
    </Card>
  );
}
