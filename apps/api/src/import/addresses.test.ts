import { describe, expect, it } from 'vitest';
import { isBlockedAddress } from './addresses';

describe('isBlockedAddress', () => {
  it.each([
    '127.0.0.1',
    '127.8.9.10',
    '10.0.0.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.170.53',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    '::',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:10.0.0.1',
    '64:ff9b::a00:1',
    'not-an-ip',
  ])('blocks %s', (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each(['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:2800:220:1:248:1893:25c8:1946'])(
    'allows %s',
    (ip) => {
      expect(isBlockedAddress(ip)).toBe(false);
    },
  );
});
