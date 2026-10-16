import { usePowerSync } from '@powersync/react';
import { useEffect, useRef } from 'react';
import { useSession } from '../session/SessionProvider';
import { createConnector } from '../sync/connector';
import { useNetworkOnline } from './useNetworkOnline';

const connector = createConnector();

/**
 * Keeps the local database in step with the session and the network.
 * - Signed in with a household and online: connect, so sync and uploads run.
 * - Signed in but the device went offline: disconnect, keeping local data and
 *   the upload queue. An open sync stream does not fail when the network
 *   drops, so without this the app would show Online and wait on PowerSync's
 *   backoff to reconnect.
 * - Signed out: disconnect and wipe, so the next user on this browser cannot
 *   see the previous household's data.
 */
export function DatabaseSessionBridge() {
  const db = usePowerSync();
  const { state } = useSession();
  const online = useNetworkOnline();
  const status = state.status;
  const userId = state.status === 'signedIn' ? state.userId : null;
  const hasHousehold = state.status === 'signedIn' && state.claims !== null;
  // Serialise transitions so a wipe always finishes before the next connect.
  const queue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    if (status === 'loading') return;
    queue.current = queue.current
      .then(async () => {
        if (status === 'signedOut') await db.disconnectAndClear();
        else if (hasHousehold && online) await db.connect(connector);
        else if (hasHousehold) await db.disconnect();
      })
      .catch((error: unknown) => console.error('Database session change failed', error));
  }, [db, status, userId, hasHousehold, online]);

  return null;
}
