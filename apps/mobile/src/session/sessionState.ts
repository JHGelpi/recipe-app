import { isAuthRetryableFetchError, type Session } from '@supabase/auth-js';
import { claimsFromToken, type Claims } from './claims';

export type SessionState =
  | { status: 'loading' }
  | { status: 'signedOut'; byUser: boolean }
  | { status: 'signedIn'; userId: string; claims: Claims | null; stale: boolean };

/** A session state the database bridge acts on. */
export type SettledSession =
  { status: 'signedIn'; userId: string } | { status: 'signedOut'; byUser: boolean };

type GetSessionResult = { data: { session: Session | null }; error: unknown };

export function sessionFromAuth(session: Session): SessionState {
  return {
    status: 'signedIn',
    userId: session.user.id,
    claims: claimsFromToken(session.access_token),
    stale: false,
  };
}

function savedUser(saved: unknown): { userId: string; accessToken: string } | null {
  if (typeof saved !== 'object' || saved === null) return null;
  const { access_token, user } = saved as { access_token?: unknown; user?: { id?: unknown } };
  if (typeof access_token !== 'string' || typeof user?.id !== 'string') return null;
  return { userId: user.id, accessToken: access_token };
}

/**
 * The state after start-up. When the access token has expired and renewing it
 * fails because the network is unreachable, auth-js returns no session but
 * keeps the saved one; the app stays signed in from it (marked stale) so an
 * offline start does not sign the user out. The server still checks a fresh
 * token on every request.
 */
export function resolveSession(result: GetSessionResult, saved: unknown): SessionState {
  if (result.data.session) return sessionFromAuth(result.data.session);
  if (isAuthRetryableFetchError(result.error)) {
    const user = savedUser(saved);
    if (user) {
      return {
        status: 'signedIn',
        userId: user.userId,
        claims: claimsFromToken(user.accessToken),
        stale: true,
      };
    }
  }
  return { status: 'signedOut', byUser: false };
}

/**
 * Local data is wiped only when the user signs out, or when someone other
 * than the recorded owner signs in. A session the server ended keeps the
 * data, so unsynced recipes upload once the same user signs back in.
 */
export function localDataAction(session: SettledSession, owner: string | null): 'wipe' | 'keep' {
  if (session.status === 'signedOut') return session.byUser ? 'wipe' : 'keep';
  return owner !== null && owner !== session.userId ? 'wipe' : 'keep';
}
