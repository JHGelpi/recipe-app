import { AuthApiError, AuthRetryableFetchError, type Session } from '@supabase/auth-js';
import { describe, expect, it } from 'vitest';
import {
  localDataAction,
  provisionalSession,
  resolveSession,
  sessionFromAuth,
} from './sessionState';

function token(payload: object): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode(payload)}.signature`;
}

const ACCESS = token({ sub: 'user-1', household_id: 'house-1', household_role: 'viewer' });
const CLAIMS = { userId: 'user-1', householdId: 'house-1', role: 'viewer' };

// Only the fields the app reads; auth-js sessions carry more.
const session = { access_token: ACCESS, user: { id: 'user-1' } } as unknown as Session;
const saved = { access_token: ACCESS, refresh_token: 'r', expires_at: 1, user: { id: 'user-1' } };
const offline = new AuthRetryableFetchError('Failed to fetch', 0);

describe('resolveSession', () => {
  it('is signed in when auth-js returns a session', () => {
    expect(resolveSession({ data: { session }, error: null }, null)).toEqual({
      status: 'signedIn',
      userId: 'user-1',
      claims: CLAIMS,
      stale: false,
    });
  });

  it('keeps the saved session, marked stale, when renewal fails on the network', () => {
    expect(resolveSession({ data: { session: null }, error: offline }, saved)).toEqual({
      status: 'signedIn',
      userId: 'user-1',
      claims: CLAIMS,
      stale: true,
    });
  });

  it('is signed out after a network failure when nothing is saved', () => {
    expect(resolveSession({ data: { session: null }, error: offline }, null)).toEqual({
      status: 'signedOut',
      byUser: false,
    });
  });

  it('is signed out after a network failure when the saved session is malformed', () => {
    expect(
      resolveSession({ data: { session: null }, error: offline }, { access_token: 42 }),
    ).toEqual({ status: 'signedOut', byUser: false });
  });

  it('is signed out when the server rejects the session', () => {
    const rejected = new AuthApiError('Invalid Refresh Token', 400, 'refresh_token_not_found');
    expect(resolveSession({ data: { session: null }, error: rejected }, saved)).toEqual({
      status: 'signedOut',
      byUser: false,
    });
  });
});

describe('provisionalSession', () => {
  // auth-js retries an offline renewal for up to ~30 s before getSession
  // resolves; the app must not sit on a blank screen meanwhile.
  it('starts signed in, marked stale, from a saved session', () => {
    expect(provisionalSession(saved)).toEqual({
      status: 'signedIn',
      userId: 'user-1',
      claims: CLAIMS,
      stale: true,
    });
  });

  it('starts loading when nothing usable is saved', () => {
    expect(provisionalSession(null)).toEqual({ status: 'loading' });
    expect(provisionalSession({ access_token: 42 })).toEqual({ status: 'loading' });
  });
});

describe('sessionFromAuth', () => {
  it('reads the user and claims from a live session', () => {
    expect(sessionFromAuth(session)).toEqual({
      status: 'signedIn',
      userId: 'user-1',
      claims: CLAIMS,
      stale: false,
    });
  });
});

describe('localDataAction', () => {
  it('wipes when the user signs out', () => {
    expect(localDataAction({ status: 'signedOut', byUser: true }, 'user-1')).toBe('wipe');
  });

  it('keeps data when the session ends without the user asking', () => {
    expect(localDataAction({ status: 'signedOut', byUser: false }, 'user-1')).toBe('keep');
  });

  it('keeps data when the owner signs back in', () => {
    expect(localDataAction({ status: 'signedIn', userId: 'user-1' }, 'user-1')).toBe('keep');
  });

  it('wipes when a different user signs in', () => {
    expect(localDataAction({ status: 'signedIn', userId: 'user-2' }, 'user-1')).toBe('wipe');
  });

  it('keeps data when no owner is recorded', () => {
    expect(localDataAction({ status: 'signedIn', userId: 'user-2' }, null)).toBe('keep');
  });
});
