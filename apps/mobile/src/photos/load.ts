/** Page photos fetched online, kept for offline viewing (spec §6). Cleared on sign-out. */
export const PHOTO_CACHE = 'photo-pages';

export type LoadDeps = {
  readLocal: (localUri: string) => Promise<Blob>;
  fetchRemote: (id: string) => Promise<Response>;
  cache: Pick<Cache, 'match' | 'put'> | null;
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
    return await response.blob();
  } catch {
    return null;
  }
}
