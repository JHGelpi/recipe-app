import { describe, expect, it, vi } from 'vitest';
import { fetchUsage, requestParse } from './api';

const deps = (response: Response | Error) => ({
  fetch: vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  }) as unknown as typeof fetch,
  apiUrl: 'https://app.test/api',
  token: 'jwt',
});

describe('requestParse', () => {
  it('treats photos still uploading as worth another try soon', async () => {
    const d = deps(new Response(JSON.stringify({ error: 'photos_pending' }), { status: 409 }));
    expect(await requestParse('i1', d)).toBe('retry');
  });

  it.each([
    [202, 'started'],
    [409, 'busy'],
    [404, 'not_found'],
    [403, 'forbidden'],
    [401, 'reauth'],
    [500, 'retry'],
    [429, 'retry'],
  ] as const)('maps %i to %s', async (status, outcome) => {
    expect(await requestParse('i1', deps(new Response(null, { status })))).toBe(outcome);
  });

  it('posts to the import with the token, and retries on a network error', async () => {
    const d = deps(new Response(null, { status: 202 }));
    await requestParse('i1', d);
    expect(d.fetch).toHaveBeenCalledWith('https://app.test/api/imports/i1/parse', {
      method: 'POST',
      headers: { Authorization: 'Bearer jwt' },
    });
    expect(await requestParse('i1', deps(new TypeError('offline')))).toBe('retry');
  });
});

describe('fetchUsage', () => {
  it('reads the usage, or null when it cannot', async () => {
    const ok = new Response(JSON.stringify({ spentUsd: 0.42, capUsd: 2 }), { status: 200 });
    expect(await fetchUsage(deps(ok))).toEqual({ spentUsd: 0.42, capUsd: 2 });
    expect(await fetchUsage(deps(new Response('{"spentUsd":"x"}', { status: 200 })))).toBeNull();
    expect(await fetchUsage(deps(new Response(null, { status: 500 })))).toBeNull();
    expect(await fetchUsage(deps(new TypeError('offline')))).toBeNull();
  });
});
