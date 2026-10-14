import { expect, it } from 'vitest';
import { normalizeEmail } from './email';

it('trims and lower-cases', () => {
  expect(normalizeEmail('  Wes@Example.TEST ')).toBe('wes@example.test');
});

it.each(['', '   ', 'no-at-sign', 'two@@example.test', 'a@b', 'has space@example.test'])(
  'rejects %j',
  (input) => {
    expect(normalizeEmail(input)).toBeNull();
  },
);
