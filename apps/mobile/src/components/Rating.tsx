import { usePowerSync } from '@powersync/react';
import {
  MAX_STARS,
  nextRating,
  rateLabel,
  ratingSpoken,
  ratingText,
  type RatingSummary,
} from '@recipe-app/domain';
import { Pressable, View } from 'react-native';
import { setRating } from '../ratings/repository';
import type { Claims } from '../session/claims';
import { colors, radius, space } from '../theme';
import { Card, Icon, IconButton, Text } from '../ui';

/**
 * FR-44: the household average beside the title ("★ 4.3"). It opens the
 * rating picker; in the Trash it is read-only.
 */
export function RatingBadge({
  summary,
  open,
  onPress,
}: {
  summary: RatingSummary;
  open: boolean;
  /** Absent when the recipe is in the Trash: nothing to open. */
  onPress?: () => void;
}) {
  const rated = summary.average !== null;
  const content = (
    <>
      <Icon name={rated ? 'star' : 'star-outline'} size={18} color={colors.tag} />
      <Text variant="label" tone={rated ? 'text' : 'muted'}>
        {rated ? summary.average!.toFixed(1) : 'Rate'}
      </Text>
    </>
  );
  const style = {
    minWidth: 44,
    height: 44,
    paddingHorizontal: space.sm,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
  } as const;
  if (!onPress) {
    return (
      <View role="img" aria-label={`Rating: ${ratingSpoken(summary)}`} style={style}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      role="button"
      aria-label={`Rating: ${ratingSpoken(summary)}. Rate this recipe`}
      aria-expanded={open}
      onPress={onPress}
      style={({ pressed }) => [style, { backgroundColor: pressed ? colors.raised : 'transparent' }]}
    >
      {content}
    </Pressable>
  );
}

/** Five stars for your own rating; tapping your current one clears it. */
export function RatingPicker({
  claims,
  recipeId,
  mine,
  summary,
}: {
  claims: Claims;
  recipeId: string;
  mine: number | null;
  summary: RatingSummary;
}) {
  const db = usePowerSync();
  const stars = Array.from({ length: MAX_STARS }, (_, i) => i + 1);
  return (
    <Card>
      <View
        role="group"
        aria-label={mine ? `Your rating: ${mine} of ${MAX_STARS} stars` : 'Your rating: none'}
        style={{ flexDirection: 'row', flexWrap: 'wrap' }}
      >
        {stars.map((n) => (
          <IconButton
            key={n}
            icon={mine !== null && n <= mine ? 'star' : 'star-outline'}
            label={rateLabel(n)}
            tone={mine !== null && n <= mine ? 'tag' : 'muted'}
            size={28}
            aria-pressed={n === mine}
            onPress={() => void setRating(db, claims, recipeId, nextRating(mine, n))}
          />
        ))}
      </View>
      <View style={{ gap: space.xs }}>
        <Text>{ratingText(summary)}</Text>
        {mine ? (
          <Text variant="small" tone="muted">
            Tap your rating again to clear it.
          </Text>
        ) : null}
      </View>
    </Card>
  );
}
