import {
  APPEARANCES,
  DEFAULT_PERSON_SETTINGS,
  UNIT_SYSTEMS,
  type Appearance,
  type UnitSystem,
} from '@recipe-app/domain';

export type PersonSettings = { units: UnitSystem; appearance: Appearance };

/**
 * ADR-0031: the person's synced settings are the truth. This copy, tagged with
 * whose they are, only paints the first frame: index.html's pre-paint script
 * reads it, and the stores start from it, before the local database opens.
 * Keep the key and shape in step with index.html.
 */
export const SETTINGS_CACHE_KEY = 'dishkept.personSettings';
// Device settings from before ADR-0031; nobody's choices are carried over.
const LEGACY_KEYS = ['dishkept.units', 'dishkept.appearance'];

export type SettingsStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Known values from a row or the cache, As written and System otherwise. */
export function settingsFrom(
  row: { units?: unknown; appearance?: unknown } | null | undefined,
): PersonSettings {
  const units = (UNIT_SYSTEMS as readonly unknown[]).includes(row?.units)
    ? (row!.units as UnitSystem)
    : DEFAULT_PERSON_SETTINGS.units;
  const appearance = (APPEARANCES as readonly unknown[]).includes(row?.appearance)
    ? (row!.appearance as Appearance)
    : DEFAULT_PERSON_SETTINGS.appearance;
  return { units, appearance };
}

/** This person's cached settings; null for anyone else's, none, or blocked storage. */
export function readCachedSettings(
  storage: SettingsStore | undefined,
  userId: string | null,
): PersonSettings | null {
  if (!userId) return null;
  try {
    const raw = storage?.getItem(SETTINGS_CACHE_KEY);
    const cached = raw
      ? (JSON.parse(raw) as { userId?: unknown; units?: unknown; appearance?: unknown })
      : null;
    return cached?.userId === userId ? settingsFrom(cached) : null;
  } catch {
    return null;
  }
}

export function writeCachedSettings(
  storage: SettingsStore | undefined,
  userId: string,
  settings: PersonSettings,
): void {
  try {
    storage?.setItem(SETTINGS_CACHE_KEY, JSON.stringify({ userId, ...settings }));
  } catch {
    // Only the first frame of the next start is affected.
  }
}

/** On sign-out, and once for the device settings of before. */
export function clearCachedSettings(storage: SettingsStore | undefined): void {
  for (const key of [SETTINGS_CACHE_KEY, ...LEGACY_KEYS]) {
    try {
      storage?.removeItem(key);
    } catch {
      // Blocked storage holds nothing to clear.
    }
  }
}

export function dropLegacySettings(storage: SettingsStore | undefined): void {
  for (const key of LEGACY_KEYS) {
    try {
      storage?.removeItem(key);
    } catch {
      // As above.
    }
  }
}
