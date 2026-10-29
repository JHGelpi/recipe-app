import { releaseHeading, type Release } from '@recipe-app/domain';
import { View } from 'react-native';
import { space } from '../theme';
import { Text } from '../ui';

/** FR-47: each release headed "Version 1.2.0 · Oct 28, 2026", then its bullets. */
export function ReleaseList({ releases, level }: { releases: Release[]; level: 2 | 3 }) {
  return (
    <View style={{ gap: space.lg }}>
      {releases.map((release) => (
        <View key={release.version} style={{ gap: space.sm }}>
          <Text role="heading" aria-level={level} variant="h3">
            {releaseHeading(release)}
          </Text>
          <View role="list" style={{ gap: space.xs }}>
            {release.notes.map((note) => (
              <View key={note} role="listitem" style={{ flexDirection: 'row', gap: space.sm }}>
                <Text aria-hidden>•</Text>
                <Text style={{ flex: 1 }}>{note}</Text>
              </View>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}
