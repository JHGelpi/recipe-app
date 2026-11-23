import { describe, expect, it, vi } from 'vitest';
import { UnauthorizedError } from '../auth/verify';
import { createImportService } from './service';
import type { ImportStore } from './store';

const claims = { sub: 'u1', household_id: 'h1', household_role: 'member', exp: 0 };

function store(): ImportStore {
  return {
    claim: vi.fn().mockResolvedValue({ kind: 'missing' }),
    spent: vi.fn().mockResolvedValue(420_000),
    context: vi.fn().mockResolvedValue({ spentMicroUsd: 0, tags: [] }),
    reserve: vi.fn().mockResolvedValue(true),
    finish: vi.fn().mockResolvedValue(undefined),
    imageUrl: vi.fn().mockResolvedValue('https://a.test/b.jpg'),
  };
}

const base = {
  gateway: {
    callTool: vi
      .fn()
      .mockResolvedValue({ input: { title: 'Soup' }, usage: { inputTokens: 0, outputTokens: 0 } }),
  },
  fetchPage: vi.fn(),
  fetchImage: vi
    .fn()
    .mockResolvedValue({ ok: true, bytes: Uint8Array.from([7]), type: 'image/png' }),
  photos: { read: vi.fn() },
  ai: { capUsd: 2, globalCapUsd: 10, priceInputPerMTokUsd: 3, priceOutputPerMTokUsd: 15 },
};

describe('createImportService', () => {
  it('a viewer cannot claim, and the store is not asked', async () => {
    const s = store();
    const verify = vi.fn().mockResolvedValue({ ...claims, household_role: 'viewer' });
    const service = createImportService({ ...base, store: s, verify });
    expect((await service.claim('jwt', 'i1')).outcome).toEqual({ kind: 'forbidden' });
    expect(s.claim).not.toHaveBeenCalled();
  });

  it('finishes a parse after the token has expired: the claims were checked once', async () => {
    const s = store();
    const verify = vi
      .fn()
      .mockResolvedValueOnce(claims)
      .mockRejectedValue(new UnauthorizedError('expired'));
    const service = createImportService({ ...base, store: s, verify });
    const row = {
      id: 'i1',
      household_id: 'h1',
      source_type: 'text' as const,
      source_text: 'Soup',
      source_url: null,
      claim: 'c',
      pages: [],
    };
    const claimed = await service.claim('jwt', 'i1');
    await service.process(claimed.claims, row);
    expect(s.finish).toHaveBeenCalledWith(
      claims,
      row,
      expect.objectContaining({ status: 'ready' }),
      0,
      50_000,
    );
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it('reports this month in dollars with the cap', async () => {
    const service = createImportService({
      ...base,
      store: store(),
      verify: vi.fn().mockResolvedValue(claims),
    });
    expect(await service.usage('jwt')).toEqual({ spentUsd: 0.42, capUsd: 2 });
  });

  describe('image (#116)', () => {
    const member = vi.fn().mockResolvedValue(claims);

    it('fetches only the link stored on the draft', async () => {
      const fetchImage = vi
        .fn()
        .mockResolvedValue({ ok: true, bytes: Uint8Array.from([7]), type: 'image/png' });
      const s = store();
      const service = createImportService({ ...base, fetchImage, store: s, verify: member });
      expect(await service.image('jwt', 'i1')).toEqual({
        kind: 'ok',
        bytes: Uint8Array.from([7]),
        type: 'image/png',
      });
      expect(s.imageUrl).toHaveBeenCalledWith(claims, 'i1');
      expect(fetchImage).toHaveBeenCalledWith('https://a.test/b.jpg');
    });

    it('a viewer is refused before anything is read', async () => {
      const s = store();
      const verify = vi.fn().mockResolvedValue({ ...claims, household_role: 'viewer' });
      const service = createImportService({ ...base, store: s, verify });
      expect(await service.image('jwt', 'i1')).toEqual({ kind: 'forbidden' });
      expect(s.imageUrl).not.toHaveBeenCalled();
    });

    it('is missing without a link, and failed when the fetch fails', async () => {
      const s = store();
      vi.mocked(s.imageUrl).mockResolvedValueOnce(null);
      const fetchImage = vi.fn().mockResolvedValue({ ok: false, error: 'blocked_address' });
      const service = createImportService({ ...base, fetchImage, store: s, verify: member });
      expect(await service.image('jwt', 'i1')).toEqual({ kind: 'missing' });
      expect(fetchImage).not.toHaveBeenCalled();
      expect(await service.image('jwt', 'i1')).toEqual({ kind: 'failed' });
    });
  });
});
