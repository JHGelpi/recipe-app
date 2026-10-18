import { describe, expect, it } from 'vitest';
import { statusLabel } from './statusLabel';

describe('the sync status line', () => {
  it('counts unsynced changes once the count is known', () => {
    expect(statusLabel(true, 0)).toBe('Online · 0 unsynced');
    expect(statusLabel(false, 2)).toBe('Offline · 2 unsynced');
  });

  it('does not claim "0 unsynced" before the count has loaded', () => {
    expect(statusLabel(true, undefined)).toBe('Online');
    expect(statusLabel(false, undefined)).toBe('Offline');
  });
});
