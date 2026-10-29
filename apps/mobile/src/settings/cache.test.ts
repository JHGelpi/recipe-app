import { describe, expect, it } from 'vitest';
import {
  clearCachedSettings,
  dropLegacySettings,
  readCachedSettings,
  settingsFrom,
  SETTINGS_CACHE_KEY,
  writeCachedSettings,
} from './cache';

function memoryStore(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}
const throwing = {
  getItem: (): string | null => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
  removeItem: () => {
    throw new Error('SecurityError');
  },
};

describe('the person’s settings cache (ADR-0031)', () => {
  it('known values pass, anything else is As written and System', () => {
    expect(settingsFrom({ units: 'metric', appearance: 'dark' })).toEqual({
      units: 'metric',
      appearance: 'dark',
    });
    expect(settingsFrom({ units: 'imperial', appearance: 'Light' })).toEqual({
      units: 'as_written',
      appearance: 'system',
    });
    expect(settingsFrom(undefined)).toEqual({ units: 'as_written', appearance: 'system' });
  });

  it('reads back only for the person it was saved for', () => {
    const store = memoryStore();
    writeCachedSettings(store, 'ann', { units: 'us', appearance: 'light' });
    expect(readCachedSettings(store, 'ann')).toEqual({ units: 'us', appearance: 'light' });
    expect(readCachedSettings(store, 'bob')).toBeNull();
    expect(readCachedSettings(store, null)).toBeNull();
  });

  it('a broken value or blocked storage is no cache, never a throw', () => {
    expect(readCachedSettings(memoryStore({ [SETTINGS_CACHE_KEY]: '{' }), 'ann')).toBeNull();
    expect(readCachedSettings(throwing, 'ann')).toBeNull();
    expect(readCachedSettings(undefined, 'ann')).toBeNull();
    expect(() => writeCachedSettings(throwing, 'ann', settingsFrom(null))).not.toThrow();
    expect(() => clearCachedSettings(throwing)).not.toThrow();
  });

  it('sign-out clears it; the old device settings are dropped and never read', () => {
    const store = memoryStore({ 'dishkept.units': 'metric', 'dishkept.appearance': 'dark' });
    writeCachedSettings(store, 'ann', { units: 'us', appearance: 'light' });
    dropLegacySettings(store);
    expect([...store.values.keys()]).toEqual([SETTINGS_CACHE_KEY]);
    clearCachedSettings(store);
    expect(store.values.size).toBe(0);
  });
});
