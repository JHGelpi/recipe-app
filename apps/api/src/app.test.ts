import { describe, expect, it, vi } from 'vitest';
import { createApp, type AppDeps } from './app';
import { UnauthorizedError } from './auth/verify';

function deps(overrides: Partial<AppDeps> = {}): AppDeps {
  return {
    verify: vi.fn().mockResolvedValue({ sub: 'user-1' }),
    asUser: vi.fn().mockResolvedValue([]) as unknown as AppDeps['asUser'],
    ping: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function post(app: ReturnType<typeof createApp>, body: string, token: string | null = 'jwt') {
  return app.request('/api/upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body,
  });
}

const ID = '11111111-1111-4111-8111-111111111111';

describe('GET /api/health', () => {
  it('answers 200 when the database answers', async () => {
    const response = await createApp(deps()).request('/api/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it('answers 500 when the database does not', async () => {
    const app = createApp(deps({ ping: vi.fn().mockRejectedValue(new Error('down')) }));
    expect((await app.request('/api/health')).status).toBe(500);
  });
});

describe('POST /api/upload', () => {
  it('returns 401 with no token and never verifies or touches the database', async () => {
    const d = deps();
    const response = await post(createApp(d), '{"ops":[]}', null);
    expect(response.status).toBe(401);
    expect(d.verify).not.toHaveBeenCalled();
    expect(d.asUser).not.toHaveBeenCalled();
  });

  it('returns 401 for a refused token even when the body is also malformed', async () => {
    const d = deps({ verify: vi.fn().mockRejectedValue(new UnauthorizedError('bad')) });
    const response = await post(createApp(d), '{not json');
    expect(response.status).toBe(401);
    expect(d.asUser).not.toHaveBeenCalled();
  });

  it('returns 500, not 401, when the token cannot be checked', async () => {
    const d = deps({ verify: vi.fn().mockRejectedValue(new Error('key set unreachable')) });
    const response = await post(createApp(d), '{"ops":[]}');
    expect(response.status).toBe(500);
    expect(d.asUser).not.toHaveBeenCalled();
  });

  it.each([
    ['text that is not JSON', '{not json'],
    ['an object with no ops', '{}'],
    ['ops that is not an array', '{"ops":"nope"}'],
    ['an op with missing fields', '{"ops":[{"op":"put"}]}'],
    ['an op with an unknown verb', `{"ops":[{"op":"drop","table":"recipes","id":"${ID}"}]}`],
    ['an op with an id that is not a UUID', '{"ops":[{"op":"put","table":"recipes","id":"1"}]}'],
    ['an unknown top-level field', '{"ops":[],"extra":true}'],
  ])('returns 400 for %s and applies nothing', async (_name, body) => {
    const d = deps();
    const response = await post(createApp(d), body);
    expect(response.status).toBe(400);
    expect(d.asUser).not.toHaveBeenCalled();
  });

  it('returns 400 for 501 ops and applies nothing', async () => {
    const d = deps();
    const ops = Array.from({ length: 501 }, () => ({ op: 'put', table: 'recipes', id: ID }));
    const response = await post(createApp(d), JSON.stringify({ ops }));
    expect(response.status).toBe(400);
    expect(d.asUser).not.toHaveBeenCalled();
  });

  it('accepts exactly 500 ops', async () => {
    const d = deps();
    const ops = Array.from({ length: 500 }, () => ({ op: 'put', table: 'recipes', id: ID }));
    expect((await post(createApp(d), JSON.stringify({ ops }))).status).toBe(200);
    expect(d.asUser).toHaveBeenCalledTimes(1);
  });

  it('returns 413 for a body over 1 MB and applies nothing', async () => {
    const d = deps();
    const body = JSON.stringify({ ops: [], padding: 'x'.repeat(1024 * 1024) });
    const response = await post(createApp(d), body);
    expect(response.status).toBe(413);
    expect(d.asUser).not.toHaveBeenCalled();
  });

  it('returns the per-op results from the transaction', async () => {
    const results = [{ id: ID, status: 'applied' }];
    const d = deps({ asUser: vi.fn().mockResolvedValue(results) as unknown as AppDeps['asUser'] });
    const response = await post(createApp(d), '{"ops":[]}');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ results });
  });

  it('returns 500 when the transaction fails', async () => {
    const d = deps({
      asUser: vi
        .fn()
        .mockRejectedValue(new Error('connection lost')) as unknown as AppDeps['asUser'],
    });
    expect((await post(createApp(d), '{"ops":[]}')).status).toBe(500);
  });
});

describe('POST /api/trash/purge', () => {
  function purge(app: ReturnType<typeof createApp>, token: string | null = 'jwt') {
    return app.request('/api/trash/purge', {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  }

  it('returns 401 with no token and never touches the database', async () => {
    const d = deps();
    expect((await purge(createApp(d), null)).status).toBe(401);
    expect(d.asUser).not.toHaveBeenCalled();
  });

  it('runs one delete as the user and returns how many rows it removed', async () => {
    const tx = vi.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    const asUser = vi.fn(async (_token: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx));
    const d = deps({ asUser: asUser as unknown as AppDeps['asUser'] });
    const response = await purge(createApp(d));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ purged: 2 });
    expect(asUser).toHaveBeenCalledTimes(1);
    expect(asUser.mock.calls[0]?.[0]).toBe('jwt');
  });
});
