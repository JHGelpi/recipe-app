import { sourceLine, timesLine, type ShareSnapshot } from '@recipe-app/domain';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, Text, View } from 'react-native';
import { config } from '../config';
import { useNetworkOnline } from '../db/useNetworkOnline';
import { withSession } from '../imports/api';
import { canWrite } from '../session/claims';
import { useSession } from '../session/SessionProvider';
import { readShare, saveShare, SHARE_MESSAGES } from '../sharing/api';
import { setPendingShare, setSavedFlash, takePendingShare } from '../sharing/pending';

const heading = { fontSize: 18, fontWeight: '600' } as const;

/** FR-27: a shared recipe, readable by anyone with the link. */
export function SharedRecipeScreen({ code }: { code: string }) {
  const { state } = useSession();
  const online = useNetworkOnline();
  const [share, setShare] = useState<{ snapshot: ShareSnapshot; hasPhoto: boolean } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!online) {
      setStatus('offline');
      return;
    }
    void readShare(code, (input, init) => fetch(input, init), config.apiUrl).then((result) => {
      if (result.ok) setShare({ snapshot: result.snapshot, hasPhoto: result.hasPhoto });
      else setStatus(result.status);
    });
    // Coming back from sign-in for this share: nothing more to do than show it.
    takePendingShare();
  }, [code, online]);

  async function save() {
    if (!share) return;
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
    return <Text style={{ padding: 16 }}>Opening a shared recipe needs a connection</Text>;
  if (status) return <Text style={{ padding: 16 }}>This recipe is no longer shared</Text>;
  if (!share) return <ActivityIndicator style={{ padding: 16 }} />;
  const recipe = share.snapshot;
  const times = timesLine(recipe);
  const source = sourceLine(recipe);
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12, maxWidth: 640 }}>
      <Text role="heading" aria-level={1} style={{ fontSize: 24, fontWeight: '600' }}>
        {recipe.title}
      </Text>
      <Text style={{ color: '#555' }}>Shared from the {recipe.household_name}</Text>
      {share.hasPhoto ? (
        <Image
          source={{ uri: `${config.apiUrl}/shares/${encodeURIComponent(code)}/photo` }}
          accessibilityLabel="Dish photo"
          resizeMode="cover"
          style={{ width: '100%', aspectRatio: 4 / 3, borderRadius: 6 }}
        />
      ) : null}
      {times ? <Text>{times}</Text> : null}
      <Pressable
        role="button"
        aria-disabled={saving}
        disabled={saving}
        onPress={() => void save()}
        style={{
          backgroundColor: '#1a5d3a',
          borderRadius: 8,
          minHeight: 44,
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <Text style={{ color: '#fff', fontSize: 16 }}>Save to my recipes</Text>
      </Pressable>
      {message ? <Text role="alert">{message}</Text> : null}
      {recipe.ingredients.length > 0 ? (
        <View style={{ gap: 4 }}>
          <Text role="heading" aria-level={2} style={heading}>
            Ingredients
          </Text>
          {recipe.ingredients.map((item) => (
            <Text
              key={item.id}
              style={item.heading ? { fontWeight: '600', marginTop: 6 } : undefined}
            >
              {item.raw}
            </Text>
          ))}
        </View>
      ) : null}
      {recipe.steps.length > 0 ? (
        <View style={{ gap: 6 }}>
          <Text role="heading" aria-level={2} style={heading}>
            Steps
          </Text>
          {recipe.steps.map((step, index) => (
            <Text key={step.id}>
              {index + 1}. {step.text}
            </Text>
          ))}
        </View>
      ) : null}
      {recipe.notes ? (
        <View style={{ gap: 4 }}>
          <Text role="heading" aria-level={2} style={heading}>
            Notes
          </Text>
          <Text>{recipe.notes}</Text>
        </View>
      ) : null}
      {source ? <Text style={{ color: '#555' }}>{source}</Text> : null}
    </ScrollView>
  );
}
