import { describe, expect, it, vi } from 'vitest';
import { createApp, type AppDeps } from './app';
import { UnauthorizedError } from './auth/verify';

const allowAll = () => Object.assign(() => true, { refund: vi.fn() });

function deps(overrides: Partial<AppDeps> = {}): AppDeps {
  return {
    verify: vi.fn().mockResolvedValue({ sub: 'user-1' }),
    asUser: vi.fn().mockResolvedValue([]) as unknown as AppDeps['asUser'],
    ping: vi.fn().mockResolvedValue(undefined),
    imports: {
      claim: vi.fn().mockResolvedValue({ outcome: { kind: 'missing' }, claims: { sub: 'user-1' } }),
      process: vi.fn().mockResolvedValue(undefined),
      usage: vi.fn().mockResolvedValue({ spentUsd: 0.42, capUsd: 2 }),
    },
    substitutions: { ask: vi.fn().mockResolvedValue({ kind: 'missing' }) },
    sharing: {
      create: vi.fn(),
      stop: vi.fn(),
      read: vi.fn(),
      photo: vi.fn(),
      save: vi.fn(),
    },
    household: {
      createInvite: vi.fn(),
      listInvites: vi.fn(),
      cancelInvite: vi.fn(),
      previewInvite: vi.fn(),
      acceptInvite: vi.fn(),
      setRole: vi.fn(),
      removeMember: vi.fn(),
      leave: vi.fn(),
      rename: vi.fn(),
      createFriendLink: vi.fn(),
      listFriendLinks: vi.fn(),
      revokeFriendLink: vi.fn(),
      listAcceptedInvites: vi.fn(),
      listAcceptedFriendLinks: vi.fn(),
    },
    signup: {
      grant: vi.fn().mockResolvedValue(true),
      friendLinkStatus: async () => 'live' as const,
    },
    feedback: { send: vi.fn() },
    limits: { email: () => true, code: () => true, ip: () => true, all: () => true },
    userLimits: { parse: allowAll(), upload: allowAll(), photos: allowAll() },
    codes: {
      authUrl: 'http://auth:9999',
      fetch: vi.fn(),
      lockout: { locked: () => false, fail: vi.fn(), clear: vi.fn() },
    },
    photos: {
      put: vi.fn().mockResolvedValue('stored'),
      get: vi.fn().mockResolvedValue(null),
      remove: vi.fn().mockResolvedValue(undefined),
    },
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

describe('per-person limits (#67)', () => {
  const refuse = () => Object.assign(() => false, { refund: vi.fn() });
  const counting = () =>
    Object.assign(
      vi.fn(() => true),
      { refund: vi.fn() },
    );
  const parse = (app: ReturnType<typeof createApp>) =>
    app.request(`/api/imports/${ID}/parse`, {
      method: 'POST',
      headers: { Authorization: 'Bearer jwt' },
    });

  it('answers 429 to an upload over the limit, before applying anything', async () => {
    const d = deps({ userLimits: { parse: allowAll(), upload: refuse(), photos: allowAll() } });
    const response = await post(createApp(d), '{"ops":[]}');
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: 'rate_limited' });
    expect(d.asUser).not.toHaveBeenCalled();
  });

  it('answers 429 to a parse over the limit, before claiming or fetching anything', async () => {
    const d = deps({ userLimits: { parse: refuse(), upload: allowAll(), photos: allowAll() } });
    expect((await parse(createApp(d))).status).toBe(429);
    expect(d.imports.claim).not.toHaveBeenCalled();
  });

  it('counts a parse that starts, per person, and gives back one that does not', async () => {
    const limit = counting();
    const d = deps({ userLimits: { parse: limit, upload: allowAll(), photos: allowAll() } });
    expect((await parse(createApp(d))).status).toBe(404);
    expect(limit).toHaveBeenCalledWith('user-1');
    expect(limit.refund).toHaveBeenCalledWith('user-1');
    vi.mocked(d.imports.claim).mockResolvedValue({
      outcome: { kind: 'claimed', row: {} },
      claims: { sub: 'user-1' },
    } as never);
    limit.refund.mockClear();
    expect((await parse(createApp(d))).status).toBe(202);
    expect(limit.refund).not.toHaveBeenCalled();
  });

  it('answers 429 to a photo over the limit without storing it, and 507 when storage is full', async () => {
    const jpeg = () =>
      createApp(d).request(`/api/photos/${ID}`, {
        method: 'PUT',
        headers: { Authorization: 'Bearer jwt', 'Content-Type': 'image/jpeg' },
        body: new Uint8Array([1, 2, 3]),
      });
    let d = deps({ userLimits: { parse: allowAll(), upload: allowAll(), photos: refuse() } });
    expect((await jpeg()).status).toBe(429);
    expect(d.photos.put).not.toHaveBeenCalled();
    d = deps();
    vi.mocked(d.photos.put).mockResolvedValue('storage_full');
    const response = await jpeg();
    expect(response.status).toBe(507);
    expect(await response.json()).toEqual({ error: 'storage_full' });
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

  it('purges photos then recipes as the user, then removes the photos’ files', async () => {
    const tx = vi
      .fn()
      .mockResolvedValueOnce([{ id: 'p1', household_id: 'h1' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }]);
    const asUser = vi.fn(async (_token: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx));
    const d = deps({ asUser: asUser as unknown as AppDeps['asUser'] });
    const response = await purge(createApp(d));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ purged: 2 });
    expect(asUser).toHaveBeenCalledTimes(1);
    expect(d.photos.remove).toHaveBeenCalledWith('h1', 'p1');
  });
});

describe('POST /api/imports/:id/parse', () => {
  it('answers 409 photos_pending while a photo import’s pages are still uploading', async () => {
    const d = deps();
    vi.mocked(d.imports.claim).mockResolvedValue({
      outcome: { kind: 'photos_pending' },
      claims: { sub: 'user-1' },
    } as never);
    const response = await createApp(d).request(`/api/imports/${ID}/parse`, {
      method: 'POST',
      headers: { Authorization: 'Bearer jwt' },
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'photos_pending' });
    expect(d.imports.process).not.toHaveBeenCalled();
  });

  const row = {
    id: ID,
    household_id: 'h',
    source_type: 'text' as const,
    source_text: 'Soup',
    source_url: null,
    claim: 'c',
    pages: [],
  };
  function parse(app: ReturnType<typeof createApp>, id = ID, token: string | null = 'jwt') {
    return app.request(`/api/imports/${id}/parse`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  }
  function withClaim(outcome: unknown) {
    const d = deps();
    d.imports.claim = vi.fn().mockResolvedValue({ outcome, claims: { sub: 'user-1' } });
    return d;
  }

  it('returns 401 without a token', async () => {
    const d = deps();
    expect((await parse(createApp(d), ID, null)).status).toBe(401);
    expect(d.imports.claim).not.toHaveBeenCalled();
  });

  it('returns 404 for an id that is not a UUID, without touching the database', async () => {
    const d = deps();
    expect((await parse(createApp(d), 'nope')).status).toBe(404);
    expect(d.imports.claim).not.toHaveBeenCalled();
  });

  it.each([
    [{ kind: 'missing' }, 404, { error: 'not_found' }],
    [{ kind: 'forbidden' }, 403, { error: 'forbidden' }],
    [{ kind: 'busy', status: 'ready' }, 409, { status: 'ready' }],
  ])('answers %j with %i', async (outcome, status, body) => {
    const d = withClaim(outcome);
    const response = await parse(createApp(d));
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual(body);
    expect(d.imports.process).not.toHaveBeenCalled();
  });

  it('answers 202 at once and parses in the background', async () => {
    const d = withClaim({ kind: 'claimed', row });
    let finish!: () => void;
    d.imports.process = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const response = await parse(createApp(d));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: 'parsing' });
    expect(d.imports.process).toHaveBeenCalledWith({ sub: 'user-1' }, row);
    finish();
  });

  it('a background failure does not crash the server', async () => {
    const d = withClaim({ kind: 'claimed', row });
    d.imports.process = vi.fn().mockRejectedValue(new Error('db gone'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await parse(createApp(d))).status).toBe(202);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe('GET /api/imports/usage', () => {
  it('returns this month and the cap', async () => {
    const response = await createApp(deps()).request('/api/imports/usage', {
      headers: { Authorization: 'Bearer jwt' },
    });
    expect(await response.json()).toEqual({ spentUsd: 0.42, capUsd: 2 });
  });
});

describe('/api/photos/:id', () => {
  const put = (
    app: ReturnType<typeof createApp>,
    body: Uint8Array<ArrayBuffer>,
    token: string | null = 'jwt',
  ) =>
    app.request(`/api/photos/${ID}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'image/jpeg',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body,
    });

  it('answers 401 without a token, and 404 for an id that is not a UUID', async () => {
    const d = deps();
    expect((await put(createApp(d), Uint8Array.from([1]), null)).status).toBe(401);
    const response = await createApp(d).request('/api/photos/nope', {
      headers: { Authorization: 'Bearer jwt' },
    });
    expect(response.status).toBe(404);
    expect(d.photos.get).not.toHaveBeenCalled();
  });

  it('maps each upload outcome to its status', async () => {
    const statuses: Record<string, number> = {
      stored: 204,
      missing: 404,
      gone: 410,
      forbidden: 403,
      not_jpeg: 415,
      wrong_size: 422,
    };
    for (const [outcome, status] of Object.entries(statuses)) {
      const d = deps();
      vi.mocked(d.photos.put).mockResolvedValue(outcome as never);
      expect((await put(createApp(d), Uint8Array.from([1]))).status).toBe(status);
    }
  });

  it('refuses a body over 3 MB without asking the service', async () => {
    const d = deps();
    expect((await put(createApp(d), new Uint8Array(3_000_001))).status).toBe(413);
    expect(d.photos.put).not.toHaveBeenCalled();
  });

  it('serves a photo as a JPEG no browser cache keeps (NFR-2)', async () => {
    const d = deps();
    vi.mocked(d.photos.get).mockResolvedValue(Uint8Array.from([0xff, 0xd8]));
    const response = await createApp(d).request(`/api/photos/${ID}`, {
      headers: { Authorization: 'Bearer jwt' },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/jpeg');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([0xff, 0xd8]);
  });
});

describe('POST /api/substitutions', () => {
  const body = {
    id: '11111111-1111-4111-8111-111111111111',
    recipe_id: '33333333-3333-4333-8333-333333333333',
    ingredient_id: '44444444-4444-4444-8444-444444444444',
  };
  const ask = (app: ReturnType<typeof createApp>, payload: unknown, token: string | null = 'jwt') =>
    app.request('/api/substitutions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    });

  it('answers 401 without a token and 400 for a bad body, without asking', async () => {
    const d = deps();
    expect((await ask(createApp(d), body, null)).status).toBe(401);
    expect((await ask(createApp(d), { ...body, extra: 1 })).status).toBe(400);
    expect(d.substitutions.ask).not.toHaveBeenCalled();
  });

  it('maps each outcome to its status and body', async () => {
    const cases: [object, number, unknown][] = [
      [{ kind: 'forbidden' }, 403, { error: 'forbidden' }],
      [{ kind: 'missing' }, 404, { error: 'not_found' }],
      [{ kind: 'quota' }, 402, { error: 'quota' }],
      [{ kind: 'ai_unavailable' }, 503, { error: 'ai_unavailable' }],
      [{ kind: 'invalid_output' }, 422, { error: 'invalid_output' }],
      [
        { kind: 'answer', answer: { options: [], note: 'No swap' }, ingredient_raw: '2 eggs' },
        200,
        { options: [], note: 'No swap', ingredient_raw: '2 eggs' },
      ],
    ];
    for (const [outcome, status, json] of cases) {
      const d = deps();
      vi.mocked(d.substitutions.ask).mockResolvedValue(outcome as never);
      const response = await ask(createApp(d), body);
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual(json);
    }
  });
});
