// apps/mobile/src/photos/pick.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pickPhotos } from './pick';

class FakeInput extends EventTarget {
  type = '';
  accept = '';
  multiple = false;
  style: Record<string, string> = {};
  files: File[] | null = null;
  remove() {}
  click() {}
}

describe('pickPhotos', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('resolves with nothing when the picker closes without a cancel event', async () => {
    vi.useFakeTimers();
    const input = new FakeInput();
    const win = new EventTarget();
    vi.stubGlobal('document', { createElement: () => input, body: { append() {} } });
    vi.stubGlobal('window', win);
    const picked = pickPhotos(true);
    win.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(1500);
    await expect(picked).resolves.toEqual([]);
    vi.useRealTimers();
  });
});
