import { usePowerSync } from '@powersync/react';
import { router } from 'expo-router';
import { View } from 'react-native';
import { RecipeEditor } from '../components/RecipeEditor';
import { emptyForm, formFromRecipe } from '../recipes/form';
import { useRecipe } from '../recipes/hooks';
import { createRecipe, updateRecipe } from '../recipes/repository';
import { canWrite, type Claims } from '../session/claims';
import { Screen, Text } from '../ui';

/** New recipe when `id` is null; otherwise edits that recipe. */
export function EditRecipeScreen({ claims, id }: { claims: Claims; id: string | null }) {
  const db = usePowerSync();
  const { recipe } = useRecipe(id ?? '', claims.userId);
  if (!canWrite(claims.role))
    return (
      <Screen>
        <Text>Viewers cannot edit recipes.</Text>
      </Screen>
    );
  if (id !== null && recipe === undefined) return null;
  if (id !== null && recipe === null) {
    return (
      <Screen>
        <Text>This recipe could not be read.</Text>
      </Screen>
    );
  }
  const previous = recipe ?? null;

  return (
    <View style={{ flex: 1 }}>
      <RecipeEditor
        initial={previous ? formFromRecipe(previous) : emptyForm()}
        previous={previous}
        onCancel={() => (id ? router.replace(`/recipe/${id}`) : router.replace('/'))}
        onSave={async (values) => {
          const savedId = id ?? (await createRecipe(db, claims, values));
          if (id) await updateRecipe(db, claims, id, values);
          router.replace(`/recipe/${savedId}`);
        }}
      />
    </View>
  );
}
