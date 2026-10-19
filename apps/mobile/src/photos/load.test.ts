import { describe, expect, it, vi } from 'vitest';
import { loadPhoto, trimCache, type LoadDeps } from './load';

function deps(over: Partial<LoadDeps> = {}): LoadDeps {
  const store = new Map<string, Response>();
  return {
    readLocal: vi.fn().mockResolvedValue(new Blob(['local'])),
    fetchRemote: vi.fn().mockResolvedValue(new Response('remote', { status: 200 })),
    cache: {
      match: vi.fn(async (key: string) => store.get(key)?.clone()),
      put: vi.fn(async (key: string, response: Response) => void store.set(key, response)),
    } as unknown as LoadDeps['cache'],
    url: (id) => `/api/photos/${id}`,
    ...over,
  };
}

const text = async (blob: Blob | null) => (blob ? blob.text() : null);

describe('loadPhoto', () => {
  it('prefers the file kept on this phone', async () => {
    const d = deps();
    expect(await text(await loadPhoto('p1', 'idb://p1.jpg', true, d))).toBe('local');
    expect(d.fetchRemote).not.toHaveBeenCalled();
  });

  it('fetches online once, then serves from the cache, even offline', async () => {
    const d = deps();
    expect(await text(await loadPhoto('p1', null, true, d))).toBe('remote');
    expect(await text(await loadPhoto('p1', null, false, d))).toBe('remote');
    expect(d.fetchRemote).toHaveBeenCalledTimes(1);
  });

  it('gives nothing offline when never fetched, and nothing for a photo not uploaded yet', async () => {
    expect(await loadPhoto('p1', null, false, deps())).toBeNull();
    const missing = deps({
      fetchRemote: vi.fn().mockResolvedValue(new Response(null, { status: 404 })),
    });
    expect(await loadPhoto('p1', null, true, missing)).toBeNull();
    expect(missing.cache?.put).not.toHaveBeenCalled();
  });

  it('falls back to the network when the local file is gone', async () => {
    const d = deps({ readLocal: vi.fn().mockRejectedValue(new Error('evicted')) });
    expect(await text(await loadPhoto('p1', 'idb://p1.jpg', true, d))).toBe('remote');
  });
});

describe('the photo cache (spec §3)', () => {
  it('keeps the newest 50 entries', async () => {
    const keys = Array.from(
      { length: 53 },
      (_, i) => new Request(`https://app.test/api/photos/${i}`),
    );
    const deleted: string[] = [];
    await trimCache(
      {
        keys: async () => keys,
        delete: async (request) => {
          deleted.push((request as Request).url);
          return true;
        },
      },
      50,
    );
    expect(deleted).toEqual([0, 1, 2].map((i) => `https://app.test/api/photos/${i}`));
  });
});
