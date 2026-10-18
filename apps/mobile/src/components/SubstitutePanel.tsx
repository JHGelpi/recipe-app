import { usePowerSync } from '@powersync/react';
import {
  isStale,
  substitutionNoteLine,
  type Ingredient,
  type SubstitutionAnswer,
} from '@recipe-app/domain';
import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useNetworkOnline } from '../db/useNetworkOnline';
import { withSession } from '../imports/api';
import { canWrite, type Claims } from '../session/claims';
import { askSubstitutes } from '../substitutions/api';
import { addSubstitutionToNotes } from '../substitutions/repository';
import type { SubstitutionRecord } from '../substitutions/rows';
import { colors, radius, space } from '../theme';
import { Banner, Button, Text } from '../ui';

/** Half-second checks for queued uploads before asking (10 s). */
const UPLOAD_WAIT_TRIES = 20;

/** FR-24, FR-25: substitutes for one ingredient, remembered or asked for. */
export function SubstitutePanel({
  claims,
  recipeId,
  ingredient,
  remembered,
  scaled,
}: {
  claims: Claims;
  recipeId: string;
  ingredient: Ingredient;
  remembered: SubstitutionRecord | null;
  scaled: boolean;
}) {
  const db = usePowerSync();
  const online = useNetworkOnline();
  const writer = canWrite(claims.role);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The answer just returned shows at once; the synced row agrees shortly.
  const [fresh, setFresh] = useState<{ answer: SubstitutionAnswer; raw: string } | null>(null);
  const answer = fresh?.answer ?? remembered?.answer ?? null;
  const askedFor = fresh?.raw ?? remembered?.ingredient_raw ?? ingredient.raw;
  const stale = remembered !== null && fresh === null && isStale(remembered, ingredient);

  async function ask() {
    setAsking(true);
    setError(null);
    // The server reads the recipe it has: let this phone's edits reach it first.
    for (let tries = 0; tries < UPLOAD_WAIT_TRIES; tries++) {
      if ((await db.getUploadQueueStats()).count === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const result = await withSession((deps) =>
      askSubstitutes(
        { id: crypto.randomUUID(), recipe_id: recipeId, ingredient_id: ingredient.id },
        deps,
      ),
    );
    setAsking(false);
    if (!result) setError("Couldn't get substitutes. Try again.");
    else if (result.kind === 'error') setError(result.message);
    else setFresh({ answer: result.answer, raw: result.ingredient_raw });
  }

  async function addToNotes(line: string) {
    const outcome = await addSubstitutionToNotes(db, claims, recipeId, line);
    setNotice(
      outcome === 'added' ? 'Added to notes' : outcome === 'full' ? 'Notes are full' : null,
    );
  }

  return (
    <View
      style={{
        gap: space.sm,
        backgroundColor: colors.raised,
        borderRadius: radius.field,
        padding: space.md,
      }}
    >
      {answer ? (
        <>
          {stale ? <Text tone="tag">This was for {askedFor}</Text> : null}
          {scaled ? <Text tone="muted">For the original amount</Text> : null}
          {answer.options.map((option, index) => (
            <View key={index} style={{ gap: 2 }}>
              <Text variant="h3">{option.substitute}</Text>
              <Text>{option.amount}</Text>
              {option.how ? <Text tone="muted">{option.how}</Text> : null}
              <Text tone="muted">{option.effect}</Text>
              {writer ? (
                <Button
                  variant="ghost"
                  label="Add to notes"
                  onPress={() => void addToNotes(substitutionNoteLine(askedFor, option))}
                />
              ) : null}
            </View>
          ))}
          {answer.note ? <Text>{answer.note}</Text> : null}
        </>
      ) : null}
      {asking ? (
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <ActivityIndicator size="small" color={colors.accent} />
          <Text>Finding substitutes…</Text>
        </View>
      ) : writer && online ? (
        <Button
          variant={answer ? 'secondary' : 'primary'}
          label={answer ? 'Ask again' : 'Ask for substitutes'}
          onPress={() => void ask()}
        />
      ) : !answer ? (
        <Text>{writer ? 'Substitutions need a connection.' : 'No substitutes saved yet.'}</Text>
      ) : null}
      {error ? (
        <Banner tone="danger" role="alert">
          {error}
        </Banner>
      ) : null}
      {notice ? <Text aria-live="polite">{notice}</Text> : null}
    </View>
  );
}
