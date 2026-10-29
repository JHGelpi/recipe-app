import { Screen, Text } from '../ui';
import { ReleaseList } from '../whatsNew/ReleaseList';
import { RELEASES } from '../whatsNew/releases';

/** FR-47: every release, newest first, from the Household screen. Works offline. */
export function WhatsNewScreen() {
  return (
    <Screen back={{ href: '/household', label: 'Household' }}>
      <Text role="heading" aria-level={1} variant="h1">
        What’s new
      </Text>
      <ReleaseList releases={RELEASES} level={2} />
    </Screen>
  );
}
