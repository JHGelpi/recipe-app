import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { registerSharingRoutes } from './routes';
import { ShareRefusal, type SharingService } from './service';

const RECIPE = '33333333-3333-4333-8333-333333333333';
const CODE = 'k3J9xQ2mZb7LwP0aYc5RdT8vNf1HgE4sUo6IiKjMnBq';

function app(over: Partial<SharingService> = {}) {
  const sharing = {
    create: vi.fn().mockResolvedValue({ code: CODE }),
    stop: vi.fn().mockResolvedValue(2),
    read: vi.fn().mockResolvedValue({ status: 'ok', snapshot: { title: 'Soup', photo: null } }),
    photo: vi.fn().mockResolvedValue(Uint8Array.from([0xff, 0xd8])),
    save: vi.fn().mockResolvedValue({ recipe_id: 'r2' }),
    ...over,
  } as SharingService;
  const hono = new Hono();
  registerSharingRoutes(hono, { sharing });
  return { hono, sharing };
}
const send = (
  hono: Hono,
  method: string,
  path: string,
  body?: unknown,
  token: string | null = 'jwt',
) =>
  hono.request(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe('sharing routes', () => {
  it('reads a share without a token, never cached', async () => {
    const { hono } = app();
    const response = await send(hono, 'GET', `/api/shares/${CODE}`, undefined, null);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({
      snapshot: { title: 'Soup', photo: null },
      has_photo: false,
    });
  });

  it('answers 404 with the status for a stopped, trashed or unknown share', async () => {
    const { hono } = app({
      read: vi.fn().mockResolvedValue({ status: 'trashed', snapshot: null }),
    });
    const response = await send(hono, 'GET', `/api/shares/${CODE}`, undefined, null);
    expect([response.status, await response.json()]).toEqual([404, { status: 'trashed' }]);
  });

  it('needs a token to create, stop or save, and checks bodies and codes', async () => {
    const { hono, sharing } = app();
    expect((await send(hono, 'POST', '/api/shares', { recipe_id: RECIPE }, null)).status).toBe(401);
    expect((await send(hono, 'POST', '/api/shares', { recipe_id: 'nope' })).status).toBe(400);
    expect((await send(hono, 'GET', '/api/shares/short', undefined, null)).status).toBe(404);
    expect((await send(hono, 'POST', '/api/shares', { recipe_id: RECIPE })).status).toBe(201);
    expect(
      await (await send(hono, 'POST', '/api/shares/stop', { recipe_id: RECIPE })).json(),
    ).toEqual({ stopped: 2 });
    expect((await send(hono, 'POST', `/api/shares/${CODE}/save`)).status).toBe(201);
    expect(sharing.create).toHaveBeenCalledTimes(1);
  });

  it('maps refusals: forbidden 403, share_unavailable and not_found 404, own_household 409', async () => {
    const refuse = (key: string) => vi.fn().mockRejectedValue(new ShareRefusal(key as never));
    expect(
      (await send(app({ save: refuse('forbidden') }).hono, 'POST', `/api/shares/${CODE}/save`))
        .status,
    ).toBe(403);
    expect(
      (
        await send(
          app({ save: refuse('share_unavailable') }).hono,
          'POST',
          `/api/shares/${CODE}/save`,
        )
      ).status,
    ).toBe(404);
    expect(
      (await send(app({ save: refuse('own_household') }).hono, 'POST', `/api/shares/${CODE}/save`))
        .status,
    ).toBe(409);
    expect(
      (
        await send(app({ create: refuse('not_found') }).hono, 'POST', '/api/shares', {
          recipe_id: RECIPE,
        })
      ).status,
    ).toBe(404);
  });
});
