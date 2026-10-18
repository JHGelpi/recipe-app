import { usePowerSync } from '@powersync/react';
import { setFavorite } from '../recipes/repository';
import type { Claims } from '../session/claims';
import { IconButton } from '../ui';

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
    <IconButton
      icon={starred ? 'star' : 'star-outline'}
      label={starred ? 'Unstar' : 'Star'}
      tone={starred ? 'tag' : 'muted'}
      aria-pressed={starred}
      onPress={() => void setFavorite(db, claims, recipeId, !starred)}
    />
  );
}
