import type { UnitSystem } from '@recipe-app/domain';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { deviceStorage } from '../theme/appearance';
import { readUnitsPreference, saveUnitsPreference, UNITS_KEY } from './unitsPreference';

// The page's current choice. Held here too, so a choice storage refused still lasts the visit.
let current: UnitSystem | undefined;
const listeners = new Set<() => void>();

/** FR-23: the units a recipe opened afresh starts in. */
export function unitsPreferenceNow(): UnitSystem {
  return (current ??= readUnitsPreference(deviceStorage()));
}

function choose(next: UnitSystem): void {
  current = next;
  listeners.forEach((listener) => listener());
}

/** The Units setting on the Household screen: the device's choice, saved at once. */
export function useUnitsPreference(): { units: UnitSystem; setUnits(next: UnitSystem): void } {
  const units = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    unitsPreferenceNow,
    unitsPreferenceNow,
  );
  const setUnits = useCallback((next: UnitSystem) => {
    saveUnitsPreference(deviceStorage(), next);
    choose(next);
  }, []);
  return { units, setUnits };
}

/** Mounted once in the root layout: follows a choice made in another tab, as AppearanceSync does. */
export function UnitsSync(): null {
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === UNITS_KEY) choose(readUnitsPreference(deviceStorage()));
    };
    globalThis.addEventListener?.('storage', onStorage);
    return () => globalThis.removeEventListener?.('storage', onStorage);
  }, []);
  return null;
}
