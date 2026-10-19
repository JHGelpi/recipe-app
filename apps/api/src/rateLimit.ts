/** In-memory sliding window per key. One API process (family scale), so no shared store. */
export function createRateLimiter(opts: {
  limit: number;
  windowMs: number;
  now?: () => number;
}): (key: string) => boolean {
  const now = opts.now ?? Date.now;
  const hits = new Map<string, number[]>();
  return (key) => {
    const at = now();
    const recent = (hits.get(key) ?? []).filter((t) => at - t < opts.windowMs);
    const allowed = recent.length < opts.limit;
    if (allowed) recent.push(at);
    hits.set(key, recent);
    if (hits.size > 10_000) {
      for (const [k, times] of hits)
        if (times.every((t) => at - t >= opts.windowMs)) hits.delete(k);
    }
    return allowed;
  };
}
