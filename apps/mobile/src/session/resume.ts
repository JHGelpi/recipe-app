import { takePendingInvite } from '../household/pendingInvite';
import { peekPendingShare } from '../sharing/pending';

/**
 * Where a person picks up after signing in: an invite (FR-3) or a shared
 * recipe to save (FR-27) opened while signed out. The shared page takes its
 * own entry when it loads.
 */
export function resumeAfterSignIn(): string | null {
  const invite = takePendingInvite();
  if (invite) return `/invite/${invite}`;
  const share = peekPendingShare();
  return share ? `/s/${share.code}` : null;
}
