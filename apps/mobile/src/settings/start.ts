import { DEFAULT_PERSON_SETTINGS } from '@recipe-app/domain';
import { savedSessionUserId } from '../session/storageKey';
import { readCachedSettings, type PersonSettings, type SettingsStore } from './cache';

/** localStorage, or undefined where the browser blocks it: even reading the property throws there. */
export function settingsStorage(): SettingsStore | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * Where the stores start, before the local database answers: the saved
 * session's person's cached settings, or As written and System (ADR-0031).
 */
export function startingSettings(userId = savedSessionUserId(settingsStorage())): PersonSettings {
  return readCachedSettings(settingsStorage(), userId) ?? { ...DEFAULT_PERSON_SETTINGS };
}

type Saver = <K extends keyof PersonSettings>(key: K, value: PersonSettings[K]) => void;
let saver: Saver | null = null;

/** Set by PersonSettingsSync while someone is signed in: writes a choice to their row. */
export function registerSettingsSaver(next: Saver | null): void {
  saver = next;
}

export function saveSetting<K extends keyof PersonSettings>(
  key: K,
  value: PersonSettings[K],
): void {
  saver?.(key, value);
}
