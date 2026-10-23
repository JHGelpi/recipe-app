import { usePowerSync } from '@powersync/react';
import { setFavorite } from '../recipes/repository';
import type { Claims } from '../session/claims';
import { IconButton } from '../ui';

/** FR-17: a heart, like the Favorites tab; stars are for ratings (FR-44). */
export function FavoriteButton({
  claims,
  recipeId,
  favorite,
}: {
  claims: Claims;
  recipeId: string;
  favorite: boolean;
}) {
  const db = usePowerSync();
  return (
    <IconButton
      icon={favorite ? 'heart' : 'heart-outline'}
      label={favorite ? 'Unfavorite' : 'Favorite'}
      tone={favorite ? 'accent' : 'muted'}
      aria-pressed={favorite}
      onPress={() => void setFavorite(db, claims, recipeId, !favorite)}
    />
  );
}
