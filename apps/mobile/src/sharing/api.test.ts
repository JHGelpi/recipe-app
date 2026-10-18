import { describe, expect, it, vi } from 'vitest';
import { createShare, readShare, saveShare } from './api';

const deps = (response: Response | Error) => ({
  fetch: vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  }) as unknown as typeof fetch,
  apiUrl: 'https://app.test/api',
  token: 'jwt',
});
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const CODE = 'k3J9xQ2mZb7LwP0aYc5RdT8vNf1HgE4sUo6IiKjMnBq';

describe('sharing api', () => {
  it('creates a share and returns its code', async () => {
    const d = deps(json(201, { code: CODE }));
    expect(await createShare('r1', d)).toEqual({ ok: true, value: { code: CODE } });
  });

  it('reads a share without a token, and turns a 404 into its status', async () => {
    const fetchImpl = vi.fn(async () =>
      json(404, { status: 'stopped' }),
    ) as unknown as typeof fetch;
    expect(await readShare(CODE, fetchImpl, 'https://app.test/api')).toEqual({
      ok: false,
      status: 'stopped',
    });
    const [, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock
      .calls[0]!;
    expect(new Headers(init?.headers).has('Authorization')).toBe(false);
  });

  it.each([
    [403, 'forbidden', "Viewers can't add recipes. Ask an admin of your household."],
    [409, 'own_household', 'This recipe is already in your household'],
    [404, 'share_unavailable', 'This recipe is no longer shared'],
  ])('maps a save refusal %i to its message', async (status, error, message) => {
    expect(await saveShare(CODE, deps(json(status, { error })))).toEqual({ ok: false, message });
  });
});
