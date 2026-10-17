/** A one-time message after a change of household (spec §6). */
export type HouseholdNotice = { kind: 'joined' | 'moved'; name: string | null };
const KEY = 'recipes.householdNotice';

export function setNotice(notice: HouseholdNotice): void {
  globalThis.sessionStorage?.setItem(KEY, JSON.stringify(notice));
}

/** Pending notices that were already set are kept (a Join's notice wins over "moved"). */
export function hasNotice(): boolean {
  return globalThis.sessionStorage?.getItem(KEY) != null;
}

export function takeNotice(): HouseholdNotice | null {
  const raw = globalThis.sessionStorage?.getItem(KEY);
  globalThis.sessionStorage?.removeItem(KEY);
  try {
    const value = JSON.parse(raw ?? 'null') as Partial<HouseholdNotice> | null;
    return value && (value.kind === 'joined' || value.kind === 'moved')
      ? { kind: value.kind, name: typeof value.name === 'string' ? value.name : null }
      : null;
  } catch {
    return null;
  }
}
