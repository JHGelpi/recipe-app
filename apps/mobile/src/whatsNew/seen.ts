import { compareVersions, startingSeenVersion } from '@recipe-app/domain';

/** Per device, kept on sign-out (FR-47): the version this device has seen the notes up to. */
export const SEEN_KEY = 'dishkept.whatsNew.seen';

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;

function read(storage: Storage | undefined): string | null {
  try {
    return storage?.getItem(SEEN_KEY) ?? null;
  } catch {
    return null;
  }
}

function write(storage: Storage | undefined, version: string): void {
  try {
    storage?.setItem(SEEN_KEY, version);
  } catch {
    // Blocked storage: the notes may show again next time, which is harmless.
  }
}

/**
 * Run once at start, before anyone signs in: a first visit records the
 * current version as seen; a device that already ran the app (a service
 * worker was in control) has seen none of the notes.
 */
export function recordStartingSeen(
  storage: Storage | undefined,
  hadController: boolean,
  current: string,
): string {
  const seen = startingSeenVersion(read(storage), hadController, current);
  write(storage, seen);
  return seen;
}

export function seenVersion(storage: Storage | undefined, current: string): string {
  return startingSeenVersion(read(storage), false, current);
}

/** "Got it": never lowers what was seen, should an older tab dismiss it later. */
export function markSeen(storage: Storage | undefined, version: string): void {
  const stored = read(storage);
  if (stored === null || !/^\d+\.\d+\.\d+$/.test(stored) || compareVersions(version, stored) > 0)
    write(storage, version);
}
