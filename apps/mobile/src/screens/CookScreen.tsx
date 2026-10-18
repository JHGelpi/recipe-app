import { scaleFactor } from '@recipe-app/domain';
import { router } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IngredientList } from '../components/IngredientList';
import { ServingsBar } from '../components/ServingsBar';
import { useCookPlace } from '../cooking/useCookPlace';
import { useWakeLock } from '../cooking/useWakeLock';
import { useRecipe } from '../recipes/hooks';
import type { RecipeRecord } from '../recipes/rows';
import type { Claims } from '../session/claims';
import { useSubstitutions } from '../substitutions/hooks';
import { colors, space } from '../theme';
import { Button, Card, IconButton, Screen, Text } from '../ui';

/** FR-21: cooking at the counter: awake, large, one step at a time. */
export function CookScreen({ claims, id }: { claims: Claims; id: string }) {
  const { recipe } = useRecipe(id, claims.userId);
  if (recipe === undefined) return null;
  if (recipe === null || recipe.deleted_at) {
    return (
      <Screen>
        <Text>This recipe could not be read.</Text>
      </Screen>
    );
  }
  return <Cooking claims={claims} recipe={recipe} />;
}

function Cooking({ claims, recipe }: { claims: Claims; recipe: RecipeRecord }) {
  const { place, update, reset } = useCookPlace(recipe);
  const wake = useWakeLock(true);
  const insets = useSafeAreaInsets();
  const substitutions = useSubstitutions(recipe.id);
  const factor = scaleFactor(recipe.servings, place.servings, place.scale);
  const steps = recipe.steps;
  const last = steps.length - 1;
  const toggle = (ingredientId: string) =>
    update({
      ticked: place.ticked.includes(ingredientId)
        ? place.ticked.filter((tick) => tick !== ingredientId)
        : [...place.ticked, ingredientId],
    });
  const done = () => {
    reset();
    router.replace(`/recipe/${recipe.id}`);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        contentContainerStyle={{
          padding: space.lg,
          gap: space.lg,
          maxWidth: 720,
          width: '100%',
          alignSelf: 'center',
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <IconButton
            icon="chevron-back"
            label={`Back to ${recipe.title}`}
            onPress={() => router.replace(`/recipe/${recipe.id}`)}
          />
          <Text variant="h2" numberOfLines={1} style={{ flex: 1 }}>
            {recipe.title}
          </Text>
          <Button variant="ghost" label="Reset" onPress={reset} />
        </View>
        {wake === 'unsupported' ? (
          <Text tone="muted">Your screen may sleep while cooking.</Text>
        ) : null}
        <Card>
          <ServingsBar recipeServings={recipe.servings} place={place} onChange={update} large />
          <IngredientList
            claims={claims}
            recipeId={recipe.id}
            ingredients={recipe.ingredients}
            factor={factor}
            units={place.units}
            substitutions={substitutions}
            checkable
            ticked={place.ticked}
            onToggle={toggle}
            large
          />
        </Card>
        {steps.length === 0 ? (
          <Text variant="h2">No steps</Text>
        ) : (
          <View style={{ gap: space.md }}>
            <Text variant="label" tone="muted">
              Step {place.step + 1} of {steps.length}
            </Text>
            <View
              aria-hidden
              style={{
                height: 6,
                borderRadius: 3,
                backgroundColor: colors.raised,
                overflow: 'hidden',
              }}
            >
              <View
                style={{
                  height: 6,
                  width: `${((place.step + 1) / steps.length) * 100}%`,
                  backgroundColor: colors.accent,
                }}
              />
            </View>
            <Text style={{ fontSize: 26, lineHeight: 38 }}>{steps[place.step]?.text}</Text>
            {factor !== 1 ? (
              <Text tone="muted">
                {recipe.servings !== null
                  ? `Amounts in steps are for the original ${recipe.servings} servings`
                  : 'Amounts in steps are for the original recipe'}
              </Text>
            ) : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
              {steps.map((step, index) => (
                <Pressable
                  key={step.id}
                  role="button"
                  aria-label={`Go to step ${index + 1}`}
                  onPress={() => update({ step: index })}
                  style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
                >
                  <View
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: 6,
                      backgroundColor: index === place.step ? colors.accent : colors.line,
                    }}
                  />
                </Pressable>
              ))}
            </View>
          </View>
        )}
      </ScrollView>
      {steps.length > 0 ? (
        // Within thumb reach at the bottom (UI spec §5).
        <View
          style={{
            flexDirection: 'row',
            gap: space.md,
            padding: space.lg,
            paddingBottom: Math.max(insets.bottom, space.lg),
            borderTopWidth: 1,
            borderTopColor: colors.line,
            backgroundColor: colors.raised,
          }}
        >
          {place.step > 0 ? (
            <View style={{ flex: 1 }}>
              <Button
                full
                large
                variant="secondary"
                label="Previous"
                onPress={() => update({ step: place.step - 1 })}
              />
            </View>
          ) : null}
          <View style={{ flex: 1 }}>
            {place.step < last ? (
              <Button full large label="Next" onPress={() => update({ step: place.step + 1 })} />
            ) : (
              <Button full large label="Done" onPress={done} />
            )}
          </View>
        </View>
      ) : null}
    </View>
  );
}
