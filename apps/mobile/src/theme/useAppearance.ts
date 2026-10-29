import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { saveSetting, startingSettings } from '../settings/start';
import {
  applyTheme,
  DARK_QUERY,
  installThemeCss,
  resolveTheme,
  systemPrefersDark,
  type Appearance,
} from './appearance';

// NFR-11: the person's Appearance (ADR-0031). PersonSettingsSync sets it from
// the synced row; until then it starts from the cached copy index.html also
// painted from, so the theme does not flash.
let current: Appearance | undefined;
const listeners = new Set<() => void>();

function appearanceNow(): Appearance {
  return (current ??= startingSettings().appearance);
}

function apply(): void {
  if (typeof document === 'undefined') return;
  applyTheme(document, resolveTheme(appearanceNow(), systemPrefersDark()));
}

/** From the person's synced row, or System on sign-out. */
export function setAppearanceNow(next: Appearance): void {
  if (current === next) return;
  current = next;
  apply();
  listeners.forEach((listener) => listener());
}

/** Installs the color variables and applies the current theme, once, before the first render. */
export function installTheme(): void {
  if (typeof document === 'undefined') return;
  installThemeCss(document);
  apply();
}

/** The setting on the Household screen: the person's choice, saved to their row. */
export function useAppearance(): { appearance: Appearance; setAppearance(next: Appearance): void } {
  const appearance = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    appearanceNow,
    appearanceNow,
  );
  const setAppearance = useCallback((next: Appearance) => {
    setAppearanceNow(next);
    saveSetting('appearance', next);
  }, []);
  return { appearance, setAppearance };
}

/** Mounted once in the root layout: follows the device's light or dark setting live. */
export function AppearanceSync(): null {
  useEffect(() => {
    const media = globalThis.matchMedia?.(DARK_QUERY);
    const onSystem = () => apply();
    media?.addEventListener('change', onSystem);
    return () => media?.removeEventListener('change', onSystem);
  }, []);
  return null;
}
