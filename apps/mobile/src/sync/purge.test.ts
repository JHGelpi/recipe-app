import { describe, expect, it } from 'vitest';
import { PURGE_INTERVAL_MS, purgeDue } from './purge';

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
