import { usePowerSync } from '@powersync/react';
import { addRows, displayIngredient, scaleFactor } from '@recipe-app/domain';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useCookPlace } from '../cooking/useCookPlace';
import type { RecipeRecord } from '../recipes/rows';
import type { Claims } from '../session/claims';
import { useAisleChoices } from '../shopping/hooks';
import { addShoppingRows } from '../shopping/repository';
import { colors, space } from '../theme';
import { Banner, Button, Icon, Text } from '../ui';
import { BottomSheet } from './BottomSheet';

const FULL = 'Your list is full. Clear ticked items first.';

/** FR-32: the recipe's lines at the viewed servings, all ticked; untick what you have. */
export function AddToListSheet({
  open,
  claims,
  recipe,
  onClose,
  onAdded,
}: {
  open: boolean;
  claims: Claims;
  recipe: RecipeRecord;
  onClose: () => void;
  onAdded: (count: number) => void;
}) {
  const db = usePowerSync();
  const { place } = useCookPlace(recipe);
  const choices = useAisleChoices();
  const factor = scaleFactor(recipe.servings, place.servings, place.scale);
  const lines = recipe.ingredients.filter(
    (line) => !line.heading && (line.item.trim() || line.raw.trim()),
  );
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setChosen(new Set(lines.map((line) => line.id)));
      setMessage(null);
    }
    // Reset only when the sheet opens; the lines are the recipe's.
  }, [open]);

  const toggle = (id: string) =>
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function add() {
    if (chosen.size === 0) return;
    const rows = addRows(recipe, factor, chosen, choices, place.units);
    if ((await addShoppingRows(db, claims, rows)) === 'full') {
      setMessage(FULL);
      return;
    }
    onAdded(rows.length);
    onClose();
  }

  return (
    <BottomSheet open={open} label="Add to shopping list" onClose={onClose}>
      <Text variant="h2">Add to shopping list</Text>
      {lines.map((line) => {
        const text = displayIngredient(line, { factor, units: place.units });
        const on = chosen.has(line.id);
        return (
          <Pressable
            key={line.id}
            role="checkbox"
            aria-checked={on}
            aria-label={text}
            onPress={() => toggle(line.id)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44 }}
          >
            <Icon
              name={on ? 'checkmark-circle' : 'ellipse-outline'}
              color={on ? colors.accent : colors.muted}
            />
            <Text style={{ flex: 1 }}>{text}</Text>
          </Pressable>
        );
      })}
      {message ? (
        <Banner tone="danger" role="alert">
          {message}
        </Banner>
      ) : null}
      <View style={{ gap: space.sm }}>
        <Button
          full
          icon="cart-outline"
          label={`Add ${chosen.size} ${chosen.size === 1 ? 'item' : 'items'}`}
          aria-disabled={chosen.size === 0}
          onPress={() => void add()}
        />
        <Button variant="ghost" label="Cancel" onPress={onClose} />
      </View>
    </BottomSheet>
  );
}
