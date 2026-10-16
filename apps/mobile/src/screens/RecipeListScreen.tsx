import { FlatList, Pressable, Text, View } from 'react-native';
import { AddRecipeForm } from '../components/AddRecipeForm';
import { StatusLine } from '../components/StatusLine';
import { useRecipes } from '../recipes/useRecipes';
import { canWrite, type Claims } from '../session/claims';
import { useSession } from '../session/SessionProvider';

export function RecipeListScreen({ claims }: { claims: Claims | null }) {
  const { signOut } = useSession();
  const { data: recipes } = useRecipes();

  return (
    <View style={{ padding: 16, gap: 12, maxWidth: 640 }}>
      <Text role="heading" aria-level={1} style={{ fontSize: 24, fontWeight: '600' }}>
        Recipes
      </Text>
      <StatusLine />
      {claims === null ? (
        <Text role="alert">
          Your account is not linked to a household. Sign out and back in; if this continues,
          contact your household admin.
        </Text>
      ) : (
        <>
          {/* Viewers cannot write: RLS refuses it, and the form is not rendered. */}
          {canWrite(claims.role) ? <AddRecipeForm claims={claims} /> : null}
          <FlatList
            data={recipes}
            keyExtractor={(recipe) => recipe.id}
            renderItem={({ item }) => (
              <Text style={{ fontSize: 18, paddingVertical: 8 }}>{item.title}</Text>
            )}
            ListEmptyComponent={<Text>No recipes yet</Text>}
          />
        </>
      )}
      <Pressable role="button" onPress={() => void signOut()}>
        <Text style={{ textDecorationLine: 'underline' }}>Sign out</Text>
      </Pressable>
    </View>
  );
}
