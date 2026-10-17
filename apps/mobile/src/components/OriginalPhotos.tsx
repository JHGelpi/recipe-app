import { Link } from 'expo-router';
import { Text, View } from 'react-native';
import { PhotoImage } from './PhotoImage';

/** FR-12: the pages a recipe was read from; each opens full size. */
export function OriginalPhotos({ ids }: { ids: string[] }) {
  if (ids.length === 0) return null;
  return (
    <View style={{ gap: 6 }}>
      <Text role="heading" aria-level={2} style={{ fontSize: 18, fontWeight: '600' }}>
        Source
      </Text>
      <Text>
        From photos · {ids.length} {ids.length === 1 ? 'page' : 'pages'}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {ids.map((id, index) => (
          <Link key={id} href={`/photo/${id}`} aria-label={`Page ${index + 1}`}>
            <PhotoImage
              id={id}
              label={`Page ${index + 1}`}
              style={{ width: 72, height: 96, borderRadius: 4 }}
            />
          </Link>
        ))}
      </View>
    </View>
  );
}
