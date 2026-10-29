import { useDeferredValue, useState } from 'react';
import { FlatList, View } from 'react-native';
import { BuildFooter } from '../components/BuildFooter';
import { HouseholdNoticeBanner } from '../components/HouseholdNoticeBanner';
import { FavoriteButton } from '../components/FavoriteButton';
import { SortSheet } from '../components/SortSheet';
import { StatusLine } from '../components/StatusLine';
import { RatingMeta } from '../components/Rating';
import { durationLabel } from '../recipes/duration';
import { useRecipeSearch } from '../recipes/hooks';
import {
  clearFilter,
  setFilter,
  setSort,
  toggleTag,
  useListFilter,
  useListSort,
} from '../recipes/listFilter';
import { isSearching, sortLabel } from '../recipes/listItems';
import type { Claims } from '../session/claims';
import { Thumb } from '../components/Thumb';
import { colors, space } from '../theme';
import { Button, Chip, ChipBar, Icon, IconButton, RowCard, Screen, Text, TextField } from '../ui';

/** FR-15, FR-19, FR-20, FR-49: the household's recipes, or the user's favorites. */
export function RecipeListScreen({
  claims,
  favoritesOnly = false,
}: {
  claims: Claims;
  favoritesOnly?: boolean;
}) {
  const { query, selected } = useListFilter();
  const sort = useListSort();
  const [sorting, setSorting] = useState(false);
  // Typing stays smooth even when the results take a moment to re-render.
  const deferredQuery = useDeferredValue(query);
  const { items, tags, total } = useRecipeSearch(
    claims.userId,
    favoritesOnly,
    deferredQuery,
    selected,
    sort,
  );
  const sortText = sortLabel(deferredQuery, sort);
  // From the query the results used, so clearing a no-match search never
  // flashes the empty-list text before the results catch up.
  const filtering = deferredQuery.trim() !== '' || selected.length > 0;
  const chips = [...selected, ...tags.filter((tag) => !selected.includes(tag))];

  return (
    <Screen scroll={false}>
      <View style={{ gap: space.xs }}>
        <Text role="heading" aria-level={1} variant="h1">
          {favoritesOnly ? 'Favorites' : 'Recipes'}
        </Text>
        <StatusLine />
      </View>
      <HouseholdNoticeBanner claims={claims} />
      <TextField
        label="Search recipes"
        hideLabel
        placeholder="Search recipes"
        icon="search"
        value={query}
        onChangeText={(text) => setFilter({ query: text })}
        returnKeyType="search"
        autoCapitalize="none"
        autoCorrect={false}
        trailing={
          query ? (
            <IconButton
              icon="close"
              label="Clear search text"
              tone="muted"
              size={18}
              onPress={() => setFilter({ query: '' })}
            />
          ) : null
        }
      />
      {chips.length > 0 ? (
        <ChipBar label="Tags">
          {chips.map((tag) => (
            <Chip
              key={tag}
              label={tag}
              tone={selected.includes(tag) ? 'selected' : 'neutral'}
              aria-label={`Tag ${tag}`}
              aria-pressed={selected.includes(tag)}
              onPress={() => toggleTag(tag)}
            />
          ))}
        </ChipBar>
      ) : null}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: space.sm,
        }}
      >
        {/* Always mounted, so screen readers announce each change. */}
        <Text variant="small" tone="muted" aria-live="polite" style={{ flexShrink: 1 }}>
          {filtering && items.length > 0
            ? items.length === 1
              ? '1 recipe'
              : `${items.length} recipes`
            : ''}
        </Text>
        {total >= 2 ? (
          <Button
            variant="ghost"
            label={`${sortText} ▾`}
            aria-label={sortText}
            aria-haspopup="menu"
            disabled={isSearching(deferredQuery)}
            onPress={() => setSorting(true)}
          />
        ) : null}
      </View>
      <FlatList
        style={{ flex: 1 }}
        data={items}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: space.sm, paddingBottom: space.xl }}
        renderItem={({ item }) => (
          <RowCard
            title={item.title}
            href={`/recipe/${item.id}`}
            leading={<Thumb photoId={item.photoId} label={`Photo of ${item.title}`} />}
            meta={
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space.sm,
                  marginTop: space.xs,
                }}
              >
                {item.tags[0] ? <Chip label={item.tags[0]} tone="tag" /> : null}
                <RatingMeta summary={item.rating} />
                {item.totalMinutes !== null ? (
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: space.xs,
                      flexShrink: 0,
                    }}
                  >
                    <Icon name="time-outline" size={14} color={colors.muted} />
                    <Text variant="caption" tone="muted">
                      {durationLabel(item.totalMinutes)}
                    </Text>
                  </View>
                ) : null}
              </View>
            }
            trailing={<FavoriteButton claims={claims} recipeId={item.id} favorite={item.starred} />}
          />
        )}
        ListEmptyComponent={
          filtering ? (
            <View style={{ gap: space.sm }}>
              <Text>No recipes match</Text>
              <Button variant="ghost" label="Clear search" onPress={clearFilter} />
            </View>
          ) : (
            <Text tone="muted">{favoritesOnly ? 'No favorites yet' : 'No recipes yet'}</Text>
          )
        }
        ListFooterComponent={<BuildFooter />}
      />
      <SortSheet open={sorting} sort={sort} onPick={setSort} onClose={() => setSorting(false)} />
    </Screen>
  );
}
