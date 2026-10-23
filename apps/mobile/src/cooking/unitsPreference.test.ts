import { describe, expect, it } from 'vitest';
import { freshPlace } from './place';
import { readUnitsPreference, saveUnitsPreference, UNITS_KEY } from './unitsPreference';

function memoryStore() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}
const throwing = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
};

describe('the units preference (FR-23)', () => {
  it('reads As written when nothing, something unknown, or no storage is there', () => {
    expect(readUnitsPreference(memoryStore())).toBe('as_written');
    const store = memoryStore();
    store.setItem(UNITS_KEY, 'imperial');
    expect(readUnitsPreference(store)).toBe('as_written');
    expect(readUnitsPreference(undefined)).toBe('as_written');
    expect(readUnitsPreference(throwing)).toBe('as_written');
  });

  it('saves and reads back US and Metric under dishkept.units', () => {
    const store = memoryStore();
    expect(saveUnitsPreference(store, 'metric')).toBe(true);
    expect(store.map.get('dishkept.units')).toBe('metric');
    expect(readUnitsPreference(store)).toBe('metric');
    saveUnitsPreference(store, 'us');
    expect(readUnitsPreference(store)).toBe('us');
  });

  it('says when storage refuses, so the choice lasts only the visit', () => {
    expect(saveUnitsPreference(throwing, 'us')).toBe(false);
    expect(saveUnitsPreference(undefined, 'us')).toBe(false);
  });

  it('a fresh place starts at the preference, As written by default', () => {
    expect(freshPlace(4, 0).units).toBe('as_written');
    for (const units of ['as_written', 'us', 'metric'] as const) {
      expect(freshPlace(4, 0, units)).toMatchObject({ units, servings: 4, step: 0, ticked: [] });
    }
  });
});
