import { usePowerSync } from '@powersync/react';
import { Link, router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { confirm } from '../components/confirm';
import { useNetworkOnline } from '../db/useNetworkOnline';
import { requestParse, withSession } from '../imports/api';
import { importSourceFrom } from '../imports/form';
import { useAiUsage, useImports } from '../imports/hooks';
import { createImport, dismissImport } from '../imports/repository';
import { importPreview } from '../imports/rows';
import { formatUsd, importView } from '../imports/status';
import { canWrite, type Claims } from '../session/claims';

const green = '#1a5d3a';
const link = { textDecorationLine: 'underline' } as const;
const input = {
  borderWidth: 1,
  borderColor: '#888',
  borderRadius: 6,
  padding: 10,
  fontSize: 16,
} as const;

/** FR-8, FR-9, FR-29: paste text or a link; follow imports until they are ready to review. */
export function ImportScreen({ claims }: { claims: Claims }) {
  const db = usePowerSync();
  const online = useNetworkOnline();
  const imports = useImports();
  const usage = useAiUsage(online, imports.map((item) => `${item.id}:${item.status}`).join());
  const [kind, setKind] = useState<'text' | 'url'>('text');
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!canWrite(claims.role)) {
    return <Text style={{ padding: 16 }}>Viewers cannot import recipes.</Text>;
  }
  const value = kind === 'text' ? text : url;
  const empty = value.trim() === '';

  async function submit() {
    if (busy || empty) return;
    const result = importSourceFrom(kind, value);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createImport(db, claims, result.source);
      if (kind === 'text') setText('');
      else setUrl('');
      setNotice(online ? 'Reading your recipe…' : "Saved. It'll be read when you're back online.");
    } catch {
      setError('Could not save the import. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function retry(id: string) {
    const outcome = await withSession((deps) => requestParse(id, deps));
    if (outcome !== 'started' && outcome !== 'busy') {
      setNotice("Couldn't start it again. Check your connection and try again.");
    }
  }

  async function dismiss(id: string) {
    if (await confirm('Dismiss this import?')) await dismissImport(db, claims, id);
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12, maxWidth: 640 }}>
      <Link href="/" style={link}>
        All recipes
      </Link>
      <Text role="heading" aria-level={1} style={{ fontSize: 24, fontWeight: '600' }}>
        Import a recipe
      </Text>
      <View style={{ flexDirection: 'row', gap: 16 }}>
        {(['text', 'url'] as const).map((option) => (
          <Pressable
            key={option}
            role="tab"
            aria-selected={kind === option}
            onPress={() => {
              setKind(option);
              setError(null);
            }}
          >
            <Text style={{ fontWeight: kind === option ? '700' : '400' }}>
              {option === 'text' ? 'Paste text' : 'Paste link'}
            </Text>
          </Pressable>
        ))}
      </View>
      {kind === 'text' ? (
        <TextInput
          aria-label="Recipe text"
          placeholder="Paste a recipe from Notes, a message, or a comment"
          value={text}
          onChangeText={setText}
          multiline
          numberOfLines={10}
          textAlignVertical="top"
          style={{ ...input, minHeight: 180 }}
        />
      ) : (
        <TextInput
          aria-label="Recipe link"
          placeholder="https://"
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          inputMode="url"
          style={input}
        />
      )}
      {error ? (
        <Text role="alert" style={{ color: '#b00020' }}>
          {error}
        </Text>
      ) : null}
      <Pressable
        role="button"
        aria-disabled={busy || empty}
        onPress={() => void submit()}
        style={{ backgroundColor: empty ? '#999' : green, borderRadius: 6, padding: 12 }}
      >
        <Text style={{ color: '#fff', fontSize: 16, textAlign: 'center' }}>Import recipe</Text>
      </Pressable>
      {notice ? <Text aria-live="polite">{notice}</Text> : null}
      <Text>
        AI this month: {usage ? `${formatUsd(usage.spentUsd)} of ${formatUsd(usage.capUsd)}` : '–'}
      </Text>

      {imports.length > 0 ? (
        <Text role="heading" aria-level={2} style={{ fontSize: 18, fontWeight: '600' }}>
          Imports
        </Text>
      ) : null}
      {imports.map((item) => {
        const view = importView(item, online);
        return (
          <View
            key={item.id}
            style={{ gap: 4, borderTopWidth: 1, borderColor: '#ddd', paddingTop: 8 }}
          >
            <Text numberOfLines={1} style={{ fontSize: 16 }}>
              {importPreview(item)}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {view.busy ? <ActivityIndicator size="small" /> : null}
              <Text style={{ color: '#444', flex: 1 }}>{view.label}</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 16 }}>
              {view.canReview ? (
                <Pressable role="button" onPress={() => router.push(`/import/${item.id}`)}>
                  <Text style={{ ...link, color: green, fontWeight: '600' }}>Review</Text>
                </Pressable>
              ) : null}
              {view.canRetry ? (
                <Pressable role="button" onPress={() => void retry(item.id)}>
                  <Text style={link}>Try again</Text>
                </Pressable>
              ) : null}
              {!view.busy ? (
                <Pressable role="button" onPress={() => void dismiss(item.id)}>
                  <Text style={{ ...link, color: '#b00020' }}>Dismiss</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}
