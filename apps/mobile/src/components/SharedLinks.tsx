import { useQuery } from '@powersync/react';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { withSession } from '../imports/api';
import type { RecipeRecord } from '../recipes/rows';
import { canWrite, type Claims } from '../session/claims';
import { stopShares } from '../sharing/api';
import { confirm } from './confirm';

/** FR-27: how many links point at this recipe, and Stop sharing (admins and members). */
export function SharedLinks({ claims, recipe }: { claims: Claims; recipe: RecipeRecord }) {
  const { data } = useQuery<{ n: number }>(
    'select count(*) as n from shares where recipe_id = ? and deleted_at is null',
    [recipe.id],
  );
  const [message, setMessage] = useState<string | null>(null);
  const count = Number(data[0]?.n ?? 0);
  if (count === 0 || !canWrite(claims.role)) return null;
  return (
    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <Text>Shared links: {count} · </Text>
      <Pressable
        role="button"
        style={{ minHeight: 44, justifyContent: 'center' }}
        onPress={async () => {
          if (
            !(await confirm(
              `Stop sharing ${recipe.title}? Anyone with a link will no longer see it.`,
            ))
          )
            return;
          const result = await withSession((deps) => stopShares(recipe.id, deps));
          setMessage(result?.ok ? null : (result?.message ?? 'Sharing a link needs a connection'));
        }}
      >
        <Text style={{ textDecorationLine: 'underline', color: '#b00020' }}>Stop sharing</Text>
      </Pressable>
      {message ? <Text role="alert">{message}</Text> : null}
    </View>
  );
}
