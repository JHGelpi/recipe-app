import { config } from '../config';
import { auth } from '../session/auth';

export const PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const KEY = 'recipes.lastPurge';

export function purgeDue(last: string | null, now: number): boolean {
  if (last === null) return true;
  const at = Number(last);
  return !Number.isFinite(at) || now - at >= PURGE_INTERVAL_MS;
}

/**
 * Asks the server to delete this household's trash older than 30 days
 * (FR-18), at most once a day per device. Failures wait for the next connect.
 */
export async function purgeTrashIfDue(): Promise<void> {
  const storage = globalThis.localStorage;
  if (!storage || !purgeDue(storage.getItem(KEY), Date.now())) return;
  try {
    const { data } = await auth.getSession();
    if (!data.session) return;
    const response = await fetch(`${config.apiUrl}/trash/purge`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${data.session.access_token}` },
    });
    if (response.ok) storage.setItem(KEY, String(Date.now()));
  } catch {
    // Offline or refused: try again on the next connect.
  }
}
