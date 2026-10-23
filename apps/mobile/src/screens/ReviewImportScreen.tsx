import { usePowerSync } from '@powersync/react';
import { duplicateMessage, type DuplicateMatch } from '@recipe-app/domain';
import { Link, router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { confirm } from '../components/confirm';
import { DuplicateWarning } from '../components/DuplicateWarning';
import { PhotoImage } from '../components/PhotoImage';
import { RecipeEditor } from '../components/RecipeEditor';
import { SourceView } from '../components/SourceView';
import { useImport, usePages } from '../imports/hooks';
import { dismissImport, saveImportedRecipe, sourceOf } from '../imports/repository';
import { draftRecord, flaggedFields } from '../imports/review';
import { findLocalDuplicates } from '../recipes/duplicates';
import { clearFilter } from '../recipes/listFilter';
import { formFromRecipe } from '../recipes/form';
import { canWrite, type Claims } from '../session/claims';
import { colors, radius, space } from '../theme';
import { Banner, Button, Icon, Screen, Text } from '../ui';

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
  const sourceUrl = record ? sourceOf(record).source_url : null;
  // FR-14: the household's recipes matching the parsed draft, named above the form.
  const [duplicates, setDuplicates] = useState<DuplicateMatch[]>([]);
  useEffect(() => {
    if (!recipe) return;
    let live = true;
    void findLocalDuplicates(db, { ...recipe, source_url: sourceUrl }).then((matches) => {
      if (live) setDuplicates(matches);
    });
    return () => {
      live = false;
    };
  }, [db, recipe, sourceUrl]);

  if (!canWrite(claims.role)) {
    return (
      <Screen>
        <Text>Viewers cannot import recipes.</Text>
      </Screen>
    );
  }
  if (record === undefined || leaving) return null;
  if (record === null || record.status !== 'ready' || !record.draft || !recipe) {
    return (
      <Screen>
        <Banner tone="danger" role="alert">
          This import is no longer available
        </Banner>
        <Button variant="ghost" label="Imports" onPress={() => router.replace('/import')} />
      </Screen>
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
          <View style={{ gap: space.md }}>
            <Text role="heading" aria-level={1} variant="h1">
              Review import
            </Text>
            <DuplicateWarning matches={duplicates} />
            <SourceView source={sourceOf(record)} />
            {pages.length > 0 ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
                {pages.map((page, index) => (
                  <View key={page.id} style={{ gap: 4 }}>
                    <Link href={`/photo/${page.id}`} aria-label={`Page ${index + 1}`}>
                      <PhotoImage
                        id={page.id}
                        label={`Page ${index + 1}`}
                        style={{ width: 90, height: 120, borderRadius: radius.field }}
                      />
                    </Link>
                    <Pressable
                      role="checkbox"
                      aria-checked={dishPage === page.id}
                      aria-label={`Use page ${index + 1} as the dish photo`}
                      onPress={() =>
                        setDishPage((current) => (current === page.id ? null : page.id))
                      }
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: space.xs,
                        minHeight: 44,
                      }}
                    >
                      <Icon
                        name={dishPage === page.id ? 'checkmark-circle-outline' : 'add'}
                        size={18}
                        color={dishPage === page.id ? colors.accent : colors.muted}
                      />
                      <Text variant="small">Dish photo</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        }
        beforeSave={async (values) => {
          // Checked again, so edits made during review count. Only a match the
          // banner didn't already name is asked about; Save still goes ahead.
          const matches = await findLocalDuplicates(db, { ...values, source_url: sourceUrl });
          const named = new Set(duplicates.map((match) => match.id));
          const fresh = matches.filter((match) => !named.has(match.id));
          setDuplicates(matches);
          return fresh.length === 0 || confirm(`${duplicateMessage(fresh)!} Save anyway?`);
        }}
        onCancel={() => {
          setLeaving(true);
          void dismissImport(db, claims, record.id).then(() => router.replace('/import'));
        }}
        onSave={async (values) => {
          setLeaving(true);
          try {
            const recipeId = await saveImportedRecipe(db, claims, record, values, dishPage);
            clearFilter();
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
