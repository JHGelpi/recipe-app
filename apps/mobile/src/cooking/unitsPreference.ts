import type { UnitSystem } from '@recipe-app/domain';

/**
 * FR-23: the units recipes open in on this device, like Appearance (ADR-0020):
 * a device setting in localStorage, not household data, so every role has it.
 */
export const UNITS_KEY = 'dishkept.units';

type UnitsStore = Pick<Storage, 'getItem' | 'setItem'>;

/** The saved choice; As written when none is saved, it is unknown, or storage can't be read. */
export function readUnitsPreference(storage: UnitsStore | undefined): UnitSystem {
  try {
    const saved = storage?.getItem(UNITS_KEY);
    return saved === 'us' || saved === 'metric' || saved === 'as_written' ? saved : 'as_written';
  } catch {
    return 'as_written';
  }
}

/** Saves the choice; false when storage refuses, and then it lasts until the page reloads. */
export function saveUnitsPreference(storage: UnitsStore | undefined, units: UnitSystem): boolean {
  if (!storage) return false;
  try {
    storage.setItem(UNITS_KEY, units);
    return true;
  } catch {
    return false;
  }
}
