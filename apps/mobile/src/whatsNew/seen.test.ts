import { describe, expect, it } from 'vitest';
import { markSeen, recordStartingSeen, SEEN_KEY, seenVersion } from './seen';

function memory(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    items,
  };
}

describe('seen release notes on this device (FR-47)', () => {
  it('records a first visit as having seen the current version', () => {
    const storage = memory();
    expect(recordStartingSeen(storage, false, '1.1.0')).toBe('1.1.0');
    expect(storage.items.get(SEEN_KEY)).toBe('1.1.0');
  });

  it('records a device that already had the app as having seen nothing', () => {
    const storage = memory();
    expect(recordStartingSeen(storage, true, '1.1.0')).toBe('0.0.0');
    expect(seenVersion(storage, '1.1.0')).toBe('0.0.0');
  });

  it('keeps what an earlier start recorded', () => {
    const storage = memory({ [SEEN_KEY]: '1.0.0' });
    expect(recordStartingSeen(storage, true, '1.2.0')).toBe('1.0.0');
  });

  it('marks the current version seen, never lowering it', () => {
    const storage = memory({ [SEEN_KEY]: '0.0.0' });
    markSeen(storage, '1.2.0');
    expect(storage.items.get(SEEN_KEY)).toBe('1.2.0');
    markSeen(storage, '1.1.0');
    expect(storage.items.get(SEEN_KEY)).toBe('1.2.0');
  });

  it('works without storage, as when the browser blocks it', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(recordStartingSeen(blocked, false, '1.1.0')).toBe('1.1.0');
    expect(() => markSeen(blocked, '1.1.0')).not.toThrow();
    expect(seenVersion(undefined, '1.1.0')).toBe('1.1.0');
  });
});
