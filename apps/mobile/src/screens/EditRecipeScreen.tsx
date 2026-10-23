import { usePowerSync } from '@powersync/react';
import { changedReasons, duplicateMessage, editDuplicateMessage } from '@recipe-app/domain';
import { router } from 'expo-router';
import { View } from 'react-native';
import { confirm } from '../components/confirm';
import { RecipeEditor } from '../components/RecipeEditor';
import { findLocalDuplicates } from '../recipes/duplicates';
import { emptyForm, formFromRecipe } from '../recipes/form';
import { clearFilter } from '../recipes/listFilter';
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
        beforeSave={async (values) => {
          // FR-14: a new recipe checks name and ingredients; an edit only what it changed.
          // The editor never changes the link, so it stays the recipe's own.
          const candidate = { ...values, source_url: previous?.source_url ?? null };
          const only = previous ? changedReasons(previous, candidate) : undefined;
          if (only?.length === 0) return true;
          const matches = await findLocalDuplicates(db, candidate, { selfId: id, only });
          if (matches.length === 0) return true;
          return confirm(
            previous
              ? editDuplicateMessage(matches)!
              : `${duplicateMessage(matches)!} Add another?`,
          );
        }}
        onCancel={() => (id ? router.replace(`/recipe/${id}`) : router.replace('/'))}
        onSave={async (values) => {
          const savedId = id ?? (await createRecipe(db, claims, values));
          if (id) await updateRecipe(db, claims, id, values);
          // A search typed earlier must not hide the recipe just made.
          else clearFilter();
          router.replace(`/recipe/${savedId}`);
        }}
      />
    </View>
  );
}
