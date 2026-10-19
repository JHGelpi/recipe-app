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
  };
}

const base = {
  gateway: {
    callTool: vi
      .fn()
      .mockResolvedValue({ input: { title: 'Soup' }, usage: { inputTokens: 0, outputTokens: 0 } }),
  },
  fetchPage: vi.fn(),
  photos: { read: vi.fn() },
  ai: { capUsd: 2, priceInputPerMTokUsd: 3, priceOutputPerMTokUsd: 15 },
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
});
