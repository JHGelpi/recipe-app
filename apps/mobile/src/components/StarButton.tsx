import { usePowerSync } from '@powersync/react';
import { Pressable, Text } from 'react-native';
import { setFavorite } from '../recipes/repository';
import type { Claims } from '../session/claims';

export function StarButton({
  claims,
  recipeId,
  starred,
}: {
  claims: Claims;
  recipeId: string;
  starred: boolean;
}) {
  const db = usePowerSync();
  return (
    <Pressable
      role="button"
      aria-label={starred ? 'Unstar' : 'Star'}
      aria-pressed={starred}
      hitSlop={8}
      onPress={() => void setFavorite(db, claims, recipeId, !starred)}
    >
      <Text style={{ fontSize: 22, color: starred ? '#c98a00' : '#888' }}>
        {starred ? '★' : '☆'}
      </Text>
    </Pressable>
  );
}
