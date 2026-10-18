import { displayIngredient, type Ingredient, type UnitSystem } from '@recipe-app/domain';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import type { Claims } from '../session/claims';
import type { SubstitutionRecord } from '../substitutions/rows';
import { colors, radius, space } from '../theme';
import { Button, Icon, Text } from '../ui';
import { SubstitutePanel } from './SubstitutePanel';

/**
 * The recipe's ingredients, scaled and converted for display. In cook mode
 * each line is a checkbox. Every line has Substitute (FR-24).
 */
export function IngredientList({
  claims,
  recipeId,
  ingredients,
  factor,
  units,
  substitutions,
  checkable = false,
  ticked = [],
  onToggle,
  large = false,
}: {
  claims: Claims;
  recipeId: string;
  ingredients: Ingredient[];
  factor: number;
  units: UnitSystem;
  substitutions: Map<string, SubstitutionRecord>;
  checkable?: boolean;
  ticked?: string[];
  onToggle?(id: string): void;
  large?: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const size = large ? 20 : 16;
  return (
    <View style={{ gap: space.xs }}>
      {ingredients.map((ingredient) => {
        if (ingredient.heading) {
          return (
            <Text key={ingredient.id} variant="h3" style={{ fontSize: size, marginTop: space.sm }}>
              {ingredient.raw}
            </Text>
          );
        }
        const shown = displayIngredient(ingredient, { factor, units });
        const done = ticked.includes(ingredient.id);
        return (
          <View key={ingredient.id} style={{ gap: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 }}>
              {checkable ? (
                <Pressable
                  role="checkbox"
                  aria-checked={done}
                  aria-label={shown}
                  onPress={() => onToggle?.(ingredient.id)}
                  style={{
                    flex: 1,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                    minHeight: 44,
                  }}
                >
                  <View
                    aria-hidden
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: radius.field / 2,
                      borderWidth: 2,
                      borderColor: done ? colors.accent : colors.line,
                      backgroundColor: done ? colors.accent : 'transparent',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {done ? <Icon name="checkmark" size={18} color={colors.onAccent} /> : null}
                  </View>
                  <Text
                    tone={done ? 'muted' : 'text'}
                    style={{
                      fontSize: size,
                      flex: 1,
                      textDecorationLine: done ? 'line-through' : 'none',
                    }}
                  >
                    {shown}
                  </Text>
                </Pressable>
              ) : (
                <Text style={{ fontSize: size, flex: 1 }}>{shown}</Text>
              )}
              <Button
                variant="ghost"
                label="Substitute"
                aria-label={`Substitute for ${ingredient.raw}`}
                aria-expanded={open === ingredient.id}
                onPress={() =>
                  setOpen((current) => (current === ingredient.id ? null : ingredient.id))
                }
              />
            </View>
            {open === ingredient.id ? (
              <SubstitutePanel
                claims={claims}
                recipeId={recipeId}
                ingredient={ingredient}
                remembered={substitutions.get(ingredient.id) ?? null}
                scaled={factor !== 1}
              />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
