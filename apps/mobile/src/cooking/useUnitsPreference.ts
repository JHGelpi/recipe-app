import type { UnitSystem } from '@recipe-app/domain';
import { useCallback, useSyncExternalStore } from 'react';
import { saveSetting, startingSettings } from '../settings/start';

// FR-23: the person's default units (ADR-0031), kept here for the recipe
// screens. PersonSettingsSync sets it from the synced row; other tabs share
// the database, so they follow a choice through their own sync.
let current: UnitSystem | undefined;
const listeners = new Set<() => void>();

/** FR-23: the units a recipe opened afresh starts in. */
export function unitsPreferenceNow(): UnitSystem {
  return (current ??= startingSettings().units);
}

/** From the person's synced row, or the defaults on sign-out. */
export function setUnitsNow(next: UnitSystem): void {
  if (current === next) return;
  current = next;
  listeners.forEach((listener) => listener());
}

/** The Units setting on the Household screen: the person's choice, saved to their row. */
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
    setUnitsNow(next);
    saveSetting('units', next);
  }, []);
  return { units, setUnits };
}
