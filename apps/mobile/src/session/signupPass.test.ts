import { beforeEach, expect, it, vi } from 'vitest';
import { setPendingInvite } from '../household/pendingInvite';
import { setPendingShare } from '../sharing/pending';
import { setPendingFriend, takePendingFriend } from './pendingFriend';
import { askForPass, friendLinkStatus, isInviteOnly, passSource } from './signupPass';

const memory = new Map<string, string>();
beforeEach(() => {
  memory.clear();
  globalThis.sessionStorage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => void memory.set(key, value),
    removeItem: (key: string) => void memory.delete(key),
  } as Storage;
});

const A = 'k3J9xQ2mZb7LwP0aYc5RdT8vNf1HgE4sUo6IiKjMnBq';
const B = 'B'.repeat(43);

it('takes the link the visitor came through, invite first, without consuming it', () => {
  expect(passSource()).toBeNull();
  setPendingFriend(B);
  expect(passSource()).toEqual({ kind: 'friend', code: B });
  setPendingShare({ code: A, title: 'Pie' });
  expect(passSource()).toEqual({ kind: 'share', code: A });
  setPendingInvite(B);
  expect(passSource()).toEqual({ kind: 'invite', code: B });
  expect(passSource()).toEqual({ kind: 'invite', code: B });
  expect(takePendingFriend()).toBe(B);
});

it('ignores a malformed friend code', () => {
  setPendingFriend('nope');
  expect(passSource()).toBeNull();
});

it('asks the API for a pass and reads its answer', async () => {
  const answer = (status: number) =>
    vi.fn(async () => new Response(status === 204 ? null : '{}', { status }));
  const deps = (fetch: typeof globalThis.fetch) => ({ fetch, apiUrl: 'https://x/api' });
  const ok = answer(204);
  expect(await askForPass({ kind: 'friend', code: B }, 'a@b.co', deps(ok))).toBe('granted');
  expect(ok).toHaveBeenCalledWith(
    'https://x/api/signup-pass',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ kind: 'friend', code: B, email: 'a@b.co' }),
    }),
  );
  expect(await askForPass({ kind: 'friend', code: B }, 'a@b.co', deps(answer(404)))).toBe(
    'expired',
  );
  expect(await askForPass({ kind: 'friend', code: B }, 'a@b.co', deps(answer(429)))).toBe(
    'expired',
  );
  const down = vi.fn(async () => Promise.reject(new TypeError('offline')));
  expect(await askForPass({ kind: 'friend', code: B }, 'a@b.co', deps(down))).toBe('offline');
});

it('recognizes the gate refusal and nothing else', () => {
  expect(isInviteOnly({ status: 403, message: 'invite_only' })).toBe(true);
  expect(isInviteOnly({ status: 403, message: 'Email rate limit exceeded' })).toBe(false);
  expect(isInviteOnly({ status: 500, message: 'invite_only' })).toBe(false);
  expect(isInviteOnly(null)).toBe(false);
});

it('reads a friend link status; offline or an error reads as live', async () => {
  const reply = (status: number, body: unknown) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status }));
  const deps = (fetch: typeof globalThis.fetch) => ({ fetch, apiUrl: 'https://x/api' });
  const ended = reply(200, { status: 'ended' });
  expect(await friendLinkStatus(B, deps(ended))).toBe('ended');
  expect(ended).toHaveBeenCalledWith(
    'https://x/api/friend-links/status',
    expect.objectContaining({ method: 'POST', body: JSON.stringify({ code: B }) }),
  );
  expect(await friendLinkStatus(B, deps(reply(200, { status: 'unknown' })))).toBe('ended');
  expect(await friendLinkStatus(B, deps(reply(200, { status: 'used' })))).toBe('used');
  expect(await friendLinkStatus(B, deps(reply(500, {})))).toBe('live');
  const down = vi.fn(async () => Promise.reject(new TypeError('offline')));
  expect(await friendLinkStatus(B, deps(down))).toBe('live');
});

it('prefers the link opened last over an older pending invite or share', () => {
  setPendingInvite(A);
  setPendingShare({ code: A, title: 'Pie' });
  setPendingFriend(B);
  expect(passSource()).toEqual({ kind: 'friend', code: B });
  setPendingInvite(B);
  expect(passSource()).toEqual({ kind: 'invite', code: B });
});
