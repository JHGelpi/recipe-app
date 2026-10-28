export type Lockout = {
  /** True once `limit` failures for this key fall within the window. */
  locked(key: string): boolean;
  fail(key: string): void;
  clear(key: string): void;
};

/**
 * Issue #72: wrong sign-in codes counted per email, in memory like the other
 * limiters (one API process, family scale). Keys whose failures have all aged
 * out are swept once a window; at `maxKeys` the oldest key is dropped, so
 * memory stays bounded.
 */
export function createLockout(opts: {
  limit: number;
  windowMs: number;
  maxKeys?: number;
  now?: () => number;
}): Lockout {
  const now = opts.now ?? Date.now;
  const maxKeys = opts.maxKeys ?? 10_000;
  const failures = new Map<string, number[]>();
  let sweepAt = 0;
  const recent = (key: string, at: number) =>
    (failures.get(key) ?? []).filter((t) => at - t < opts.windowMs);
  return {
    locked(key) {
      return recent(key, now()).length >= opts.limit;
    },
    fail(key) {
      const at = now();
      if (at >= sweepAt) {
        for (const [k, times] of failures)
          if (times.every((t) => at - t >= opts.windowMs)) failures.delete(k);
        sweepAt = at + opts.windowMs;
      }
      if (!failures.has(key) && failures.size >= maxKeys) {
        failures.delete(failures.keys().next().value!);
      }
      failures.set(key, [...recent(key, at), at]);
    },
    clear(key) {
      failures.delete(key);
    },
  };
}
