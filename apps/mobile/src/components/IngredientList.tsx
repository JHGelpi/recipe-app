import { displayIngredient, type Ingredient, type UnitSystem } from '@recipe-app/domain';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { Claims } from '../session/claims';
import type { SubstitutionRecord } from '../substitutions/rows';
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
    <View style={{ gap: 6 }}>
      {ingredients.map((ingredient) => {
        if (ingredient.heading) {
          return (
            <Text key={ingredient.id} style={{ fontSize: size, fontWeight: '600', marginTop: 6 }}>
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
                  <Text style={{ fontSize: size }}>{done ? '☑' : '☐'}</Text>
                  <Text
                    style={{
                      fontSize: size,
                      flex: 1,
                      color: done ? '#888' : '#000',
                      textDecorationLine: done ? 'line-through' : 'none',
                    }}
                  >
                    {shown}
                  </Text>
                </Pressable>
              ) : (
                <Text style={{ fontSize: size, flex: 1 }}>{shown}</Text>
              )}
              <Pressable
                role="button"
                aria-label={`Substitute for ${ingredient.raw}`}
                aria-expanded={open === ingredient.id}
                onPress={() =>
                  setOpen((current) => (current === ingredient.id ? null : ingredient.id))
                }
                style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 6 }}
              >
                <Text style={{ textDecorationLine: 'underline', fontSize: size - 2 }}>
                  Substitute
                </Text>
              </Pressable>
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
