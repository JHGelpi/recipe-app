import { expect, it } from 'vitest';
import { codeRelayUrl } from './codeRelay';

it('sends the email-code calls to the API relay and leaves the rest (#72)', () => {
  const to = (url: string) => codeRelayUrl(url, '/auth', '/api');
  expect(to('/auth/otp')).toBe('/api/auth/otp');
  expect(to('/auth/otp?redirect_to=x')).toBe('/api/auth/otp?redirect_to=x');
  expect(to('/auth/verify')).toBe('/api/auth/verify');
  expect(to('/auth/token?grant_type=refresh_token')).toBe('/auth/token?grant_type=refresh_token');
  expect(to('/auth/logout')).toBe('/auth/logout');
  expect(to('/auth/otpx')).toBe('/auth/otpx');
  expect(codeRelayUrl('http://h/auth/verify', 'http://h/auth', 'http://h/api')).toBe(
    'http://h/api/auth/verify',
  );
});
