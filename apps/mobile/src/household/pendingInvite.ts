// An invite opened while signed out, picked up after sign-in (spec §6).
const KEY = 'recipes.pendingInvite';
export function setPendingInvite(code: string): void {
  globalThis.sessionStorage?.setItem(KEY, code);
}
export function takePendingInvite(): string | null {
  const code = globalThis.sessionStorage?.getItem(KEY) ?? null;
  globalThis.sessionStorage?.removeItem(KEY);
  return code && /^[A-Za-z0-9_-]{43}$/.test(code) ? code : null;
}
