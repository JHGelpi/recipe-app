import { useState } from 'react';
import { Linking } from 'react-native';
import { linkHost } from '../imports/review';
import type { RecipeSource } from '../recipes/rows';
import { colors, radius, space } from '../theme';
import { Button, Card, Text } from '../ui';

/** FR-12, NFR-13: where a recipe came from: its site and author, or the original text. */
export function SourceView({ source }: { source: RecipeSource }) {
  const [open, setOpen] = useState(false);
  const host = linkHost(source.source_url);
  if (!host && !source.source_text && !source.source_author) return null;
  const by = source.source_author ? ` · by ${source.source_author}` : '';

  return (
    <Card title="Source">
      {host ? (
        <Text>
          {'From '}
          <Text
            role="link"
            tone="accent"
            style={{ textDecorationLine: 'underline' }}
            onPress={() => void Linking.openURL(source.source_url!)}
          >
            {host}
          </Text>
          {by}
        </Text>
      ) : source.source_author ? (
        <Text>By {source.source_author}</Text>
      ) : null}
      {source.source_text ? (
        <>
          <Button
            variant="ghost"
            label={open ? 'Original text ▾' : 'Original text ▸'}
            aria-expanded={open}
            onPress={() => setOpen((value) => !value)}
          />
          {open ? (
            <Text
              selectable
              style={{
                backgroundColor: colors.raised,
                padding: space.sm,
                borderRadius: radius.field,
              }}
            >
              {source.source_text}
            </Text>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}
