import { peekPendingInvite } from '../household/pendingInvite';
import { peekPendingShare } from '../sharing/pending';
import { peekPendingFriend } from './pendingFriend';

export type PassSource = { kind: 'invite' | 'share' | 'friend'; code: string };

export const INVITE_ONLY =
  'Dishkept is invite-only for now. Ask someone who uses it to send you an invite.';
export const LINK_EXPIRED = 'This link has expired. Ask for a new one.';

/** The link this visitor arrived through, if any (production spec §4). Not consumed. */
export function passSource(): PassSource | null {
  const invite = peekPendingInvite();
  if (invite) return { kind: 'invite', code: invite };
  const share = peekPendingShare();
  if (share) return { kind: 'share', code: share.code };
  const friend = peekPendingFriend();
  return friend ? { kind: 'friend', code: friend } : null;
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

/** GoTrue's answer when the before_user_created hook refuses (Task 1, stack test). */
export function isInviteOnly(error: { status?: number; message?: string } | null): boolean {
  return error?.status === 403 && (error.message ?? '').includes('invite_only');
}
