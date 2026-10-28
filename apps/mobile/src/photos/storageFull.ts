/**
 * Issue #67: the server refused a photo because the household's photo storage
 * is full (507). Uploads keep retrying, so a photo goes up once room is made;
 * the status line says why they are waiting. The next upload that succeeds
 * clears it.
 */
let full = false;
const listeners = new Set<() => void>();

export function setPhotoStorageFull(value: boolean): void {
  if (full === value) return;
  full = value;
  for (const listener of listeners) listener();
}

export const isPhotoStorageFull = (): boolean => full;

export function subscribePhotoStorageFull(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
