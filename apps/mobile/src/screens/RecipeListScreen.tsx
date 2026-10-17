import { Link, router } from 'expo-router';
import { useDeferredValue, useState } from 'react';
import { FlatList, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { PhotoImage } from '../components/PhotoImage';
import { BuildFooter } from '../components/BuildFooter';
import { StarButton } from '../components/StarButton';
import { StatusLine } from '../components/StatusLine';
import { useReadyCount } from '../imports/hooks';
import { useRecipeSearch } from '../recipes/hooks';
import { canWrite, type Claims } from '../session/claims';
import { useSession } from '../session/SessionProvider';

const link = { textDecorationLine: 'underline' } as const;
const green = '#1a5d3a';

export function RecipeListScreen({ claims }: { claims: Claims }) {
  const { signOut } = useSession();
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  // Typing stays smooth even when the results take a moment to re-render.
  const deferredQuery = useDeferredValue(query);
  const { items, tags } = useRecipeSearch(claims.userId, favoritesOnly, deferredQuery, selected);
  const writer = canWrite(claims.role);
  const ready = useReadyCount();
  const filtering = query.trim() !== '' || selected.length > 0;
  const chips = [...selected, ...tags.filter((tag) => !selected.includes(tag))];

  function toggle(tag: string) {
    setSelected((current) =>
      current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag],
    );
  }

  function clear() {
    setQuery('');
    setSelected([]);
  }

  return (
    <View style={{ padding: 16, gap: 12, maxWidth: 640, flex: 1 }}>
      <Text role="heading" aria-level={1} style={{ fontSize: 24, fontWeight: '600' }}>
        Recipes
      </Text>
      <StatusLine />
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          borderWidth: 1,
          borderColor: '#888',
          borderRadius: 6,
        }}
      >
        <TextInput
          aria-label="Search recipes"
          placeholder="Search recipes"
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
          style={{ flex: 1, padding: 10, fontSize: 16 }}
        />
        {query ? (
          <Pressable
            role="button"
            aria-label="Clear search text"
            hitSlop={8}
            onPress={() => setQuery('')}
            style={{ paddingHorizontal: 12 }}
          >
            <Text>✕</Text>
          </Pressable>
        ) : null}
      </View>
      {chips.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 6 }}
        >
          {chips.map((tag) => {
            const on = selected.includes(tag);
            return (
              <Pressable
                key={tag}
                role="button"
                aria-label={`Tag ${tag}`}
                aria-pressed={on}
                onPress={() => toggle(tag)}
                style={{
                  borderWidth: 1,
                  borderColor: green,
                  backgroundColor: on ? green : 'transparent',
                  borderRadius: 12,
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                }}
              >
                <Text style={{ color: on ? '#fff' : green }}>{tag}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
        {(['All', 'Favorites'] as const).map((label) => {
          const isSelected = (label === 'Favorites') === favoritesOnly;
          return (
            <Pressable
              key={label}
              role="tab"
              aria-selected={isSelected}
              onPress={() => setFavoritesOnly(label === 'Favorites')}
            >
              <Text style={{ fontWeight: isSelected ? '700' : '400' }}>{label}</Text>
            </Pressable>
          );
        })}
        <View style={{ flex: 1 }} />
        {filtering && items.length > 0 ? (
          <Text aria-live="polite">
            {items.length === 1 ? '1 recipe' : `${items.length} recipes`}
          </Text>
        ) : null}
        {writer ? (
          <Link href="/trash" style={link}>
            Trash
          </Link>
        ) : null}
      </View>
      {/* Viewers cannot write: RLS refuses it, and these controls are not rendered. */}
      {writer ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Pressable
            role="button"
            onPress={() => router.push('/recipe/new')}
            style={{ backgroundColor: green, borderRadius: 6, padding: 12, flex: 1 }}
          >
            <Text style={{ color: '#fff', fontSize: 16, textAlign: 'center' }}>New recipe</Text>
          </Pressable>
          <Pressable
            role="button"
            aria-label={ready > 0 ? `Import, ${ready} ready` : 'Import'}
            onPress={() => router.push('/import')}
            style={{ borderWidth: 1, borderColor: green, borderRadius: 6, padding: 12, flex: 1 }}
          >
            <Text style={{ color: green, fontSize: 16, textAlign: 'center' }}>
              {ready > 0 ? `Import · ${ready} ready` : 'Import'}
            </Text>
          </Pressable>
        </View>
      ) : null}
      <FlatList
        style={{ flex: 1 }}
        data={items}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 8 }}>
            {item.photoId ? (
              <PhotoImage
                id={item.photoId}
                label={`Photo of ${item.title}`}
                style={{ width: 48, height: 48, borderRadius: 4 }}
              />
            ) : null}
            <Pressable style={{ flex: 1 }} onPress={() => router.push(`/recipe/${item.id}`)}>
              <Text style={{ fontSize: 18 }}>{item.title}</Text>
              {item.tags.length > 0 ? (
                <Text style={{ color: '#666' }}>{item.tags.join(' · ')}</Text>
              ) : null}
            </Pressable>
            <StarButton claims={claims} recipeId={item.id} starred={item.starred} />
          </View>
        )}
        ListEmptyComponent={
          filtering ? (
            <View style={{ gap: 8 }}>
              <Text>No recipes match</Text>
              <Pressable role="button" onPress={clear}>
                <Text style={link}>Clear search</Text>
              </Pressable>
            </View>
          ) : (
            <Text>{favoritesOnly ? 'No favorites yet' : 'No recipes yet'}</Text>
          )
        }
      />
      <Pressable role="button" onPress={() => void signOut()}>
        <Text style={link}>Sign out</Text>
      </Pressable>
      <BuildFooter />
    </View>
  );
}
