import { expect, it } from 'vitest';
import { createRateLimiter } from './rateLimit';

it('allows up to the limit per key inside the window, then again once it passes', () => {
  let now = 0;
  const allow = createRateLimiter({ limit: 2, windowMs: 1_000, now: () => now });
  expect([allow('a'), allow('a'), allow('a'), allow('b')]).toEqual([true, true, false, true]);
  now = 1_001;
  expect(allow('a')).toBe(true);
});

it('at its key cap a new key is refused, and keys free up a window later', () => {
  let now = 0;
  const allow = createRateLimiter({ limit: 5, windowMs: 1_000, maxKeys: 2, now: () => now });
  expect([allow('a'), allow('b'), allow('c')]).toEqual([true, true, false]);
  expect(allow('a')).toBe(true);
  now = 1_000;
  expect(allow('c')).toBe(true);
});
