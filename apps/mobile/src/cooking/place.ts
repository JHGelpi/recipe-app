import type { UnitSystem } from '@recipe-app/domain';

/** Spec §3: this cook's place in a recipe, on this phone only. */
export type CookPlace = {
  ticked: string[];
  step: number;
  /** Chosen servings, when the recipe has servings. */
  servings: number | null;
  /** The scale, when the recipe has no servings. */
  scale: number;
  units: UnitSystem;
  at: number;
};

export const PLACE_TTL_MS = 12 * 60 * 60 * 1000;
export const PLACE_PREFIX = 'cook:';
const UNITS: readonly string[] = ['as_written', 'us', 'metric'];

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type ListStore = Pick<Storage, 'key' | 'removeItem'> & { readonly length: number };

/** FR-23: a recipe opened afresh starts in the device's units preference. */
export function freshPlace(
  servings: number | null,
  now: number,
  units: UnitSystem = 'as_written',
): CookPlace {
  return { ticked: [], step: 0, servings, scale: 1, units, at: now };
}

function isPlace(value: unknown): value is CookPlace {
  const place = value as Partial<CookPlace> | null;
  return (
    typeof place === 'object' &&
    place !== null &&
    Array.isArray(place.ticked) &&
    place.ticked.every((id) => typeof id === 'string') &&
    Number.isInteger(place.step) &&
    (place.servings === null || typeof place.servings === 'number') &&
    typeof place.scale === 'number' &&
    UNITS.includes(String(place.units)) &&
    typeof place.at === 'number'
  );
}

export function readPlace(store: Store, recipeId: string, now: number): CookPlace | null {
  const key = PLACE_PREFIX + recipeId;
  let value: unknown;
  try {
    value = JSON.parse(store.getItem(key) ?? 'null');
  } catch {
    return null;
  }
  if (!isPlace(value)) return null;
  if (now - value.at > PLACE_TTL_MS) {
    store.removeItem(key);
    return null;
  }
  return value;
}

export function writePlace(store: Store, recipeId: string, place: CookPlace): void {
  store.setItem(PLACE_PREFIX + recipeId, JSON.stringify(place));
}

export function clearPlace(store: Store, recipeId: string): void {
  store.removeItem(PLACE_PREFIX + recipeId);
}

/** Sign-out wipe: no cook's place outlives the session's data. */
export function clearAllPlaces(store: ListStore): void {
  const keys: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (key?.startsWith(PLACE_PREFIX)) keys.push(key);
  }
  for (const key of keys) store.removeItem(key);
}

/** A place saved before the recipe was edited, made to fit it again. */
export function fitPlace(
  place: CookPlace,
  recipe: { servings: number | null; ingredients: { id: string }[]; steps: unknown[] },
): CookPlace {
  const ids = new Set(recipe.ingredients.map((ingredient) => ingredient.id));
  return {
    ...place,
    ticked: place.ticked.filter((id) => ids.has(id)),
    step: Math.max(0, Math.min(place.step, recipe.steps.length - 1)),
    servings: recipe.servings === null ? null : (place.servings ?? recipe.servings),
  };
}
