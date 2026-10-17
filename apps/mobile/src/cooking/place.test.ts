import { describe, expect, it } from 'vitest';
import {
  clearAllPlaces,
  clearPlace,
  fitPlace,
  freshPlace,
  PLACE_TTL_MS,
  readPlace,
  writePlace,
} from './place';

function memoryStore() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
  };
}

const NOW = Date.UTC(2026, 9, 17, 18);

describe('the cook place', () => {
  it('starts fresh at the recipe’s servings, and reads back what was written', () => {
    const store = memoryStore();
    expect(readPlace(store, 'r1', NOW)).toBeNull();
    const place = { ...freshPlace(4, NOW), ticked: ['a'], step: 2, units: 'metric' as const };
    writePlace(store, 'r1', place);
    expect(readPlace(store, 'r1', NOW + 1000)).toEqual(place);
    expect(freshPlace(null, NOW)).toEqual({
      ticked: [],
      step: 0,
      servings: null,
      scale: 1,
      units: 'as_written',
      at: NOW,
    });
  });

  it('forgets a place over 12 hours old, and anything it cannot read', () => {
    const store = memoryStore();
    writePlace(store, 'r1', freshPlace(4, NOW));
    expect(readPlace(store, 'r1', NOW + PLACE_TTL_MS + 1)).toBeNull();
    expect(store.map.has('cook:r1')).toBe(false);
    store.setItem('cook:r2', '{not json');
    expect(readPlace(store, 'r2', NOW)).toBeNull();
    store.setItem('cook:r3', JSON.stringify({ ticked: 'a', step: 1, at: NOW }));
    expect(readPlace(store, 'r3', NOW)).toBeNull();
  });

  it('clears one recipe, or every recipe on sign-out, leaving other keys', () => {
    const store = memoryStore();
    writePlace(store, 'r1', freshPlace(4, NOW));
    writePlace(store, 'r2', freshPlace(4, NOW));
    store.setItem('recipes.lastPurge', '1');
    clearPlace(store, 'r1');
    expect(store.map.has('cook:r1')).toBe(false);
    clearAllPlaces(store);
    expect([...store.map.keys()]).toEqual(['recipes.lastPurge']);
  });

  it('fits a place to a recipe edited since (Review Focus 1)', () => {
    const place = { ...freshPlace(4, NOW), ticked: ['a', 'gone'], step: 6 };
    const recipe = { servings: 4, ingredients: [{ id: 'a' }, { id: 'b' }], steps: [1, 2, 3] };
    expect(fitPlace(place, recipe)).toMatchObject({ ticked: ['a'], step: 2 });
    expect(fitPlace(place, { ...recipe, steps: [] })).toMatchObject({ step: 0 });
    // Servings were removed from the recipe: fall back to the scale.
    expect(fitPlace({ ...place, servings: 6 }, { ...recipe, servings: null })).toMatchObject({
      servings: null,
    });
  });
});
