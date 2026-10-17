import { scaleFactor } from '@recipe-app/domain';
import { router } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { IngredientList } from '../components/IngredientList';
import { ServingsBar } from '../components/ServingsBar';
import { useCookPlace } from '../cooking/useCookPlace';
import { useWakeLock } from '../cooking/useWakeLock';
import { useRecipe } from '../recipes/hooks';
import type { RecipeRecord } from '../recipes/rows';
import type { Claims } from '../session/claims';
import { useSubstitutions } from '../substitutions/hooks';

const button = {
  minHeight: 44,
  minWidth: 88,
  paddingHorizontal: 16,
  borderRadius: 8,
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: '#1a5d3a',
} as const;

/** FR-21: cooking at the counter: awake, large, one step at a time. */
export function CookScreen({ claims, id }: { claims: Claims; id: string }) {
  const { recipe } = useRecipe(id, claims.userId);
  if (recipe === undefined) return null;
  if (recipe === null || recipe.deleted_at) {
    return <Text style={{ padding: 16 }}>This recipe could not be read.</Text>;
  }
  return <Cooking claims={claims} recipe={recipe} />;
}

function Cooking({ claims, recipe }: { claims: Claims; recipe: RecipeRecord }) {
  const { place, update, reset } = useCookPlace(recipe);
  const wake = useWakeLock(true);
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
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16, maxWidth: 720 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Pressable
          role="button"
          onPress={() => router.replace(`/recipe/${recipe.id}`)}
          style={{ minHeight: 44, justifyContent: 'center' }}
        >
          <Text style={{ fontSize: 18, textDecorationLine: 'underline' }}>{recipe.title}</Text>
        </Pressable>
        <Pressable
          role="button"
          onPress={reset}
          style={{ minHeight: 44, justifyContent: 'center' }}
        >
          <Text style={{ fontSize: 18, textDecorationLine: 'underline' }}>Reset</Text>
        </Pressable>
      </View>
      {wake === 'unsupported' ? (
        <Text style={{ color: '#555' }}>Your screen may sleep while cooking.</Text>
      ) : null}
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
      <View style={{ gap: 12, borderTopWidth: 1, borderColor: '#ddd', paddingTop: 12 }}>
        {steps.length === 0 ? (
          <Text style={{ fontSize: 20 }}>No steps</Text>
        ) : (
          <>
            <Text style={{ fontSize: 18, color: '#444' }}>
              Step {place.step + 1} of {steps.length}
            </Text>
            <Text style={{ fontSize: 24, lineHeight: 34 }}>{steps[place.step]?.text}</Text>
            {factor !== 1 ? (
              <Text style={{ color: '#555' }}>
                {recipe.servings !== null
                  ? `Amounts in steps are for the original ${recipe.servings} servings`
                  : 'Amounts in steps are for the original recipe'}
              </Text>
            ) : null}
            <View style={{ flexDirection: 'row', gap: 12 }}>
              {place.step > 0 ? (
                <Pressable
                  role="button"
                  onPress={() => update({ step: place.step - 1 })}
                  style={{ ...button, backgroundColor: '#666' }}
                >
                  <Text style={{ color: '#fff', fontSize: 20 }}>Previous</Text>
                </Pressable>
              ) : null}
              {place.step < last ? (
                <Pressable
                  role="button"
                  onPress={() => update({ step: place.step + 1 })}
                  style={button}
                >
                  <Text style={{ color: '#fff', fontSize: 20 }}>Next</Text>
                </Pressable>
              ) : (
                <Pressable role="button" onPress={done} style={button}>
                  <Text style={{ color: '#fff', fontSize: 20 }}>Done</Text>
                </Pressable>
              )}
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
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
                      width: 14,
                      height: 14,
                      borderRadius: 7,
                      backgroundColor: index === place.step ? '#1a5d3a' : '#ccc',
                    }}
                  />
                </Pressable>
              ))}
            </View>
          </>
        )}
      </View>
    </ScrollView>
  );
}
