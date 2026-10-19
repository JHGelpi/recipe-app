// A friend link (/welcome/<code>) opened while signed out (production spec §4).
const KEY = 'recipes.pendingFriend';
const CODE = /^[A-Za-z0-9_-]{43}$/;

export function setPendingFriend(code: string): void {
  globalThis.sessionStorage?.setItem(KEY, code);
}
export function peekPendingFriend(): string | null {
  const code = globalThis.sessionStorage?.getItem(KEY) ?? null;
  return code && CODE.test(code) ? code : null;
}
export function takePendingFriend(): string | null {
  const code = peekPendingFriend();
  globalThis.sessionStorage?.removeItem(KEY);
  return code;
}
