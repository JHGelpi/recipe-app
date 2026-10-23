import { usePowerSync } from '@powersync/react';
import { sourceLine, timesLine, type DuplicateMatch, type ShareSnapshot } from '@recipe-app/domain';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, View } from 'react-native';
import { config } from '../config';
import { useNetworkOnline } from '../db/useNetworkOnline';
import { withSession } from '../imports/api';
import { findLocalDuplicates } from '../recipes/duplicates';
import { canWrite } from '../session/claims';
import { useSession } from '../session/SessionProvider';
import { readShare, saveShare, SHARE_MESSAGES } from '../sharing/api';
import { setPendingShare, setSavedFlash, takePendingShare } from '../sharing/pending';
import { colors, radius, space } from '../theme';
import { DuplicateWarning } from '../components/DuplicateWarning';
import { NutritionCard } from '../components/NutritionCard';
import { Banner, Button, Card, LinkedText, Screen, Text } from '../ui';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- Metro asset
const MARK = require('../../assets/brand/mark.png');

/** FR-27: a shared recipe, readable by anyone with the link. */
export function SharedRecipeScreen({ code }: { code: string }) {
  const { state } = useSession();
  const db = usePowerSync();
  const online = useNetworkOnline();
  const [share, setShare] = useState<{
    snapshot: ShareSnapshot;
    hasPhoto: boolean;
    own: boolean;
  } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // FR-14: the household already has this recipe; asked before save_share runs.
  const [duplicates, setDuplicates] = useState<DuplicateMatch[]>([]);
  const [attempt, setAttempt] = useState(0);
  const signedIn = state.status === 'signedIn';

  // Coming back from sign-in for this share: nothing more to do than show it.
  // Taken even offline, so the list does not send the person back here.
  useEffect(() => {
    takePendingShare();
  }, [code]);

  useEffect(() => {
    if (!online) {
      setStatus('offline');
      return;
    }
    let live = true;
    void (async () => {
      // Signed in, the token only tells whether the share is from this household.
      const result =
        (signedIn
          ? await withSession((deps) => readShare(code, deps.fetch, deps.apiUrl, deps.token))
          : null) ?? (await readShare(code, (input, init) => fetch(input, init), config.apiUrl));
      if (!live) return;
      if (result.ok) {
        setShare({ snapshot: result.snapshot, hasPhoto: result.hasPhoto, own: result.own });
        setStatus(null);
      } else {
        setStatus(result.status);
      }
    })();
    return () => {
      live = false;
    };
  }, [code, online, signedIn, attempt]);

  // A phone can report a connection it does not have: try again while it lasts.
  useEffect(() => {
    if (status !== 'offline' || !online) return;
    const timer = setTimeout(() => setAttempt((value) => value + 1), 5_000);
    return () => clearTimeout(timer);
  }, [status, online]);

  async function save(anyway = false) {
    if (!share || saving) return;
    if (state.status !== 'signedIn') {
      setPendingShare({ code, title: share.snapshot.title });
      router.push('/sign-in');
      return;
    }
    if (state.claims && !canWrite(state.claims.role)) {
      setMessage(SHARE_MESSAGES.forbidden!);
      return;
    }
    setSaving(true);
    if (!anyway) {
      // This device holds the household's recipes and the snapshot; nothing new is fetched.
      const matches = await findLocalDuplicates(db, share.snapshot);
      if (matches.length > 0) {
        setDuplicates(matches);
        setSaving(false);
        return;
      }
    }
    setDuplicates([]);
    const result = await withSession((deps) => saveShare(code, deps));
    setSaving(false);
    if (!result?.ok) {
      setMessage(result?.message ?? 'Opening a shared recipe needs a connection');
      return;
    }
    setSavedFlash();
    router.replace(`/recipe/${result.value.recipe_id}`);
  }

  if (status === 'offline')
    return (
      <Screen>
        <Text>Opening a shared recipe needs a connection</Text>
      </Screen>
    );
  if (status === 'error')
    return (
      <Screen>
        <Text>Couldn't load this page. Try again.</Text>
        <Button label="Try again" onPress={() => setAttempt((value) => value + 1)} />
      </Screen>
    );
  if (status)
    return (
      <Screen>
        <Text>This recipe is no longer shared</Text>
      </Screen>
    );
  if (!share) return <ActivityIndicator color={colors.accent} style={{ padding: space.lg }} />;
  const recipe = share.snapshot;
  const times = timesLine(recipe);
  const source = sourceLine(recipe);
  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Image source={MARK} aria-hidden style={{ width: 32, height: 32 }} />
        <Text variant="h3">Dishkept</Text>
      </View>
      <View style={{ gap: space.xs }}>
        <Text role="heading" aria-level={1} variant="h1">
          {recipe.title}
        </Text>
        <Text tone="muted">Shared from the {recipe.household_name}</Text>
      </View>
      {share.hasPhoto ? (
        <Image
          source={{ uri: `${config.apiUrl}/shares/${encodeURIComponent(code)}/photo` }}
          accessibilityLabel="Dish photo"
          resizeMode="cover"
          style={{ width: '100%', aspectRatio: 4 / 3, borderRadius: radius.card }}
        />
      ) : null}
      {times ? <Text tone="muted">{times}</Text> : null}
      {share.own ? (
        <Banner>{SHARE_MESSAGES.own_household!}</Banner>
      ) : (
        <Button
          full
          label="Save to my recipes"
          aria-disabled={saving}
          disabled={saving}
          onPress={() => void save()}
        />
      )}
      <DuplicateWarning matches={duplicates}>
        <Button
          variant="secondary"
          label="Save anyway"
          aria-disabled={saving}
          onPress={() => void save(true)}
        />
        <Button variant="ghost" label="Cancel" onPress={() => setDuplicates([])} />
      </DuplicateWarning>
      {message ? (
        <Banner tone="danger" role="alert">
          {message}
        </Banner>
      ) : null}
      {recipe.ingredients.length > 0 ? (
        <Card title="Ingredients">
          {recipe.ingredients.map((item) => (
            <Text
              key={item.id}
              variant={item.heading ? 'h3' : 'body'}
              style={item.heading ? { marginTop: space.sm } : undefined}
            >
              {item.raw}
            </Text>
          ))}
        </Card>
      ) : null}
      {recipe.steps.length > 0 ? (
        <Card title="Steps">
          {recipe.steps.map((step, index) => (
            <Text key={step.id}>
              {index + 1}. {step.text}
            </Text>
          ))}
        </Card>
      ) : null}
      <NutritionCard nutrition={recipe.nutrition} />
      {recipe.notes ? (
        <Card title="Notes">
          <LinkedText>{recipe.notes}</LinkedText>
        </Card>
      ) : null}
      {source ? <Text tone="muted">{source}</Text> : null}
    </Screen>
  );
}
