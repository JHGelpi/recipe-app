import { Link } from 'expo-router';
import { View } from 'react-native';
import { radius, space } from '../theme';
import { Card, Text } from '../ui';
import { PhotoImage } from './PhotoImage';

/** FR-12: the pages a recipe was read from; each opens full size. */
export function OriginalPhotos({ ids }: { ids: string[] }) {
  if (ids.length === 0) return null;
  return (
    <Card title="Source">
      <Text tone="muted">
        From photos · {ids.length} {ids.length === 1 ? 'page' : 'pages'}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {ids.map((id, index) => (
          <Link key={id} href={`/photo/${id}`} aria-label={`Page ${index + 1}`}>
            <PhotoImage
              id={id}
              label={`Page ${index + 1}`}
              style={{ width: 72, height: 96, borderRadius: radius.field }}
            />
          </Link>
        ))}
      </View>
    </Card>
  );
}
