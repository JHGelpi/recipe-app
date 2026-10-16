import { usePowerSync } from '@powersync/react';
import { useEffect, useRef } from 'react';
import { localDataAction, type SettledSession } from '../session/sessionState';
import { useSession } from '../session/SessionProvider';
import { createConnector } from '../sync/connector';
import { dbOwner } from './dbOwner';
import { useNetworkOnline } from './useNetworkOnline';

const connector = createConnector();

/**
 * Keeps the local database in step with the session and the network.
 * - Local data is wiped only when the user signs out, or when a different
 *   user signs in (localDataAction). A session the server ended keeps it.
 * - Signed in with a household and online: connect, so sync and uploads run.
 * - Signed in but offline: disconnect, keeping local data and the queue. An
 *   open sync stream does not fail when the network drops, so without this
 *   the app would show Online and wait on PowerSync's backoff to reconnect.
 * - Signed out: disconnect.
 */
export function DatabaseSessionBridge() {
  const db = usePowerSync();
  const { state } = useSession();
  const online = useNetworkOnline();
  const status = state.status;
  const userId = state.status === 'signedIn' ? state.userId : null;
  const hasHousehold = state.status === 'signedIn' && state.claims !== null;
  const byUser = state.status === 'signedOut' && state.byUser;
  // Serialise transitions so a wipe always finishes before the next connect.
  const queue = useRef<Promise<void>>(Promise.resolve());

  // The dependencies are primitives on purpose: a token refresh creates a new
  // state object, and reconnecting on every refresh would restart sync.
  useEffect(() => {
    if (status === 'loading') return;
    const session: SettledSession =
      status === 'signedIn' && userId !== null
        ? { status: 'signedIn', userId }
        : { status: 'signedOut', byUser };
    queue.current = queue.current
      .then(async () => {
        if (localDataAction(session, dbOwner.get()) === 'wipe') {
          await db.disconnectAndClear();
          dbOwner.clear();
        }
        if (session.status === 'signedIn' && hasHousehold && online) {
          dbOwner.set(session.userId);
          await db.connect(connector);
        } else {
          await db.disconnect();
        }
      })
      .catch((error: unknown) => console.error('Database session change failed', error));
  }, [db, status, userId, hasHousehold, byUser, online]);

  return null;
}
