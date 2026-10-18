import { useQuery } from '@powersync/react';
import { useState } from 'react';
import { withSession } from '../imports/api';
import type { RecipeRecord } from '../recipes/rows';
import { canWrite, type Claims } from '../session/claims';
import { stopShares } from '../sharing/api';
import { Banner, Button, Card, Text } from '../ui';
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
    <Card title="Shared links" level={3}>
      <Text tone="muted">
        {count === 1 ? '1 link shows this recipe' : `${count} links show this recipe`}
      </Text>
      <Button
        variant="danger"
        label="Stop sharing"
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
      />
      {message ? (
        <Banner tone="danger" role="alert">
          {message}
        </Banner>
      ) : null}
    </Card>
  );
}
