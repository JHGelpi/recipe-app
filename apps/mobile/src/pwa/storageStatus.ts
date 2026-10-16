import { useEffect, useState } from 'react';

export type StorageStatus = 'persistent' | 'best effort' | 'unknown';

let request: Promise<StorageStatus> | null = null;

/**
 * Asks the browser once not to evict the app's data when space runs low.
 * Safari decides by its own rules; the footer shows what it chose.
 */
export function requestPersistentStorage(): Promise<StorageStatus> {
  request ??= (async () => {
    const storage = typeof navigator === 'undefined' ? undefined : navigator.storage;
    if (!storage?.persist || !storage.persisted) return 'unknown';
    try {
      if (await storage.persisted()) return 'persistent';
      return (await storage.persist()) ? 'persistent' : 'best effort';
    } catch {
      return 'unknown';
    }
  })();
  return request;
}

export function useStorageStatus(): StorageStatus | 'checking' {
  const [status, setStatus] = useState<StorageStatus | 'checking'>('checking');
  useEffect(() => {
    let live = true;
    void requestPersistentStorage().then((result) => {
      if (live) setStatus(result);
    });
    return () => {
      live = false;
    };
  }, []);
  return status;
}
