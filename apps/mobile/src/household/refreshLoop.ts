export type RetryState = { at: number; delay: number; busy: boolean };

const FIRST_DELAY_MS = 5_000;
const MAX_DELAY_MS = 5 * 60 * 1000;

export const newRetryState = (): RetryState => ({ at: 0, delay: FIRST_DELAY_MS, busy: false });

/**
 * Refreshes the token, retrying with backoff while it fails (spec §6, Review
 * Focus 5). The state outlives one loop, so a new loop keeps the backoff.
 * Returns stop.
 */
export function startRefreshLoop(
  refresh: () => Promise<{ error: unknown }>,
  state: RetryState,
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const attempt = () => {
    if (stopped || state.busy) return;
    const wait = state.at - Date.now();
    if (wait > 0) {
      timer = setTimeout(attempt, wait);
      return;
    }
    state.busy = true;
    void refresh().then(({ error }) => {
      state.busy = false;
      if (stopped) return;
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
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
