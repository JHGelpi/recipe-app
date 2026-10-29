import { unseenReleases } from '@recipe-app/domain';
import { useCallback, useState } from 'react';
import { BottomSheet } from '../components/BottomSheet';
import { useSession } from '../session/SessionProvider';
import { settingsStorage } from '../settings/start';
import { Button, Text } from '../ui';
import { ReleaseList } from './ReleaseList';
import { APP_VERSION, RELEASES } from './releases';
import { markSeen, seenVersion } from './seen';

/**
 * FR-47: the first open of a new version shows the releases this device
 * hasn't seen, once. Signed-in people only: notes that arrive while signed
 * out wait for the next sign-in on this device.
 */
export function WhatsNewPopup() {
  const { state } = useSession();
  const [seen, setSeen] = useState(() => seenVersion(settingsStorage(), APP_VERSION));
  const unseen = unseenReleases(RELEASES, seen);
  const dismiss = useCallback(() => {
    markSeen(settingsStorage(), APP_VERSION);
    setSeen(APP_VERSION);
  }, []);
  return (
    <BottomSheet
      open={state.status === 'signedIn' && unseen.length > 0}
      label="What’s new"
      onClose={dismiss}
    >
      <Text role="heading" aria-level={2} variant="h2">
        What’s new
      </Text>
      <ReleaseList releases={unseen} level={3} />
      <Button label="Got it" onPress={dismiss} />
    </BottomSheet>
  );
}
