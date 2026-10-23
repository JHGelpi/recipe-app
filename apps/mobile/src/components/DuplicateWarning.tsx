import { duplicateMessage, type DuplicateMatch } from '@recipe-app/domain';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { space } from '../theme';
import { Banner, Button, Text } from '../ui';

/**
 * FR-14: names the household's recipe that matches and why, with a way to
 * open it. It never blocks: the screen's own buttons go ahead or cancel.
 */
export function DuplicateWarning({
  matches,
  children,
}: {
  matches: readonly DuplicateMatch[];
  /** The screen's own choices, after Open it. */
  children?: ReactNode;
}) {
  const first = matches[0];
  const message = duplicateMessage(matches);
  if (!first || !message) return null;
  return (
    <Banner tone="tag" role="alert">
      <View style={{ gap: space.sm }}>
        <Text>{message}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          <Button
            variant="secondary"
            label="Open it"
            onPress={() => router.push(`/recipe/${first.id}`)}
          />
          {children}
        </View>
      </View>
    </Banner>
  );
}
