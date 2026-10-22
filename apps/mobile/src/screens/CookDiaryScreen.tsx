import { formatCookedOn, localDay } from '@recipe-app/domain';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { View } from 'react-native';
import { PhotoImage } from '../components/PhotoImage';
import { useCookName, useDiary, type DiaryItem } from '../cooklog/hooks';
import type { Claims } from '../session/claims';
import { colors, radius, space } from '../theme';
import { Chip, ChipBar, Icon, RowCard, Screen, Text } from '../ui';

/** The recipes in the diary, most recently cooked first, for the filter chips. */
function cookedRecipes(items: DiaryItem[]): { id: string; title: string }[] {
  const seen = new Map<string, string>();
  for (const item of items) {
    if (item.recipe_id && !seen.has(item.recipe_id)) seen.set(item.recipe_id, item.title);
  }
  return [...seen].map(([id, title]) => ({ id, title }));
}

/** First line of the notes, short enough for a row. */
function notesStart(notes: string | null): string | null {
  const line = notes?.trim().split('\n')[0]?.trim();
  if (!line) return null;
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
}

/** FR-40: every meal the household logged, newest first, filterable by recipe. */
export function CookDiaryScreen({ claims, recipeId }: { claims: Claims; recipeId: string | null }) {
  const all = useDiary(null);
  const cookName = useCookName(claims.userId);
  const recipes = useMemo(() => cookedRecipes(all), [all]);
  const items = recipeId ? all.filter((item) => item.recipe_id === recipeId) : all;
  const today = localDay(new Date());

  return (
    <Screen back={{ href: '/household', label: 'Household' }}>
      <Text role="heading" aria-level={1} variant="h1">
        Cook diary
      </Text>
      {recipes.length > 1 || recipeId ? (
        <ChipBar label="Recipes">
          <Chip
            label="All"
            tone={recipeId ? 'neutral' : 'selected'}
            aria-pressed={!recipeId}
            onPress={() => router.setParams({ recipe: '' })}
          />
          {recipes.map((recipe) => (
            <Chip
              key={recipe.id}
              label={recipe.title}
              tone={recipe.id === recipeId ? 'selected' : 'neutral'}
              aria-label={`Only ${recipe.title}`}
              aria-pressed={recipe.id === recipeId}
              onPress={() => router.setParams({ recipe: recipe.id })}
            />
          ))}
        </ChipBar>
      ) : null}
      {items.length === 0 ? (
        <Text tone="muted">
          Nothing logged yet. Tap “I cooked this” on a recipe to start your diary.
        </Text>
      ) : (
        <View style={{ gap: space.sm }}>
          {items.map((item) => (
            <RowCard
              key={item.id}
              title={item.title}
              subtitle={`${formatCookedOn(item.cooked_on, today)} · ${cookName(item.cooked_by)}`}
              href={`/diary/${item.id}`}
              meta={
                notesStart(item.notes) ? (
                  <Text variant="small" numberOfLines={1}>
                    {notesStart(item.notes)}
                  </Text>
                ) : null
              }
              leading={
                item.photo_id ? (
                  <PhotoImage
                    id={item.photo_id}
                    label={`Photo of ${item.title}`}
                    placeholder="mark"
                    style={{ width: 56, height: 56, borderRadius: radius.field }}
                  />
                ) : (
                  <View
                    style={{
                      width: 56,
                      height: 56,
                      borderRadius: radius.field,
                      backgroundColor: colors.raised,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Icon name="restaurant-outline" color={colors.muted} />
                  </View>
                )
              }
            />
          ))}
        </View>
      )}
    </Screen>
  );
}
