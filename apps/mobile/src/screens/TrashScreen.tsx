import { usePowerSync } from '@powersync/react';
import { Link, Redirect } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useTrash } from '../recipes/hooks';
import { restoreRecipe } from '../recipes/repository';
import { trashDaysLeft } from '../recipes/rows';
import { canWrite, type Claims } from '../session/claims';

function deletesIn(days: number): string {
  if (days <= 0) return 'Deletes soon';
  return days === 1 ? 'Deletes in 1 day' : `Deletes in ${days} days`;
}

export function TrashScreen({ claims }: { claims: Claims }) {
  const db = usePowerSync();
  const items = useTrash();
  if (!canWrite(claims.role)) return <Redirect href="/" />;
  const now = Date.now();

  return (
    <View style={{ padding: 16, gap: 12, maxWidth: 640, flex: 1 }}>
      <Link href="/" style={{ textDecorationLine: 'underline' }}>
        All recipes
      </Link>
      <Text role="heading" aria-level={1} style={{ fontSize: 24, fontWeight: '600' }}>
        Trash
      </Text>
      <Text>Recipes here are deleted for good 30 days after they were moved to the Trash.</Text>
      <ScrollView style={{ flex: 1 }}>
        {items.length === 0 ? (
          <Text>The Trash is empty</Text>
        ) : (
          items.map((item) => (
            <View
              key={item.id}
              style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 8 }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 18 }}>{item.title}</Text>
                <Text style={{ color: '#666' }}>
                  {deletesIn(trashDaysLeft(item.deleted_at, now))}
                </Text>
              </View>
              <Pressable
                role="button"
                aria-label={`Restore ${item.title}`}
                onPress={() => void restoreRecipe(db, claims, item.id)}
              >
                <Text style={{ textDecorationLine: 'underline' }}>Restore</Text>
              </Pressable>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}
