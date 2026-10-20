import { isAuthRetryableFetchError, type Session } from '@supabase/auth-js';
import { claimsFromToken, type Claims } from './claims';

export type SessionState =
  | { status: 'loading' }
  | { status: 'signedOut'; byUser: boolean }
  | { status: 'signedIn'; userId: string; claims: Claims | null; stale: boolean };

/** A session state the database bridge acts on. */
export type SettledSession =
  | { status: 'signedIn'; userId: string; householdId: string | null }
  | { status: 'signedOut'; byUser: boolean };

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
 * The state to show before getSession() resolves. Offline, auth-js retries
 * renewing an expired token for up to about 30 seconds first, so starting
 * from the saved session (marked stale) avoids a blank screen meanwhile.
 * The local data belongs to this user either way; the server checks every
 * request.
 */
export function provisionalSession(saved: unknown): SessionState {
  const user = savedUser(saved);
  if (!user) return { status: 'loading' };
  return {
    status: 'signedIn',
    userId: user.userId,
    claims: claimsFromToken(user.accessToken),
    stale: true,
  };
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
    const provisional = provisionalSession(saved);
    if (provisional.status === 'signedIn') return provisional;
  }
  return { status: 'signedOut', byUser: false };
}

/** What the local database is recorded as holding: this user, in this household. */
export function ownerKey(userId: string, householdId: string | null): string {
  return householdId ? `${userId}:${householdId}` : userId;
}

const ownerUser = (owner: string) => owner.split(':')[0];

/**
 * The owner key to store once settled. A session with no claims says nothing
 * about the household, so it keeps the same user's stored key; rewriting it
 * would make the next session with claims look like a move and wipe.
 */
export function ownerToRecord(
  session: { userId: string; householdId: string | null },
  stored: string | null,
): string {
  if (session.householdId === null && stored !== null && ownerUser(stored) === session.userId) {
    return stored;
  }
  return ownerKey(session.userId, session.householdId);
}

/**
 * Local data is wiped when the user signs out, when someone other than the
 * recorded owner signs in, or when the same user's household has changed
 * (FR-5: joined, left or removed). A session the server ended keeps the
 * data, so unsynced recipes upload once the same user signs back in. An
 * owner recorded as a bare user id (before households could change) matches.
 */
export function localDataAction(session: SettledSession, owner: string | null): 'wipe' | 'keep' {
  // Nothing to wipe once a sign-out's wipe has run: online toggles must not repeat it.
  if (session.status === 'signedOut') return session.byUser && owner !== null ? 'wipe' : 'keep';
  if (owner === null || owner === session.userId) return 'keep';
  if (ownerUser(owner) !== session.userId) return 'wipe';
  return session.householdId === null || owner === ownerKey(session.userId, session.householdId)
    ? 'keep'
    : 'wipe';
}

/** The same user, now in another household. */
export function householdChanged(session: SettledSession, owner: string | null): boolean {
  return (
    session.status === 'signedIn' &&
    owner !== null &&
    owner.includes(':') &&
    ownerUser(owner) === session.userId &&
    localDataAction(session, owner) === 'wipe'
  );
}
