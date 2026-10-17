import { usePowerSync, useQuery } from '@powersync/react';
import { useEffect, useState } from 'react';
import { config } from '../config';
import { useNetworkOnline } from '../db/useNetworkOnline';
import { auth } from '../session/auth';
import { loadPhoto, PHOTO_CACHE, type LoadDeps } from './load';
import { readLocalPhoto } from './queue';

export type PhotoView = { state: 'loading' | 'ready' | 'offline' | 'missing'; uri: string | null };

// States 0 (waiting to upload) and 3 (synced) have a file on this phone.
const LOCAL_SQL = 'select local_uri, state from attachments where id = ?';

/** An object URL for a photo, from this phone, the cache, or the server. */
export function usePhotoUri(id: string | null): PhotoView {
  const db = usePowerSync();
  const online = useNetworkOnline();
  const { data } = useQuery<{ local_uri: string | null; state: number }>(LOCAL_SQL, [id ?? '']);
  const row = data[0];
  const local = row?.local_uri && [0, 3].includes(Number(row.state)) ? row.local_uri : null;
  const [view, setView] = useState<PhotoView>({ state: 'loading', uri: null });

  useEffect(() => {
    if (!id) {
      setView({ state: 'missing', uri: null });
      return;
    }
    let live = true;
    let made: string | null = null;
    const deps: LoadDeps = {
      readLocal: (uri) => readLocalPhoto(db, uri),
      fetchRemote: async (photoId) => {
        const { data: session } = await auth.getSession();
        return fetch(`${config.apiUrl}/photos/${encodeURIComponent(photoId)}`, {
          headers: session.session
            ? { Authorization: `Bearer ${session.session.access_token}` }
            : {},
          cache: 'no-store',
        });
      },
      cache: null,
      url: (photoId) => `${config.apiUrl}/photos/${encodeURIComponent(photoId)}`,
    };
    void (async () => {
      deps.cache = (await globalThis.caches?.open(PHOTO_CACHE)) ?? null;
      const blob = await loadPhoto(id, local, online, deps);
      if (!live) return;
      if (blob) {
        made = URL.createObjectURL(blob);
        setView({ state: 'ready', uri: made });
      } else {
        setView({ state: online ? 'missing' : 'offline', uri: null });
      }
    })();
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [db, id, local, online]);

  return view;
}
