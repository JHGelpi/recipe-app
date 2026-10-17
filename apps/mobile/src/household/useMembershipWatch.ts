import { useQuery } from '@powersync/react';
import { useEffect, useRef } from 'react';
import { auth } from '../session/auth';
import type { Claims } from '../session/claims';
import { membershipAction } from './membership';

const MEMBERSHIP_SQL = 'select household_id, role from memberships where user_id = ?';
const FIRST_DELAY_MS = 5_000;
const MAX_DELAY_MS = 5 * 60 * 1000;

/**
 * Refreshes the token when this user's synced membership no longer matches
 * it, so a role change or a move takes effect on the phone (spec §6). Retries
 * with backoff while offline (Review Focus 5).
 */
export function useMembershipWatch(claims: Claims | null, enabled: boolean): void {
  const { data } = useQuery<{ household_id: string; role: string }>(MEMBERSHIP_SQL, [
    claims?.userId ?? '',
  ]);
  const retry = useRef({ at: 0, delay: FIRST_DELAY_MS, busy: false });
  const row = data[0];
  const action = claims && enabled ? membershipAction(row, claims) : 'none';

  useEffect(() => {
    if (action !== 'refresh') return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = () => {
      const state = retry.current;
      if (state.busy) return;
      const wait = state.at - Date.now();
      if (wait > 0) {
        timer = setTimeout(attempt, wait);
        return;
      }
      state.busy = true;
      void auth.refreshSession().then(({ error }) => {
        state.busy = false;
        if (error) {
          state.at = Date.now() + state.delay;
          state.delay = Math.min(MAX_DELAY_MS, state.delay * 2);
          timer = setTimeout(attempt, state.delay);
        } else {
          state.delay = FIRST_DELAY_MS;
        }
      });
    };
    attempt();
    return () => clearTimeout(timer);
  }, [action, row?.household_id, row?.role]);
}
