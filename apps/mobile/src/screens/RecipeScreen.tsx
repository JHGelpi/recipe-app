import { usePowerSync } from '@powersync/react';
import { scaleFactor } from '@recipe-app/domain';
import { Link, router } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { DishPhoto } from '../components/DishPhoto';
import { IngredientList } from '../components/IngredientList';
import { OriginalPhotos } from '../components/OriginalPhotos';
import { ServingsBar } from '../components/ServingsBar';
import { SourceView } from '../components/SourceView';
import { StarButton } from '../components/StarButton';
import { confirm } from '../components/confirm';
import { useCookPlace } from '../cooking/useCookPlace';
import { useRecipe, useRecipePages } from '../recipes/hooks';
import { restoreRecipe, trashRecipe } from '../recipes/repository';
import type { RecipeRecord } from '../recipes/rows';
import { canWrite, type Claims } from '../session/claims';
import { useSubstitutions } from '../substitutions/hooks';

function summary(recipe: RecipeRecord): string {
  return [
    recipe.servings !== null ? `Serves ${recipe.servings}` : null,
    recipe.prep_minutes !== null ? `Prep ${recipe.prep_minutes} min` : null,
    recipe.cook_minutes !== null ? `Cook ${recipe.cook_minutes} min` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

const link = { textDecorationLine: 'underline' } as const;

export function RecipeScreen({ claims, id }: { claims: Claims; id: string }) {
  const db = usePowerSync();
  const { recipe, starred } = useRecipe(id, claims.userId);
  const writer = canWrite(claims.role);
  const pages = useRecipePages(id);
  if (recipe === undefined) return null;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12, maxWidth: 640 }}>
      <Link href="/" style={link}>
        All recipes
      </Link>
      {recipe === null ? (
        <Text role="alert">This recipe could not be read.</Text>
      ) : (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text
              role="heading"
              aria-level={1}
              style={{ fontSize: 24, fontWeight: '600', flex: 1 }}
            >
              {recipe.title}
            </Text>
            <StarButton claims={claims} recipeId={recipe.id} starred={starred} />
          </View>
          <DishPhoto
            claims={claims}
            recipeId={recipe.id}
            photoId={recipe.photo_id}
            editable={!recipe.deleted_at}
          />
          {recipe.deleted_at ? (
            <View style={{ gap: 8 }}>
              <Text role="alert">This recipe is in the Trash</Text>
              {writer ? (
                <Pressable role="button" onPress={() => void restoreRecipe(db, claims, recipe.id)}>
                  <Text style={link}>Restore</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          {summary(recipe) ? <Text>{summary(recipe)}</Text> : null}
          {recipe.tags.length > 0 ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {recipe.tags.map((tag) => (
                <Text
                  key={tag}
                  style={{ backgroundColor: '#e6f0ea', borderRadius: 10, paddingHorizontal: 8 }}
                >
                  {tag}
                </Text>
              ))}
            </View>
          ) : null}
          {!recipe.deleted_at ? (
            <Pressable
              role="button"
              onPress={() => router.push(`/recipe/${recipe.id}/cook`)}
              style={{
                backgroundColor: '#1a5d3a',
                borderRadius: 8,
                minHeight: 44,
                justifyContent: 'center',
                alignItems: 'center',
              }}
            >
              <Text style={{ color: '#fff', fontSize: 18 }}>Cook</Text>
            </Pressable>
          ) : null}
          {recipe.ingredients.length > 0 ? (
            <IngredientsSection claims={claims} recipe={recipe} />
          ) : null}
          {recipe.steps.length > 0 ? (
            <View style={{ gap: 6 }}>
              <Text role="heading" aria-level={2} style={{ fontSize: 18, fontWeight: '600' }}>
                Steps
              </Text>
              {recipe.steps.map((step, index) => (
                <View key={step.id} style={{ flexDirection: 'row', gap: 8 }}>
                  <Text aria-hidden>{index + 1}.</Text>
                  <Text style={{ flex: 1 }}>{step.text}</Text>
                </View>
              ))}
            </View>
          ) : null}
          {recipe.notes ? (
            <View style={{ gap: 4 }}>
              <Text role="heading" aria-level={2} style={{ fontSize: 18, fontWeight: '600' }}>
                Notes
              </Text>
              <Text>{recipe.notes}</Text>
            </View>
          ) : null}
          <SourceView source={recipe} />
          <OriginalPhotos ids={pages} />
          {writer && !recipe.deleted_at ? (
            <View style={{ flexDirection: 'row', gap: 16 }}>
              <Pressable role="button" onPress={() => router.push(`/recipe/${recipe.id}/edit`)}>
                <Text style={link}>Edit</Text>
              </Pressable>
              <Pressable
                role="button"
                onPress={async () => {
                  if (await confirm(`Move "${recipe.title}" to the Trash?`)) {
                    await trashRecipe(db, claims, recipe.id);
                    router.replace('/');
                  }
                }}
              >
                <Text style={{ ...link, color: '#b00020' }}>Move to Trash</Text>
              </Pressable>
            </View>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

/**
 * FR-22–24: the ingredients with servings and units, shared with cook mode
 * through the cook's place, and Substitute on each line.
 */
function IngredientsSection({ claims, recipe }: { claims: Claims; recipe: RecipeRecord }) {
  const { place, update } = useCookPlace(recipe);
  const substitutions = useSubstitutions(recipe.id);
  const factor = scaleFactor(recipe.servings, place.servings, place.scale);
  return (
    <View style={{ gap: 8 }}>
      <Text role="heading" aria-level={2} style={{ fontSize: 18, fontWeight: '600' }}>
        Ingredients
      </Text>
      <ServingsBar recipeServings={recipe.servings} place={place} onChange={update} />
      <IngredientList
        claims={claims}
        recipeId={recipe.id}
        ingredients={recipe.ingredients}
        factor={factor}
        units={place.units}
        substitutions={substitutions}
      />
    </View>
  );
}
