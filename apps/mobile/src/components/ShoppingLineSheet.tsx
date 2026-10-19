import { usePowerSync } from '@powersync/react';
import { AISLES, type ShoppingLine } from '@recipe-app/domain';
import { View } from 'react-native';
import { canWrite, type Claims } from '../session/claims';
import { moveToAisle, removeRows } from '../shopping/repository';
import { space } from '../theme';
import { Button, Chip, Text } from '../ui';
import { BottomSheet } from './BottomSheet';

/** A line's recipes, and for writers: move to aisle and remove (shopping spec §3). */
export function ShoppingLineSheet({
  claims,
  line,
  onClose,
}: {
  claims: Claims;
  line: ShoppingLine | null;
  onClose: () => void;
}) {
  const db = usePowerSync();
  const writer = canWrite(claims.role);
  return (
    <BottomSheet open={line !== null} label={line?.item ?? ''} onClose={onClose}>
      {line ? (
        <>
          <Text variant="h2">{line.item}</Text>
          <Text variant="small" tone="muted">
            For
          </Text>
          {line.recipes.map((recipe) => (
            <Text key={recipe.id}>{recipe.title}</Text>
          ))}
          {line.handAdded ? <Text>Added by hand</Text> : null}
          {writer ? (
            <>
              <Text variant="small" tone="muted">
                Move to aisle
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                {AISLES.map((aisle) => (
                  <Chip
                    key={aisle.id}
                    label={aisle.label}
                    tone={line.aisle === aisle.id ? 'selected' : 'neutral'}
                    aria-pressed={line.aisle === aisle.id}
                    onPress={() => {
                      void moveToAisle(db, claims, line.key, aisle.id).then(onClose);
                    }}
                  />
                ))}
              </View>
              <Button
                variant="danger"
                icon="trash-outline"
                label="Remove"
                onPress={() => {
                  void removeRows(db, claims, line.rowIds).then(onClose);
                }}
              />
              {line.recipes.map((recipe) => (
                <Button
                  key={recipe.id}
                  variant="ghost"
                  label={`Remove items from ${recipe.title}`}
                  onPress={async () => {
                    // Every item this recipe put on the list, not only this line.
                    const rows = await db.getAll<{ id: string }>(
                      'select id from shopping_items where recipe_id = ? and deleted_at is null',
                      [recipe.id],
                    );
                    await removeRows(
                      db,
                      claims,
                      rows.map((row) => row.id),
                    );
                    onClose();
                  }}
                />
              ))}
            </>
          ) : null}
        </>
      ) : null}
    </BottomSheet>
  );
}
