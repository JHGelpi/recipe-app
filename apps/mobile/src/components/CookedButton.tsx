import { usePowerSync } from '@powersync/react';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { logCooked } from '../cooklog/repository';
import { canWrite, type Claims } from '../session/claims';
import { Banner, Button } from '../ui';

/**
 * FR-37: one tap logs today's meal. The confirmation offers notes and photos,
 * which can be skipped. Admins and members only (rule 4).
 */
export function CookedButton({
  claims,
  recipe,
  large,
}: {
  claims: Claims;
  recipe: { id: string; title: string };
  large?: boolean;
}) {
  const db = usePowerSync();
  const [logging, setLogging] = useState(false);
  const busy = useRef(false);
  const [entryId, setEntryId] = useState<string | null>(null);
  if (!canWrite(claims.role)) return null;

  if (entryId) {
    return (
      <Banner
        action={
          <Button
            variant="ghost"
            label="Add notes or photos"
            onPress={() => router.push(`/diary/${entryId}`)}
          />
        }
      >
        Logged in your cook diary
      </Banner>
    );
  }
  return (
    <Button
      variant="secondary"
      icon="checkmark-circle-outline"
      label="I cooked this"
      large={large}
      disabled={logging}
      onPress={async () => {
        // One entry per tap: a double tap must not log the meal twice.
        if (busy.current) return;
        busy.current = true;
        setLogging(true);
        try {
          setEntryId(await logCooked(db, claims, recipe));
        } finally {
          busy.current = false;
          setLogging(false);
        }
      }}
    />
  );
}
