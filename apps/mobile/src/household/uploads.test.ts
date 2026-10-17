import { expect, it } from 'vitest';
import { waitForUploads } from './uploads';

const queue = (counts: number[]) => ({
  getUploadQueueStats: async () => ({ count: counts.length > 1 ? counts.shift()! : counts[0]! }),
});

it('waits until this phone’s queued changes are sent', async () => {
  expect(await waitForUploads(queue([2, 1, 0]), { tries: 5, pauseMs: 1 })).toBe(true);
});

it('gives up, so Leave and Join never wipe unsent changes (Important 3)', async () => {
  expect(await waitForUploads(queue([3]), { tries: 3, pauseMs: 1 })).toBe(false);
});
