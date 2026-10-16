import { describe, expect, it, vi } from 'vitest';
import {
  PURGE_INTERVAL_MS,
  purgeDue,
  QUEUE_WAIT_TRIES,
  runPurgeIfDue,
  type PurgeDeps,
} from './purge';

describe('purgeDue', () => {
  const now = 1_800_000_000_000;
  it('is due when never run, when the record is unreadable, or after 24 hours', () => {
    expect(purgeDue(null, now)).toBe(true);
    expect(purgeDue('garbage', now)).toBe(true);
    expect(purgeDue(String(now - PURGE_INTERVAL_MS), now)).toBe(true);
  });

  it('is not due within 24 hours of the last run', () => {
    expect(purgeDue(String(now - PURGE_INTERVAL_MS + 1000), now)).toBe(false);
  });
});

describe('runPurgeIfDue', () => {
  const NOW = 1_800_000_000_000;

  function deps(overrides: Partial<PurgeDeps> = {}) {
    const items = new Map<string, string>();
    const storage = {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, value),
    };
    return {
      items,
      deps: {
        storage,
        now: () => NOW,
        pendingUploads: vi.fn().mockResolvedValue(0),
        send: vi.fn().mockResolvedValue(true),
        wait: vi.fn().mockResolvedValue(undefined),
        ...overrides,
      } satisfies PurgeDeps,
    };
  }

  // A restore queued offline must reach the server before the purge runs,
  // or the purge deletes the recipe and the restore is lost.
  it('waits for this device’s queued uploads before purging', async () => {
    const pendingUploads = vi
      .fn()
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1)
      .mockResolvedValue(0);
    const order: string[] = [];
    const send = vi.fn(async () => {
      order.push(`send after ${pendingUploads.mock.calls.length} checks`);
      return true;
    });
    const { deps: d } = deps({ pendingUploads, send });
    await runPurgeIfDue(d);
    expect(order).toEqual(['send after 3 checks']);
  });

  it('skips this time when uploads are still queued after the wait', async () => {
    const { deps: d, items } = deps({ pendingUploads: vi.fn().mockResolvedValue(1) });
    await runPurgeIfDue(d);
    expect(d.send).not.toHaveBeenCalled();
    expect(d.wait).toHaveBeenCalledTimes(QUEUE_WAIT_TRIES);
    expect(items.size).toBe(0);
  });

  it('records the time only after a successful purge', async () => {
    const failed = deps({ send: vi.fn().mockResolvedValue(false) });
    await runPurgeIfDue(failed.deps);
    expect(failed.items.size).toBe(0);

    const ok = deps();
    await runPurgeIfDue(ok.deps);
    expect([...ok.items.values()]).toEqual([String(NOW)]);
  });

  it('does nothing when the last purge was less than a day ago', async () => {
    const { deps: d, items } = deps();
    items.set('recipes.lastPurge', String(NOW - 1000));
    await runPurgeIfDue(d);
    expect(d.pendingUploads).not.toHaveBeenCalled();
    expect(d.send).not.toHaveBeenCalled();
  });
});
