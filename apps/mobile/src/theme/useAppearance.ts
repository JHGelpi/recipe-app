import { useCallback, useEffect, useSyncExternalStore } from 'react';
import {
  APPEARANCE_KEY,
  applyTheme,
  DARK_QUERY,
  deviceStorage,
  installThemeCss,
  readAppearance,
  resolveTheme,
  saveAppearance,
  systemPrefersDark,
  type Appearance,
} from './appearance';

const store = deviceStorage;

// The page's current choice. Held here too, so a choice storage refused still lasts the visit.
let current: Appearance | undefined;
const listeners = new Set<() => void>();

function appearanceNow(): Appearance {
  return (current ??= readAppearance(store()));
}

function apply(): void {
  if (typeof document === 'undefined') return;
  applyTheme(document, resolveTheme(appearanceNow(), systemPrefersDark()));
}

function choose(next: Appearance): void {
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

/** The setting on the Household screen: the device's choice, saved at once. */
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
    saveAppearance(store(), next);
    choose(next);
  }, []);
  return { appearance, setAppearance };
}

/** Mounted once in the root layout: follows the system setting and choices made in other tabs. */
export function AppearanceSync(): null {
  useEffect(() => {
    const media = globalThis.matchMedia?.(DARK_QUERY);
    const onSystem = () => apply();
    const onStorage = (event: StorageEvent) => {
      if (event.key === APPEARANCE_KEY) choose(readAppearance(store()));
    };
    media?.addEventListener('change', onSystem);
    globalThis.addEventListener?.('storage', onStorage);
    return () => {
      media?.removeEventListener('change', onSystem);
      globalThis.removeEventListener?.('storage', onStorage);
    };
  }, []);
  return null;
}
