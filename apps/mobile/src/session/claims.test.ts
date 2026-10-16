import { describe, expect, it } from 'vitest';
import { canWrite, claimsFromToken } from './claims';

function token(payload: object): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode(payload)}.signature`;
}

describe('claimsFromToken', () => {
  it('reads the user, household, and role', () => {
    expect(
      claimsFromToken(token({ sub: 'user-1', household_id: 'house-1', household_role: 'member' })),
    ).toEqual({ userId: 'user-1', householdId: 'house-1', role: 'member' });
  });

  it('handles non-ASCII characters in the payload', () => {
    const claims = claimsFromToken(
      token({ sub: 'u', household_id: 'h', household_role: 'admin', email: 'zoë@example.test' }),
    );
    expect(claims?.role).toBe('admin');
  });

  it('returns null when the household claims are missing', () => {
    expect(claimsFromToken(token({ sub: 'user-1' }))).toBeNull();
  });

  it('returns null for an unknown role', () => {
    expect(
      claimsFromToken(token({ sub: 'u', household_id: 'h', household_role: 'owner' })),
    ).toBeNull();
  });

  it('returns null for text that is not a token', () => {
    expect(claimsFromToken('')).toBeNull();
    expect(claimsFromToken('a.b.c')).toBeNull();
  });
});

describe('canWrite', () => {
  it('allows admins and members, not viewers', () => {
    expect(canWrite('admin')).toBe(true);
    expect(canWrite('member')).toBe(true);
    expect(canWrite('viewer')).toBe(false);
  });
});
