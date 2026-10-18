// A shared recipe someone chose to save while signed out (spec §6), and the
// one-time "Saved to your recipes" message.
const PENDING = 'recipes.pendingShare';
const FLASH = 'recipes.savedFlash';
const CODE = /^[A-Za-z0-9_-]{43}$/;

type Pending = { code: string; title: string };

export function setPendingShare(pending: Pending): void {
  globalThis.sessionStorage?.setItem(PENDING, JSON.stringify(pending));
}

export function peekPendingShare(): Pending | null {
  try {
    const value = JSON.parse(
      globalThis.sessionStorage?.getItem(PENDING) ?? 'null',
    ) as Partial<Pending> | null;
    return value &&
      typeof value.code === 'string' &&
      CODE.test(value.code) &&
      typeof value.title === 'string'
      ? { code: value.code, title: value.title }
      : null;
  } catch {
    return null;
  }
}

export function takePendingShare(): Pending | null {
  const value = peekPendingShare();
  globalThis.sessionStorage?.removeItem(PENDING);
  return value;
}

export function setSavedFlash(): void {
  globalThis.sessionStorage?.setItem(FLASH, '1');
}

export function takeSavedFlash(): boolean {
  const value = globalThis.sessionStorage?.getItem(FLASH) === '1';
  globalThis.sessionStorage?.removeItem(FLASH);
  return value;
}
