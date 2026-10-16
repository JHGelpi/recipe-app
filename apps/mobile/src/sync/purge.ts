import type { AbstractPowerSyncDatabase } from '@powersync/web';
import { config } from '../config';
import { auth } from '../session/auth';

export const PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** How many one-second checks to wait for queued uploads before giving up. */
export const QUEUE_WAIT_TRIES = 60;
const KEY = 'recipes.lastPurge';

export function purgeDue(last: string | null, now: number): boolean {
  if (last === null) return true;
  const at = Number(last);
  return !Number.isFinite(at) || now - at >= PURGE_INTERVAL_MS;
}

export type PurgeDeps = {
  storage: Pick<Storage, 'getItem' | 'setItem'> | undefined;
  now: () => number;
  /** Local changes not yet uploaded. */
  pendingUploads: () => Promise<number>;
  /** Asks the server to purge; true when it did. */
  send: () => Promise<boolean>;
  wait: (ms: number) => Promise<void>;
};

/**
 * Purges at most once a day, and only once this device's queued uploads have
 * gone: a restore made offline must reach the server before the purge, or
 * the purge deletes the recipe and the restore is lost. If uploads are still
 * queued after the wait, it tries again on the next connect.
 */
export async function runPurgeIfDue(deps: PurgeDeps): Promise<void> {
  const { storage } = deps;
  if (!storage || !purgeDue(storage.getItem(KEY), deps.now())) return;
  for (let tries = 0; (await deps.pendingUploads()) > 0; tries++) {
    if (tries >= QUEUE_WAIT_TRIES) return;
    await deps.wait(1000);
  }
  try {
    if (await deps.send()) storage.setItem(KEY, String(deps.now()));
  } catch {
    // Offline or refused: try again on the next connect.
  }
}

async function sendPurge(): Promise<boolean> {
  const { data } = await auth.getSession();
  if (!data.session) return false;
  const response = await fetch(`${config.apiUrl}/trash/purge`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${data.session.access_token}` },
  });
  return response.ok;
}

/** FR-18: asks the server to delete this household's trash older than 30 days. */
export function purgeTrashIfDue(
  db: Pick<AbstractPowerSyncDatabase, 'getUploadQueueStats'>,
): Promise<void> {
  return runPurgeIfDue({
    storage: globalThis.localStorage,
    now: Date.now,
    pendingUploads: async () => (await db.getUploadQueueStats()).count,
    send: sendPurge,
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
}
