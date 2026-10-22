import { usePowerSync } from '@powersync/react';
import { Redirect } from 'expo-router';
import { View } from 'react-native';
import { formatCookedOn, localDay } from '@recipe-app/domain';
import { useTrashedEntries } from '../cooklog/hooks';
import { restoreEntry } from '../cooklog/repository';
import { useTrash } from '../recipes/hooks';
import { restoreRecipe } from '../recipes/repository';
import { trashDaysLeft } from '../recipes/rows';
import { canWrite, type Claims } from '../session/claims';
import { space } from '../theme';
import { Button, RowCard, Screen, Text } from '../ui';

function deletesIn(days: number): string {
  if (days <= 0) return 'Deletes soon';
  return days === 1 ? 'Deletes in 1 day' : `Deletes in ${days} days`;
}

export function TrashScreen({ claims }: { claims: Claims }) {
  const db = usePowerSync();
  const items = useTrash();
  const entries = useTrashedEntries();
  if (!canWrite(claims.role)) return <Redirect href="/" />;
  const now = Date.now();

  return (
    <Screen back={{ href: '/household', label: 'Household' }}>
      <Text role="heading" aria-level={1} variant="h1">
        Trash
      </Text>
      <Text tone="muted">
        Recipes and diary entries here are deleted for good 30 days after they were moved to the
        Trash.
      </Text>
      {items.length === 0 && entries.length === 0 ? (
        <Text>The Trash is empty</Text>
      ) : items.length === 0 ? null : (
        <View style={{ gap: space.sm }}>
          {items.map((item) => (
            <RowCard
              key={item.id}
              title={item.title}
              subtitle={deletesIn(trashDaysLeft(item.deleted_at, now))}
              trailing={
                <Button
                  variant="secondary"
                  label="Restore"
                  aria-label={`Restore ${item.title}`}
                  onPress={() => void restoreRecipe(db, claims, item.id)}
                />
              }
            />
          ))}
        </View>
      )}
      {entries.length > 0 ? (
        <>
          <Text role="heading" aria-level={2} variant="h2">
            Diary entries
          </Text>
          <View style={{ gap: space.sm }}>
            {entries.map((entry) => (
              <RowCard
                key={entry.id}
                title={entry.title}
                subtitle={`${formatCookedOn(entry.cooked_on, localDay(new Date(now)))} · ${deletesIn(trashDaysLeft(entry.deleted_at, now))}`}
                href={`/diary/${entry.id}`}
                trailing={
                  <Button
                    variant="secondary"
                    label="Restore"
                    aria-label={`Restore diary entry ${entry.title}`}
                    onPress={() => void restoreEntry(db, claims, entry.id)}
                  />
                }
              />
            ))}
          </View>
        </>
      ) : null}
    </Screen>
  );
}
