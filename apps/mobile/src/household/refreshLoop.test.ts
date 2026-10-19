import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { newRetryState, startRefreshLoop } from './refreshLoop';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('retries a failed refresh with a growing delay, and stops on success', async () => {
  const refresh = vi
    .fn<() => Promise<{ error: unknown }>>()
    .mockResolvedValueOnce({ error: new Error('offline') })
    .mockResolvedValueOnce({ error: null });
  startRefreshLoop(refresh, newRetryState());
  await vi.advanceTimersByTimeAsync(0);
  expect(refresh).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(refresh).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(600_000);
  expect(refresh).toHaveBeenCalledTimes(2);
});

it('a refresh that fails after the loop was stopped schedules nothing', async () => {
  let fail!: (value: { error: unknown }) => void;
  const refresh = vi.fn(() => new Promise<{ error: unknown }>((resolve) => (fail = resolve)));
  const stop = startRefreshLoop(refresh, newRetryState());
  stop();
  fail({ error: new Error('offline') });
  await vi.advanceTimersByTimeAsync(600_000);
  expect(refresh).toHaveBeenCalledTimes(1);
});
