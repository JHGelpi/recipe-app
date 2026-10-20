import { useQuery } from '@powersync/react';
import { useEffect, useRef } from 'react';
import { auth } from '../session/auth';
import type { Claims } from '../session/claims';
import { membershipAction } from './membership';
import { newRetryState, startRefreshLoop } from './refreshLoop';

const MEMBERSHIP_SQL = 'select household_id, role from memberships where user_id = ?';

/**
 * Refreshes the token when this user's synced membership no longer matches
 * it, so a role change or a move takes effect on the phone (spec §6). Retries
 * with backoff while offline (Review Focus 5); nothing runs after cleanup.
 */
export function useMembershipWatch(claims: Claims | null, enabled: boolean): void {
  const { data } = useQuery<{ household_id: string; role: string }>(MEMBERSHIP_SQL, [
    claims?.userId ?? '',
  ]);
  const retry = useRef(newRetryState());
  const row = data[0];
  const action = claims && enabled ? membershipAction(row, claims) : 'none';

  useEffect(() => {
    if (action !== 'refresh') return;
    return startRefreshLoop(() => auth.refreshSession(), retry.current);
  }, [action, row?.household_id, row?.role]);
}
