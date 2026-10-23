export type RateLimiter = ((key: string) => boolean) & { refund(key: string): void };

/**
 * In-memory sliding window per key. One API process (family scale), so no
 * shared store. Keys are swept once a window by time, and at `maxKeys` a new
 * key is refused until the sweep frees room, so memory stays bounded.
 */
export function createRateLimiter(opts: {
  limit: number;
  windowMs: number;
  maxKeys?: number;
  now?: () => number;
}): RateLimiter {
  const now = opts.now ?? Date.now;
  const maxKeys = opts.maxKeys ?? 10_000;
  const hits = new Map<string, number[]>();
  let sweepAt = 0;
  const take = (key: string): boolean => {
    const at = now();
    if (at >= sweepAt) {
      for (const [k, times] of hits)
        if (times.every((t) => at - t >= opts.windowMs)) hits.delete(k);
      sweepAt = at + opts.windowMs;
    }
    if (!hits.has(key) && hits.size >= maxKeys) return false;
    const recent = (hits.get(key) ?? []).filter((t) => at - t < opts.windowMs);
    const allowed = recent.length < opts.limit;
    if (allowed) recent.push(at);
    hits.set(key, recent);
    return allowed;
  };
  return Object.assign(take, {
    // Gives back the newest hit, for a request that failed after it was counted.
    refund(key: string): void {
      hits.get(key)?.pop();
    },
  });
}
