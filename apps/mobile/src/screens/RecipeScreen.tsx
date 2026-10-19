import { usePowerSync } from '@powersync/react';
import { scaleFactor } from '@recipe-app/domain';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { AddToListSheet } from '../components/AddToListSheet';
import { DishPhoto } from '../components/DishPhoto';
import { IngredientList } from '../components/IngredientList';
import { OriginalPhotos } from '../components/OriginalPhotos';
import { ServingsBar } from '../components/ServingsBar';
import { SharePanel } from '../components/ShareMenu';
import { SharedLinks } from '../components/SharedLinks';
import { SourceView } from '../components/SourceView';
import { StarButton } from '../components/StarButton';
import { confirm } from '../components/confirm';
import { useCookPlace } from '../cooking/useCookPlace';
import { useRecipe, useRecipePages } from '../recipes/hooks';
import { restoreRecipe, trashRecipe } from '../recipes/repository';
import type { RecipeRecord } from '../recipes/rows';
import { canWrite, type Claims } from '../session/claims';
import { takeSavedFlash } from '../sharing/pending';
import { colors, space } from '../theme';
import { Banner, Button, Card, Chip, Icon, IconButton, Screen, Text } from '../ui';
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

export function RecipeScreen({ claims, id }: { claims: Claims; id: string }) {
  const db = usePowerSync();
  const { recipe, starred } = useRecipe(id, claims.userId);
  const writer = canWrite(claims.role);
  const pages = useRecipePages(id);
  const [saved] = useState(() => takeSavedFlash());
  const [panel, setPanel] = useState<'share' | 'more' | null>(null);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(0);
  // "Added N items" clears after a moment, or on the next Add to list.
  useEffect(() => {
    if (added === 0) return;
    const timer = setTimeout(() => setAdded(0), 4000);
    return () => clearTimeout(timer);
  }, [added]);
  if (recipe === undefined) return null;
  const toggle = (next: 'share' | 'more') =>
    setPanel((current) => (current === next ? null : next));

  return (
    <Screen back={{ href: '/', label: 'All recipes' }}>
      {recipe === null ? (
        <Banner tone="danger" role="alert">
          This recipe could not be read.
        </Banner>
      ) : (
        <>
          <DishPhoto
            claims={claims}
            recipeId={recipe.id}
            photoId={recipe.photo_id}
            editable={!recipe.deleted_at}
          />
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.sm }}>
            <Text role="heading" aria-level={1} variant="h1" style={{ flex: 1 }}>
              {recipe.title}
            </Text>
            <StarButton claims={claims} recipeId={recipe.id} starred={starred} />
          </View>
          {saved ? <Banner>Saved to your recipes</Banner> : null}
          {recipe.deleted_at ? (
            <Banner
              tone="tag"
              role="alert"
              action={
                writer ? (
                  <Button
                    variant="ghost"
                    label="Restore"
                    onPress={() => void restoreRecipe(db, claims, recipe.id)}
                  />
                ) : null
              }
            >
              This recipe is in the Trash
            </Banner>
          ) : null}
          {summary(recipe) ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
              <Icon name="time-outline" size={16} color={colors.muted} />
              <Text tone="muted">{summary(recipe)}</Text>
            </View>
          ) : null}
          {recipe.tags.length > 0 ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              {recipe.tags.map((tag) => (
                <Chip key={tag} label={tag} tone="tag" />
              ))}
            </View>
          ) : null}
          {!recipe.deleted_at ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <View style={{ flex: 1 }}>
                <Button
                  full
                  icon="restaurant-outline"
                  label="Cook"
                  onPress={() => router.push(`/recipe/${recipe.id}/cook`)}
                />
              </View>
              {writer ? (
                <IconButton
                  icon="cart-outline"
                  label="Add to list"
                  filled
                  onPress={() => {
                    setAdded(0);
                    setAdding(true);
                  }}
                />
              ) : null}
              <IconButton
                icon="share-outline"
                label="Share"
                filled
                aria-expanded={panel === 'share'}
                onPress={() => toggle('share')}
              />
              {writer ? (
                <>
                  <IconButton
                    icon="create-outline"
                    label="Edit"
                    filled
                    onPress={() => router.push(`/recipe/${recipe.id}/edit`)}
                  />
                  <IconButton
                    icon="ellipsis-horizontal"
                    label="More"
                    filled
                    aria-expanded={panel === 'more'}
                    onPress={() => toggle('more')}
                  />
                </>
              ) : null}
            </View>
          ) : null}
          {added > 0 ? (
            <Banner>{`Added ${added} ${added === 1 ? 'item' : 'items'} to your list`}</Banner>
          ) : null}
          {/* Mounted only while open, so it reads the servings and units the cook
              just chose (the servings bar saves them as it changes). */}
          {adding && writer && !recipe.deleted_at ? (
            <AddToListSheet
              open={adding}
              claims={claims}
              recipe={recipe}
              onClose={() => setAdding(false)}
              onAdded={setAdded}
            />
          ) : null}
          {panel === 'share' && !recipe.deleted_at ? <SharePanel recipe={recipe} /> : null}
          {panel === 'more' && writer && !recipe.deleted_at ? (
            <Card>
              <Button
                variant="danger"
                icon="trash-outline"
                label="Move to Trash"
                onPress={async () => {
                  if (await confirm(`Move "${recipe.title}" to the Trash?`)) {
                    await trashRecipe(db, claims, recipe.id);
                    router.replace('/');
                  }
                }}
              />
            </Card>
          ) : null}
          <SharedLinks claims={claims} recipe={recipe} />
          {recipe.ingredients.length > 0 ? (
            <IngredientsSection claims={claims} recipe={recipe} />
          ) : null}
          {recipe.steps.length > 0 ? (
            <Card title="Steps">
              {recipe.steps.map((step, index) => (
                <View key={step.id} style={{ flexDirection: 'row', gap: space.md }}>
                  <Text aria-hidden tone="accent" variant="h3">
                    {index + 1}
                  </Text>
                  <Text style={{ flex: 1 }}>{step.text}</Text>
                </View>
              ))}
            </Card>
          ) : null}
          {recipe.notes ? (
            <Card title="Notes">
              <Text>{recipe.notes}</Text>
            </Card>
          ) : null}
          <SourceView source={recipe} />
          <OriginalPhotos ids={pages} />
        </>
      )}
    </Screen>
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
    <Card title="Ingredients">
      <ServingsBar recipeServings={recipe.servings} place={place} onChange={update} />
      <IngredientList
        claims={claims}
        recipeId={recipe.id}
        ingredients={recipe.ingredients}
        factor={factor}
        units={place.units}
        substitutions={substitutions}
      />
    </Card>
  );
}
