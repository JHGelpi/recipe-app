import { describe, expect, it } from 'vitest';
import { afterKick, backoffMs, dueKicks, needsKick, STALE_MS } from './kicker';

const now = Date.parse('2026-10-17T10:10:00Z');

describe('backoffMs', () => {
  it('starts at 5 s, doubles, and stops at 5 minutes', () => {
    expect([1, 2, 3, 4].map(backoffMs)).toEqual([5_000, 10_000, 20_000, 40_000]);
    expect(backoffMs(20)).toBe(300_000);
  });
});

describe('needsKick', () => {
  it('kicks pending imports and parses stuck for over 2 minutes', () => {
    expect(needsKick({ id: 'a', status: 'pending', parse_started_at: null }, now)).toBe(true);
    expect(
      needsKick(
        { id: 'b', status: 'parsing', parse_started_at: '2026-10-17 10:07:00.123456Z' },
        now,
      ),
    ).toBe(true);
    expect(
      needsKick({ id: 'c', status: 'parsing', parse_started_at: '2026-10-17T10:09:00Z' }, now),
    ).toBe(false);
    expect(needsKick({ id: 'd', status: 'ready', parse_started_at: null }, now)).toBe(false);
    expect(needsKick({ id: 'e', status: 'failed', parse_started_at: null }, now)).toBe(false);
  });
});

describe('dueKicks', () => {
  it('skips imports in flight or still backing off', () => {
    const rows = ['a', 'b', 'c'].map((id) => ({
      id,
      status: 'pending' as const,
      parse_started_at: null,
    }));
    const attempts = new Map([['b', { failures: 1, nextAt: now + 1 }]]);
    expect(dueKicks(rows, attempts, new Set(['c']), now)).toEqual(['a']);
  });
});

describe('afterKick', () => {
  it('after a start or a busy answer, waits for the result to sync', () => {
    expect(afterKick(undefined, 'started', now)).toEqual({ failures: 0, nextAt: now + STALE_MS });
    expect(afterKick({ failures: 3, nextAt: 0 }, 'busy', now)).toEqual({
      failures: 0,
      nextAt: now + STALE_MS,
    });
  });

  it('after a failure, backs off further each time', () => {
    const first = afterKick(undefined, 'retry', now);
    expect(first).toEqual({ failures: 1, nextAt: now + 5_000 });
    expect(afterKick(first, 'not_found', now)).toEqual({ failures: 2, nextAt: now + 10_000 });
  });
});
