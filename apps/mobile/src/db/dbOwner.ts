// The user whose data the local database holds. An ID, not a secret.
const KEY = 'recipes.dbOwner';

function storage(): Storage | undefined {
  return globalThis.localStorage;
}

export const dbOwner = {
  get(): string | null {
    return storage()?.getItem(KEY) ?? null;
  },
  set(userId: string): void {
    storage()?.setItem(KEY, userId);
  },
  clear(): void {
    storage()?.removeItem(KEY);
  },
};
