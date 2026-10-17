import { useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { linkHost } from '../imports/review';
import type { RecipeSource } from '../recipes/rows';

const link = { textDecorationLine: 'underline' } as const;

/** FR-12, NFR-13: where a recipe came from: its site and author, or the original text. */
export function SourceView({ source }: { source: RecipeSource }) {
  const [open, setOpen] = useState(false);
  const host = linkHost(source.source_url);
  if (!host && !source.source_text && !source.source_author) return null;
  const by = source.source_author ? ` · by ${source.source_author}` : '';

  return (
    <View style={{ gap: 6 }}>
      <Text role="heading" aria-level={2} style={{ fontSize: 18, fontWeight: '600' }}>
        Source
      </Text>
      {host ? (
        <Text>
          {'From '}
          <Text role="link" style={link} onPress={() => void Linking.openURL(source.source_url!)}>
            {host}
          </Text>
          {by}
        </Text>
      ) : source.source_author ? (
        <Text>By {source.source_author}</Text>
      ) : null}
      {source.source_text ? (
        <>
          <Pressable role="button" aria-expanded={open} onPress={() => setOpen((value) => !value)}>
            <Text style={link}>{open ? 'Original text ▾' : 'Original text ▸'}</Text>
          </Pressable>
          {open ? (
            <Text selectable style={{ backgroundColor: '#f4f4f4', padding: 8, borderRadius: 6 }}>
              {source.source_text}
            </Text>
          ) : null}
        </>
      ) : null}
    </View>
  );
}
