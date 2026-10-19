/** Page photos fetched online, kept for offline viewing (spec §6). Cleared on sign-out. */
export const PHOTO_CACHE = 'photo-pages';

export const PHOTO_CACHE_MAX = 50;

/** Keeps the newest `max` entries; Cache keys come back oldest first. */
export async function trimCache(cache: Pick<Cache, 'keys' | 'delete'>, max: number): Promise<void> {
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - max))) await cache.delete(key);
}

export type LoadDeps = {
  readLocal: (localUri: string) => Promise<Blob>;
  fetchRemote: (id: string) => Promise<Response>;
  cache: (Pick<Cache, 'match' | 'put'> & Partial<Pick<Cache, 'keys' | 'delete'>>) | null;
  url: (id: string) => string;
};

/**
 * A photo's bytes: the file kept on this phone, else the cached copy, else
 * the server when online. Null when none has it, including a photo another
 * device has not uploaded yet (404).
 */
export async function loadPhoto(
  id: string,
  local: string | null,
  online: boolean,
  deps: LoadDeps,
): Promise<Blob | null> {
  if (local) {
    try {
      return await deps.readLocal(local);
    } catch {
      // Evicted or never written: try the copies below.
    }
  }
  const cached = await deps.cache?.match(deps.url(id));
  if (cached) return cached.blob();
  if (!online) return null;
  try {
    const response = await deps.fetchRemote(id);
    if (!response.ok) return null;
    await deps.cache?.put(deps.url(id), response.clone());
    // The cache is not evicted by the browser: keep it to the newest pages (spec §3).
    const { cache } = deps;
    if (cache?.keys && cache.delete) {
      await trimCache(
        { keys: cache.keys.bind(cache), delete: cache.delete.bind(cache) },
        PHOTO_CACHE_MAX,
      );
    }
    return await response.blob();
  } catch {
    return null;
  }
}
