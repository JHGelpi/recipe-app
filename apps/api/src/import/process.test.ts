import { describe, expect, it, vi } from 'vitest';
import { syntheticJpeg } from '../../../../test-support/jpeg';
import { AI_ATTEMPTS, AI_TIMEOUT_MS, AiUnavailableError, type Gateway } from '../llm/gateway';
import { FETCH_DEFAULTS } from './fetchPage';
import type { FetchResult } from './fetchPage';
import { processImport, type ProcessDeps } from './process';
import {
  STALE_PARSE_SECONDS,
  type ClaimedImport,
  type ImportStore,
  type ParseResult,
} from './store';

const claims = { sub: 'u1', household_id: 'h1', household_role: 'member', exp: 0 };
const textRow: ClaimedImport = {
  id: 'i1',
  household_id: 'h1',
  source_type: 'text',
  source_text: 'Soup\n- 1 onion',
  source_url: null,
  claim: 'c',
  pages: [],
};
const urlRow: ClaimedImport = {
  ...textRow,
  source_type: 'url',
  source_text: null,
  source_url: 'https://example.com/soup',
};
const prices = { capUsd: 2, priceInputPerMTokUsd: 3, priceOutputPerMTokUsd: 15 };

function setup(
  over: {
    spent?: number;
    gateway?: Gateway['callTool'];
    page?: FetchResult | Error;
    files?: Record<string, Uint8Array | null>;
  } = {},
) {
  const finished: { result: ParseResult; spent: number }[] = [];
  const store: ImportStore = {
    claim: vi.fn(),
    spent: vi.fn(),
    context: vi.fn().mockResolvedValue({ spentMicroUsd: over.spent ?? 0, tags: ['dinner'] }),
    finish: vi.fn(async (_c, _r, result: ParseResult, spent: number) => {
      finished.push({ result, spent });
    }),
  };
  const callTool = vi.fn(
    over.gateway ??
      (async () => ({
        input: { is_recipe: true, title: 'Soup' },
        usage: { inputTokens: 1000, outputTokens: 500 },
      })),
  );
  const page = over.page;
  const fetchPage = vi.fn(async (): Promise<FetchResult> => {
    if (page instanceof Error) throw page;
    return page ?? { ok: true, html: '<p>Soup</p>', url: urlRow.source_url! };
  });
  const photos = { read: vi.fn(async (_h: string, id: string) => over.files?.[id] ?? null) };
  const deps: ProcessDeps = {
    store,
    gateway: { callTool },
    fetchPage,
    photos,
    ai: prices,
    log: vi.fn(),
  };
  return { deps, finished, callTool, fetchPage, store, photos };
}

describe('processImport', () => {
  const photoRow: ClaimedImport = {
    ...textRow,
    source_type: 'photo',
    source_text: null,
    pages: ['p1', 'p2'],
  };

  it('reads a photo import’s pages in order and sends them as images', async () => {
    const { deps, finished, callTool, photos } = setup({
      files: { p1: syntheticJpeg(2, 2, 'a'), p2: syntheticJpeg(2, 2, 'b') },
    });
    await processImport(deps, claims, photoRow);
    expect(photos.read.mock.calls.map((call) => call[1])).toEqual(['p1', 'p2']);
    const request = callTool.mock.calls[0]![0];
    expect(
      (request.user as { type: string }[]).filter((block) => block.type === 'image'),
    ).toHaveLength(2);
    expect(finished[0]?.result.status).toBe('ready');
  });

  it('fails as photo_unreadable when a page is missing or not a JPEG, without calling Claude', async () => {
    const cases: Record<string, Uint8Array | null>[] = [
      { p1: syntheticJpeg(2, 2) },
      { p1: syntheticJpeg(2, 2), p2: Uint8Array.from([1, 2]) },
    ];
    for (const files of cases) {
      const { deps, finished, callTool } = setup({ files });
      await processImport(deps, claims, photoRow);
      expect(finished[0]?.result).toEqual({ status: 'failed', error: 'photo_unreadable' });
      expect(callTool).not.toHaveBeenCalled();
    }
  });

  it('checks the cap before sending photos', async () => {
    const { deps, finished, callTool } = setup({
      spent: 2_000_000,
      files: { p1: syntheticJpeg(2, 2), p2: syntheticJpeg(2, 2) },
    });
    await processImport(deps, claims, photoRow);
    expect(finished[0]?.result).toEqual({ status: 'failed', error: 'quota' });
    expect(callTool).not.toHaveBeenCalled();
  });

  it('parses text into a ready draft and records the spend', async () => {
    const { deps, finished, callTool } = setup();
    await processImport(deps, claims, textRow);
    expect(finished).toEqual([
      {
        result: { status: 'ready', draft: expect.objectContaining({ title: 'Soup' }) },
        spent: 10_500,
      },
    ]);
    expect(callTool.mock.calls[0]?.[0].user).toContain('dinner');
  });

  it('refuses at the cap without calling the AI', async () => {
    const { deps, finished, callTool } = setup({ spent: 2_000_000 });
    await processImport(deps, claims, textRow);
    expect(finished).toEqual([{ result: { status: 'failed', error: 'quota' }, spent: 0 }]);
    expect(callTool).not.toHaveBeenCalled();
  });

  it('reports the AI as unavailable and records nothing', async () => {
    const { deps, finished } = setup({
      gateway: async () => {
        throw new AiUnavailableError('down');
      },
    });
    await processImport(deps, claims, textRow);
    expect(finished).toEqual([{ result: { status: 'failed', error: 'ai_unavailable' }, spent: 0 }]);
  });

  it('records the spend of an answer it could not use', async () => {
    const { deps, finished } = setup({
      gateway: async () => ({
        input: { is_recipe: true, title: '' },
        usage: { inputTokens: 1000, outputTokens: 500 },
      }),
    });
    await processImport(deps, claims, textRow);
    expect(finished).toEqual([
      { result: { status: 'failed', error: 'invalid_output' }, spent: 10_500 },
    ]);
  });

  it('reports a source with no recipe', async () => {
    const { deps, finished } = setup({
      gateway: async () => ({
        input: { is_recipe: false, title: 'x' },
        usage: { inputTokens: 1, outputTokens: 1 },
      }),
    });
    await processImport(deps, claims, textRow);
    expect(finished[0]?.result).toEqual({ status: 'failed', error: 'not_a_recipe' });
  });

  it('reads JSON-LD without the AI', async () => {
    const html = `<script type="application/ld+json">{"@type":"Recipe","name":"Lasagna","author":"Jane"}</script>`;
    const { deps, finished, callTool, store } = setup({
      page: { ok: true, html, url: urlRow.source_url! },
    });
    await processImport(deps, claims, urlRow);
    expect(finished[0]).toMatchObject({
      result: { status: 'ready', draft: { title: 'Lasagna', author: 'Jane' } },
      spent: 0,
    });
    expect(callTool).not.toHaveBeenCalled();
    expect(store.context).not.toHaveBeenCalled();
  });

  it('sends page text and the URL to the AI when there is no JSON-LD', async () => {
    const { deps, callTool } = setup({
      page: { ok: true, html: '<h1>Soup</h1><li>1 onion</li>', url: urlRow.source_url! },
    });
    await processImport(deps, claims, urlRow);
    const user = callTool.mock.calls[0]?.[0].user ?? '';
    expect(user).toContain('Source page: https://example.com/soup');
    expect(user).toContain('Soup\n- 1 onion');
  });

  it.each(['fetch_failed', 'blocked_address'] as const)(
    'passes on %s from the fetch',
    async (error) => {
      const { deps, finished } = setup({ page: { ok: false, error } });
      await processImport(deps, claims, urlRow);
      expect(finished[0]?.result).toEqual({ status: 'failed', error });
    },
  );

  it('writes ai_unavailable when something unexpected throws', async () => {
    const { deps, finished } = setup({ page: new Error('boom') });
    await processImport(deps, claims, urlRow);
    expect(finished[0]?.result).toEqual({ status: 'failed', error: 'ai_unavailable' });
  });
});

it('a parse always ends before it can be reclaimed as stuck, so no import is parsed and billed twice', () => {
  const worstCaseMs = FETCH_DEFAULTS.timeoutMs + AI_TIMEOUT_MS * AI_ATTEMPTS + 30_000; // retry backoff and the writes
  expect(worstCaseMs).toBeLessThan(STALE_PARSE_SECONDS * 1000);
});
