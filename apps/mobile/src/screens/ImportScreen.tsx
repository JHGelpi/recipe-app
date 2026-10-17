import { usePowerSync } from '@powersync/react';
import { Link, router } from 'expo-router';
import { PAGE_EDGE, PHOTO_LIMITS } from '@recipe-app/domain';
import { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { confirm } from '../components/confirm';
import { PhotoImage } from '../components/PhotoImage';
import { useNetworkOnline } from '../db/useNetworkOnline';
import { requestParse, withSession } from '../imports/api';
import { importSourceFrom } from '../imports/form';
import { useAiUsage, useImports } from '../imports/hooks';
import { createImport, createPhotoImport, dismissImport } from '../imports/repository';
import { importPreview } from '../imports/rows';
import { formatUsd, importView } from '../imports/status';
import { pickPhotos } from '../photos/pick';
import { PhotoReadError, preparePhoto } from '../photos/prepare';
import { photoSaver } from '../photos/queue';
import type { PhotoFile } from '../photos/repository';
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

/** FR-7, FR-8, FR-9, FR-29: photos, pasted text or a link; follow imports until they are ready to review. */
export function ImportScreen({ claims }: { claims: Claims }) {
  const db = usePowerSync();
  const online = useNetworkOnline();
  const imports = useImports();
  const usage = useAiUsage(online, imports.map((item) => `${item.id}:${item.status}`).join());
  const [kind, setKind] = useState<'text' | 'url' | 'photo'>('text');
  const [pages, setPages] = useState<(PhotoFile & { preview: string })[]>([]);
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!canWrite(claims.role)) {
    return <Text style={{ padding: 16 }}>Viewers cannot import recipes.</Text>;
  }
  const value = kind === 'text' ? text : url;
  const empty = kind === 'photo' ? pages.length === 0 : value.trim() === '';

  async function addPages() {
    const files = await pickPhotos(true);
    setError(null);
    for (const file of files.slice(0, PHOTO_LIMITS.pages - pages.length)) {
      try {
        const prepared = await preparePhoto(file, PAGE_EDGE);
        setPages((list) =>
          list.length < PHOTO_LIMITS.pages
            ? [...list, { ...prepared, preview: URL.createObjectURL(prepared.blob) }]
            : list,
        );
      } catch (caught) {
        setError(caught instanceof PhotoReadError ? caught.message : 'Could not add that photo.');
      }
    }
  }

  function movePage(from: number, to: number) {
    setPages((list) => {
      const next = [...list];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved!);
      return next;
    });
  }

  function removePage(index: number) {
    setPages((list) => {
      URL.revokeObjectURL(list[index]!.preview);
      return list.filter((_, i) => i !== index);
    });
  }

  async function submit() {
    if (busy || empty) return;
    if (kind === 'photo') {
      setBusy(true);
      setError(null);
      try {
        await createPhotoImport(db, photoSaver(db), claims, pages);
        pages.forEach((page) => URL.revokeObjectURL(page.preview));
        setPages([]);
        setNotice(
          online ? 'Reading your recipe…' : "Saved. It'll be read when you're back online.",
        );
      } catch {
        setError('Could not save the import. Try again.');
      } finally {
        setBusy(false);
      }
      return;
    }
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
        {(['text', 'url', 'photo'] as const).map((option) => (
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
              {{ text: 'Paste text', url: 'Paste link', photo: 'Photo' }[option]}
            </Text>
          </Pressable>
        ))}
      </View>
      {kind === 'photo' ? (
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {pages.map((page, index) => (
              <View key={page.preview} style={{ gap: 4, alignItems: 'center' }}>
                <Image
                  source={{ uri: page.preview }}
                  accessibilityLabel={`Page ${index + 1}`}
                  style={{ width: 90, height: 120, borderRadius: 4 }}
                />
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {index > 0 ? (
                    <Pressable
                      role="button"
                      aria-label={`Move page ${index + 1} left`}
                      onPress={() => movePage(index, index - 1)}
                    >
                      <Text>◀</Text>
                    </Pressable>
                  ) : null}
                  <Pressable
                    role="button"
                    aria-label={`Remove page ${index + 1}`}
                    onPress={() => removePage(index)}
                  >
                    <Text style={{ color: '#b00020' }}>✕</Text>
                  </Pressable>
                  {index < pages.length - 1 ? (
                    <Pressable
                      role="button"
                      aria-label={`Move page ${index + 1} right`}
                      onPress={() => movePage(index, index + 1)}
                    >
                      <Text>▶</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            ))}
          </View>
          {pages.length < PHOTO_LIMITS.pages ? (
            <Pressable role="button" onPress={() => void addPages()}>
              <Text style={{ ...link, color: green, fontWeight: '600' }}>Add page</Text>
            </Pressable>
          ) : null}
        </View>
      ) : kind === 'text' ? (
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
            {item.source_type === 'photo' && item.firstPage ? (
              <PhotoImage
                id={item.firstPage}
                label="First page"
                style={{ width: 48, height: 64, borderRadius: 4 }}
              />
            ) : null}
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
