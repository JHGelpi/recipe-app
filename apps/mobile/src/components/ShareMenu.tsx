import { usePowerSync } from '@powersync/react';
import { shareText } from '@recipe-app/domain';
import { useState } from 'react';
import { View } from 'react-native';
import { useNetworkOnline } from '../db/useNetworkOnline';
import { waitForUploads } from '../household/uploads';
import { withSession } from '../imports/api';
import { usePhotoUri } from '../photos/usePhotoUri';
import type { RecipeRecord } from '../recipes/rows';
import { createShare } from '../sharing/api';
import { shareFile, shareOrCopy } from '../sharing/share';
import { colors, radius, space } from '../theme';
import { Button, Card, Text } from '../ui';

async function dataUrlOf(uri: string): Promise<string> {
  const blob = await (await fetch(uri)).blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** FR-26, FR-27: Share as text, PDF, or a link. Every role may share. */
export function SharePanel({ recipe }: { recipe: RecipeRecord }) {
  const db = usePowerSync();
  const online = useNetworkOnline();
  const photo = usePhotoUri(recipe.photo_id);
  const [message, setMessage] = useState<string | null>(null);
  const [linkText, setLinkText] = useState<string | null>(null);

  async function text() {
    const how = await shareOrCopy({ title: recipe.title, text: shareText(recipe) });
    setMessage(how === 'copied' ? 'Copied' : null);
  }

  async function pdf() {
    setMessage(null);
    // Loaded on first use, so the app starts no slower (spec §9).
    const { recipePdfFile } = await import('../sharing/pdf');
    let image = null;
    if (photo.state === 'ready' && photo.uri && recipe.photo_id) {
      const dataUrl = await dataUrlOf(photo.uri).catch(() => null);
      const [width, height] = await new Promise<[number, number]>((resolve) => {
        const img = new globalThis.Image();
        img.onload = () => resolve([img.naturalWidth, img.naturalHeight]);
        img.onerror = () => resolve([0, 0]);
        img.src = photo.uri!;
      });
      if (dataUrl && width && height) image = { dataUrl, width, height };
    }
    await shareFile(recipePdfFile(recipe, image), recipe.title);
  }

  async function shareLink() {
    if (!online) {
      setMessage('Sharing a link needs a connection');
      return;
    }
    setMessage(null);
    await waitForUploads(db);
    const result = await withSession((deps) => createShare(recipe.id, deps));
    if (!result?.ok) {
      setMessage(result?.message ?? 'Sharing a link needs a connection');
      return;
    }
    const url = `${globalThis.location?.origin ?? ''}/s/${result.value.code}`;
    setLinkText(url);
    const how = await shareOrCopy({ title: recipe.title, text: `${recipe.title}: ${url}` });
    if (how === 'copied') setMessage('Copied');
  }

  return (
    <Card>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        <Button
          variant="secondary"
          icon="document-text-outline"
          label="Text"
          onPress={() => void text()}
        />
        <Button
          variant="secondary"
          icon="document-text-outline"
          label="PDF"
          onPress={() => void pdf()}
        />
        <Button
          variant="secondary"
          icon="link-outline"
          label="Link"
          onPress={() => void shareLink()}
        />
      </View>
      {linkText ? (
        <Text
          aria-label="Share link"
          selectable
          variant="small"
          tone="accent"
          style={{ backgroundColor: colors.raised, padding: space.sm, borderRadius: radius.field }}
        >
          {linkText}
        </Text>
      ) : null}
      {message ? (
        <Text role="status" variant="small" tone="muted">
          {message}
        </Text>
      ) : null}
    </Card>
  );
}
