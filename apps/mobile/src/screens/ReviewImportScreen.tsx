import { usePowerSync } from '@powersync/react';
import { Link, router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { PhotoImage } from '../components/PhotoImage';
import { RecipeEditor } from '../components/RecipeEditor';
import { SourceView } from '../components/SourceView';
import { useImport, usePages } from '../imports/hooks';
import { dismissImport, saveImportedRecipe, sourceOf } from '../imports/repository';
import { draftRecord, flaggedFields } from '../imports/review';
import { formFromRecipe } from '../recipes/form';
import { canWrite, type Claims } from '../session/claims';

/** FR-11: the draft in the recipe editor; nothing becomes a recipe until Save. */
export function ReviewImportScreen({ claims, id }: { claims: Claims; id: string }) {
  const db = usePowerSync();
  const record = useImport(id);
  const [leaving, setLeaving] = useState(false);
  const pages = usePages(id);
  const [dishPage, setDishPage] = useState<string | null>(null);
  const draftKey = record?.draft ? JSON.stringify(record.draft) : '';
  // Built once per draft, so the editor's ids stay stable across re-renders.
  // draftKey stands for record.draft in the dependencies.
  const recipe = useMemo(
    () =>
      record?.draft
        ? draftRecord(record, record.draft, claims.householdId, () => crypto.randomUUID())
        : null,
    [record?.id, draftKey, claims.householdId],
  );

  if (!canWrite(claims.role)) {
    return <Text style={{ padding: 16 }}>Viewers cannot import recipes.</Text>;
  }
  if (record === undefined || leaving) return null;
  if (record === null || record.status !== 'ready' || !record.draft || !recipe) {
    return (
      <View style={{ padding: 16, gap: 12 }}>
        <Text role="alert">This import is no longer available</Text>
        <Link href="/import" style={{ textDecorationLine: 'underline' }}>
          Imports
        </Link>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <RecipeEditor
        key={record.id}
        initial={formFromRecipe(recipe)}
        previous={recipe}
        flagged={flaggedFields(record.draft)}
        cancelLabel="Discard"
        cancelPrompt="Discard this import?"
        header={
          <View style={{ gap: 8 }}>
            <Text role="heading" aria-level={1} style={{ fontSize: 24, fontWeight: '600' }}>
              Review import
            </Text>
            <SourceView source={sourceOf(record)} />
            {pages.length > 0 ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                {pages.map((page, index) => (
                  <View key={page.id} style={{ gap: 4 }}>
                    <Link href={`/photo/${page.id}`} aria-label={`Page ${index + 1}`}>
                      <PhotoImage
                        id={page.id}
                        label={`Page ${index + 1}`}
                        style={{ width: 90, height: 120, borderRadius: 4 }}
                      />
                    </Link>
                    <Pressable
                      role="checkbox"
                      aria-checked={dishPage === page.id}
                      aria-label={`Use page ${index + 1} as the dish photo`}
                      onPress={() =>
                        setDishPage((current) => (current === page.id ? null : page.id))
                      }
                    >
                      <Text>{dishPage === page.id ? '☑' : '☐'} Dish photo</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        }
        onCancel={() => {
          setLeaving(true);
          void dismissImport(db, claims, record.id).then(() => router.replace('/import'));
        }}
        onSave={async (values) => {
          setLeaving(true);
          try {
            const recipeId = await saveImportedRecipe(db, claims, record, values, dishPage);
            router.replace(`/recipe/${recipeId}`);
          } catch (error) {
            setLeaving(false);
            throw error;
          }
        }}
      />
    </View>
  );
}
