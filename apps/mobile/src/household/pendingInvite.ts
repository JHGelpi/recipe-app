import { markLatestLink } from '../session/latestLink';
// An invite opened while signed out, picked up after sign-in (spec §6).
const KEY = 'recipes.pendingInvite';
export function setPendingInvite(code: string): void {
  globalThis.sessionStorage?.setItem(KEY, code);
  markLatestLink('invite');
}
export function peekPendingInvite(): string | null {
  const code = globalThis.sessionStorage?.getItem(KEY) ?? null;
  return code && /^[A-Za-z0-9_-]{43}$/.test(code) ? code : null;
}
export function takePendingInvite(): string | null {
  const code = peekPendingInvite();
  globalThis.sessionStorage?.removeItem(KEY);
  return code;
}
