import { peekPendingInvite } from '../household/pendingInvite';
import { peekPendingShare } from '../sharing/pending';
import { latestLink, type LinkKind } from './latestLink';
import { peekPendingFriend } from './pendingFriend';

export type PassSource = { kind: 'invite' | 'share' | 'friend'; code: string };

export const INVITE_ONLY =
  'Dishkept is invite-only for now. Ask someone who uses it to send you an invite.';
export const LINK_EXPIRED =
  'This invitation has expired or has already been used. Ask the sender for a new one.';

const ORDER: LinkKind[] = ['invite', 'share', 'friend'];
const CODES: Record<LinkKind, () => string | null> = {
  invite: peekPendingInvite,
  share: () => peekPendingShare()?.code ?? null,
  friend: peekPendingFriend,
};

/** The link this visitor arrived through, the latest first (production spec §4). Not consumed. */
export function passSource(): PassSource | null {
  const latest = latestLink();
  const order = latest ? [latest, ...ORDER.filter((kind) => kind !== latest)] : ORDER;
  for (const kind of order) {
    const code = CODES[kind]();
    if (code) return { kind, code };
  }
  return null;
}

/** Asks for a 24-hour sign-up pass. Any refusal, rate limits included, reads as expired. */
export async function askForPass(
  source: PassSource,
  email: string,
  deps: { fetch: typeof fetch; apiUrl: string },
): Promise<'granted' | 'expired' | 'offline'> {
  try {
    const response = await deps.fetch(`${deps.apiUrl}/signup-pass`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: source.kind, code: source.code, email }),
    });
    return response.ok ? 'granted' : 'expired';
  } catch {
    return 'offline';
  }
}

export const FRIEND_LINK_ENDED = 'This invitation has ended. Ask the sender for a new one.';
export const FRIEND_LINK_USED =
  'This invitation has already been used. Ask the sender for a new one.';

/**
 * Whether a friend link still works, asked signed out. Only a definite "no"
 * reads as ended; offline or a server error leaves it to the pass check.
 */
export async function friendLinkStatus(
  code: string,
  deps: { fetch: typeof fetch; apiUrl: string },
): Promise<'live' | 'ended' | 'used'> {
  try {
    const response = await deps.fetch(`${deps.apiUrl}/friend-links/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    if (!response.ok) return 'live';
    const json = (await response.json().catch(() => null)) as { status?: string } | null;
    if (json?.status === 'used') return 'used';
    return json?.status === 'ended' || json?.status === 'unknown' ? 'ended' : 'live';
  } catch {
    return 'live';
  }
}

/** GoTrue's answer when the before_user_created hook refuses (Task 1, stack test). */
export function isInviteOnly(error: { status?: number; message?: string } | null): boolean {
  return error?.status === 403 && (error.message ?? '').includes('invite_only');
}
