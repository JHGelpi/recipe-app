/** A one-time message after a change of household (spec §6). */
export type HouseholdNotice = {
  kind: 'joined' | 'moved';
  name: string | null;
  householdId: string | null;
};
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
      ? {
          kind: value.kind,
          name: typeof value.name === 'string' ? value.name : null,
          householdId: typeof value.householdId === 'string' ? value.householdId : null,
        }
      : null;
  } catch {
    return null;
  }
}

/**
 * The notice for the household the claims now name. A Join's notice waits
 * while the token still names the old household (its refresh failed), so the
 * person later reads "joined", not "moved".
 */
export function takeNoticeFor(householdId: string): HouseholdNotice | null {
  const raw = globalThis.sessionStorage?.getItem(KEY);
  if (raw == null) return null;
  try {
    const value = JSON.parse(raw) as { householdId?: unknown } | null;
    if (typeof value?.householdId === 'string' && value.householdId !== householdId) return null;
  } catch {
    // Unreadable: taken below and dropped.
  }
  return takeNotice();
}
