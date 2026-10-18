import { usePowerSync } from '@powersync/react';
import { router } from 'expo-router';
import { PAGE_EDGE, PHOTO_LIMITS } from '@recipe-app/domain';
import { useState } from 'react';
import { ActivityIndicator, Image, View } from 'react-native';
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
import { colors, radius, space } from '../theme';
import { Banner, Button, Card, IconButton, PillTabs, Screen, Text, TextField } from '../ui';

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
    return (
      <Screen>
        <Text>Viewers cannot import recipes.</Text>
      </Screen>
    );
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
    <Screen back={{ href: '/', label: 'All recipes' }}>
      <Text role="heading" aria-level={1} variant="h1">
        Import a recipe
      </Text>
      <PillTabs
        tabs={[
          { value: 'text', label: 'Paste text' },
          { value: 'url', label: 'Paste link' },
          { value: 'photo', label: 'Photo' },
        ]}
        value={kind}
        onChange={(option) => {
          setKind(option);
          setError(null);
        }}
      />
      <Card>
        {kind === 'photo' ? (
          <View style={{ gap: space.sm }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              {pages.map((page, index) => (
                <View key={page.preview} style={{ gap: space.xs, alignItems: 'center' }}>
                  <Image
                    source={{ uri: page.preview }}
                    accessibilityLabel={`Page ${index + 1}`}
                    style={{ width: 90, height: 120, borderRadius: radius.field }}
                  />
                  <View style={{ flexDirection: 'row' }}>
                    {index > 0 ? (
                      <IconButton
                        icon="chevron-back"
                        label={`Move page ${index + 1} left`}
                        size={18}
                        onPress={() => movePage(index, index - 1)}
                      />
                    ) : null}
                    <IconButton
                      icon="close"
                      label={`Remove page ${index + 1}`}
                      tone="danger"
                      size={18}
                      onPress={() => removePage(index)}
                    />
                    {index < pages.length - 1 ? (
                      <IconButton
                        icon="chevron-forward"
                        label={`Move page ${index + 1} right`}
                        size={18}
                        onPress={() => movePage(index, index + 1)}
                      />
                    ) : null}
                  </View>
                </View>
              ))}
            </View>
            {pages.length < PHOTO_LIMITS.pages ? (
              <Button
                variant="secondary"
                icon="camera-outline"
                label="Add page"
                onPress={() => void addPages()}
              />
            ) : null}
          </View>
        ) : kind === 'text' ? (
          <TextField
            label="Recipe text"
            hideLabel
            placeholder="Paste a recipe from Notes, a message, or a comment"
            value={text}
            onChangeText={setText}
            multiline
            numberOfLines={10}
            textAlignVertical="top"
            style={{ minHeight: 180 }}
          />
        ) : (
          <TextField
            label="Recipe link"
            hideLabel
            icon="link-outline"
            placeholder="https://"
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            inputMode="url"
          />
        )}
        {error ? (
          <Banner tone="danger" role="alert">
            {error}
          </Banner>
        ) : null}
        <Button
          full
          label="Import recipe"
          disabled={empty}
          aria-disabled={busy || empty}
          onPress={() => void submit()}
        />
        {notice ? <Text aria-live="polite">{notice}</Text> : null}
        <Text variant="small" tone="muted">
          AI this month:{' '}
          {usage ? `${formatUsd(usage.spentUsd)} of ${formatUsd(usage.capUsd)}` : '–'}
        </Text>
      </Card>

      {imports.length > 0 ? (
        <Text role="heading" aria-level={2} variant="h2">
          Imports
        </Text>
      ) : null}
      {imports.map((item) => {
        const view = importView(item, online);
        return (
          <Card key={item.id}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
              {item.source_type === 'photo' && item.firstPage ? (
                <PhotoImage
                  id={item.firstPage}
                  label="First page"
                  style={{ width: 48, height: 64, borderRadius: radius.field }}
                />
              ) : null}
              <View style={{ flex: 1, gap: space.xs }}>
                <Text numberOfLines={1} variant="h3">
                  {importPreview(item)}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                  {view.busy ? <ActivityIndicator size="small" color={colors.accent} /> : null}
                  <Text variant="small" tone="muted" style={{ flex: 1 }}>
                    {view.label}
                  </Text>
                </View>
              </View>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              {view.canReview ? (
                <Button label="Review" onPress={() => router.push(`/import/${item.id}`)} />
              ) : null}
              {view.canRetry ? (
                <Button variant="secondary" label="Try again" onPress={() => void retry(item.id)} />
              ) : null}
              {!view.busy ? (
                <Button variant="ghost" label="Dismiss" onPress={() => void dismiss(item.id)} />
              ) : null}
            </View>
          </Card>
        );
      })}
    </Screen>
  );
}
