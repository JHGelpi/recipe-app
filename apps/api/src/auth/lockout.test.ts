import { expect, it } from 'vitest';
import { createLockout } from './lockout';

it('locks a key after the limit of failures in the window, until they age out or it is cleared', () => {
  let now = 0;
  const lockout = createLockout({ limit: 3, windowMs: 1_000, now: () => now });
  lockout.fail('a');
  lockout.fail('a');
  expect(lockout.locked('a')).toBe(false);
  lockout.fail('a');
  expect(lockout.locked('a')).toBe(true);
  expect(lockout.locked('b')).toBe(false);
  now = 1_000;
  expect(lockout.locked('a')).toBe(false);
  for (let i = 0; i < 3; i++) lockout.fail('a');
  lockout.clear('a');
  expect(lockout.locked('a')).toBe(false);
});

it('keeps at most maxKeys, dropping the oldest', () => {
  const lockout = createLockout({ limit: 1, windowMs: 1_000, maxKeys: 2, now: () => 0 });
  lockout.fail('a');
  lockout.fail('b');
  lockout.fail('c');
  expect(lockout.locked('a')).toBe(false);
  expect(lockout.locked('c')).toBe(true);
});
