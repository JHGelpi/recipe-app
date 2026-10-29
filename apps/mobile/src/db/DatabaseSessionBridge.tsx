import { usePowerSync } from '@powersync/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { clearAllPlaces } from '../cooking/place';
import { hasNotice, setNotice } from '../household/notice';
import { useMembershipWatch } from '../household/useMembershipWatch';
import { useImportKicker } from '../imports/useImportKicker';
import { clearPhotos, startPhotos, stopPhotos } from '../photos/queue';
import { canWrite } from '../session/claims';
import {
  householdChanged,
  localDataAction,
  ownerKey,
  ownerToRecord,
  type SettledSession,
} from '../session/sessionState';
import { useSession } from '../session/SessionProvider';
import { createConnector } from '../sync/connector';
import { purgeTrashIfDue } from '../sync/purge';
import { dbOwner } from './dbOwner';
import { clearFilter } from '../recipes/listFilter';
import { setUnitsNow } from '../cooking/useUnitsPreference';
import { clearCachedSettings } from '../settings/cache';
import { PersonSettingsSync } from '../settings/PersonSettingsSync';
import { settingsStorage, startingSettings } from '../settings/start';
import { setAppearanceNow } from '../theme/useAppearance';
import { useNetworkOnline } from './useNetworkOnline';

const connector = createConnector();

/**
 * Keeps the local database in step with the session and the network.
 * - Local data is wiped only when the user signs out, or when a different
 *   user signs in (localDataAction). A session the server ended keeps it.
 * - Signed-in screens render only once the database is settled for that
 *   user: any wipe has finished and the owner is recorded, so the next user
 *   on a shared device never glimpses the previous household's recipes.
 * - Signed in with a household and online: connect, so sync and uploads run.
 * - Signed in but offline: disconnect, keeping local data and the queue. An
 *   open sync stream does not fail when the network drops, so without this
 *   the app would show Online and wait on PowerSync's backoff to reconnect.
 * - Signed out: disconnect.
 * - Photos: the attachment queue runs while signed in with a household; its
 *   files and cache are cleared with the local data.
 */
export function DatabaseSessionBridge({ children }: { children: ReactNode }) {
  const db = usePowerSync();
  const { state } = useSession();
  const online = useNetworkOnline();
  const status = state.status;
  const userId = state.status === 'signedIn' ? state.userId : null;
  const householdId = state.status === 'signedIn' ? (state.claims?.householdId ?? null) : null;
  const owner = userId !== null ? ownerKey(userId, householdId) : null;
  const hasHousehold = state.status === 'signedIn' && state.claims !== null;
  const byUser = state.status === 'signedOut' && state.byUser;
  const writer =
    state.status === 'signedIn' && state.claims !== null && canWrite(state.claims.role);
  // The user the local database is settled for.
  const [readyFor, setReadyFor] = useState<string | null>(null);
  // Serialise transitions so a wipe always finishes before the next connect.
  const queue = useRef<Promise<void>>(Promise.resolve());

  // ADR-0031: the stores follow whoever is signed in, starting from their
  // cached settings; signed out, As written and System. Signing out clears
  // the cache, so the next person's first frame never shows these choices.
  useEffect(() => {
    if (status === 'loading') return;
    if (byUser) clearCachedSettings(settingsStorage());
    const start = startingSettings(userId);
    setUnitsNow(start.units);
    setAppearanceNow(start.appearance);
  }, [status, userId, byUser]);

  // The dependencies are primitives on purpose: a token refresh creates a new
  // state object, and reconnecting on every refresh would restart sync.
  useEffect(() => {
    if (status === 'loading') return;
    const session: SettledSession =
      status === 'signedIn' && userId !== null
        ? { status: 'signedIn', userId, householdId }
        : { status: 'signedOut', byUser };
    queue.current = queue.current
      .then(async () => {
        if (localDataAction(session, dbOwner.get()) === 'wipe') {
          // FR-5: a move gets a one-time notice; a Join set its own already.
          if (householdChanged(session, dbOwner.get()) && !hasNotice()) {
            setNotice({
              kind: 'moved',
              name: null,
              householdId: session.status === 'signedIn' ? session.householdId : null,
            });
          }
          // Photos first: their files live outside the database (Review Focus 4).
          // A failure here must never stop the database wipe below.
          await clearPhotos(db).catch((error: unknown) =>
            console.error('Clearing photos failed', error),
          );
          try {
            if (globalThis.localStorage) clearAllPlaces(globalThis.localStorage);
          } catch (error) {
            // Storage can throw (private mode, quota); the database wipe must still run.
            console.error('Clearing cook places failed', error);
          }
          // A search typed in the old household means nothing in the new one.
          clearFilter();
          await db.disconnectAndClear();
          dbOwner.clear();
        }
        if (session.status === 'signedIn') {
          dbOwner.set(ownerToRecord(session, dbOwner.get()));
          setReadyFor(ownerKey(session.userId, session.householdId));
        } else {
          setReadyFor(null);
        }
        if (session.status === 'signedIn' && hasHousehold && online) {
          await db.connect(connector);
          // FR-18: at most once a day per device; failures wait for the next connect.
          if (writer) void purgeTrashIfDue(db);
        } else {
          await db.disconnect();
        }
        // Saving works offline; uploads and downloads wait for the network.
        if (session.status === 'signedIn' && hasHousehold) await startPhotos(db);
        else await stopPhotos(db);
      })
      .catch((error: unknown) => console.error('Database session change failed', error));
  }, [db, status, userId, householdId, hasHousehold, byUser, online, writer]);

  // FR-29: waiting imports are read once this device is online.
  useImportKicker(writer && online && readyFor === owner && owner !== null);

  // FR-4, FR-5: a role or household change reaches this phone by sync.
  useMembershipWatch(
    state.status === 'signedIn' ? state.claims : null,
    online && readyFor !== null,
  );

  if (status === 'signedIn' && readyFor !== owner) return null;
  return (
    <>
      {userId !== null ? <PersonSettingsSync userId={userId} /> : null}
      {children}
    </>
  );
}
