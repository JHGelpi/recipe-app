import { Link, router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { BuildFooter } from '../components/BuildFooter';
import { StarButton } from '../components/StarButton';
import { StatusLine } from '../components/StatusLine';
import { useRecipeList } from '../recipes/hooks';
import { canWrite, type Claims } from '../session/claims';
import { useSession } from '../session/SessionProvider';

const link = { textDecorationLine: 'underline' } as const;

export function RecipeListScreen({ claims }: { claims: Claims }) {
  const { signOut } = useSession();
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const recipes = useRecipeList(claims.userId, favoritesOnly);
  const writer = canWrite(claims.role);

  return (
    <View style={{ padding: 16, gap: 12, maxWidth: 640, flex: 1 }}>
      <Text role="heading" aria-level={1} style={{ fontSize: 24, fontWeight: '600' }}>
        Recipes
      </Text>
      <StatusLine />
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
        {(['All', 'Favorites'] as const).map((label) => {
          const selected = (label === 'Favorites') === favoritesOnly;
          return (
            <Pressable
              key={label}
              role="tab"
              aria-selected={selected}
              onPress={() => setFavoritesOnly(label === 'Favorites')}
            >
              <Text style={{ fontWeight: selected ? '700' : '400' }}>{label}</Text>
            </Pressable>
          );
        })}
        <View style={{ flex: 1 }} />
        {writer ? (
          <Link href="/trash" style={link}>
            Trash
          </Link>
        ) : null}
      </View>
      {/* Viewers cannot write: RLS refuses it, and these controls are not rendered. */}
      {writer ? (
        <Pressable
          role="button"
          onPress={() => router.push('/recipe/new')}
          style={{ backgroundColor: '#1a5d3a', borderRadius: 6, padding: 12 }}
        >
          <Text style={{ color: '#fff', fontSize: 16, textAlign: 'center' }}>New recipe</Text>
        </Pressable>
      ) : null}
      {/* Not virtualized: at family scale (hundreds of recipes) every row stays
          in the page; the Search sub-project can revisit this. */}
      <ScrollView style={{ flex: 1 }}>
        {recipes.length === 0 ? (
          <Text>{favoritesOnly ? 'No favorites yet' : 'No recipes yet'}</Text>
        ) : (
          recipes.map((item) => (
            <View
              key={item.id}
              style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 8 }}
            >
              <Pressable style={{ flex: 1 }} onPress={() => router.push(`/recipe/${item.id}`)}>
                <Text style={{ fontSize: 18 }}>{item.title}</Text>
                {item.tags.length > 0 ? (
                  <Text style={{ color: '#666' }}>{item.tags.join(' · ')}</Text>
                ) : null}
              </Pressable>
              <StarButton claims={claims} recipeId={item.id} starred={item.starred} />
            </View>
          ))
        )}
      </ScrollView>
      <Pressable role="button" onPress={() => void signOut()}>
        <Text style={link}>Sign out</Text>
      </Pressable>
      <BuildFooter />
    </View>
  );
}
