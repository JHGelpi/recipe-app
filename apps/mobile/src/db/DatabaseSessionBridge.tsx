import { usePowerSync } from '@powersync/react';
import { useEffect, useRef } from 'react';
import { useSession } from '../session/SessionProvider';

/**
 * Keeps the local database in step with the session. Signed out: wipe it, so
 * the next user on this browser cannot see the previous household's data.
 */
export function DatabaseSessionBridge() {
  const db = usePowerSync();
  const { state } = useSession();
  const status = state.status;
  // Serialise transitions so a wipe always finishes before the next step.
  const queue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    if (status !== 'signedOut') return;
    queue.current = queue.current
      .then(() => db.disconnectAndClear())
      .catch((error: unknown) => console.error('Local database wipe failed', error));
  }, [db, status]);

  return null;
}
