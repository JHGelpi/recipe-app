import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { registerHouseholdRoutes } from './routes';
import { HouseholdRefusal, type HouseholdService } from './service';

const USER = '22222222-2222-4222-8222-222222222222';
const CODE = 'k3J9xQ2mZb7LwP0aYc5RdT8vNf1HgE4sUo6IiKjMnBq';

function app(over: Partial<HouseholdService> = {}) {
  const household = {
    createInvite: vi.fn().mockResolvedValue({ id: 'i1', code: CODE, expires_at: 'x' }),
    listInvites: vi.fn().mockResolvedValue([]),
    cancelInvite: vi.fn().mockResolvedValue(undefined),
    previewInvite: vi.fn().mockResolvedValue({ status: 'ok' }),
    acceptInvite: vi.fn().mockResolvedValue({ household_id: 'h1', moved_recipes: 0 }),
    setRole: vi.fn().mockResolvedValue(undefined),
    removeMember: vi.fn().mockResolvedValue(undefined),
    leave: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
    ...over,
  } as HouseholdService;
  const hono = new Hono();
  registerHouseholdRoutes(hono, { household });
  return { hono, household };
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

describe('household routes', () => {
  it('answers 401 without a token and 400 for a bad body, without calling the service', async () => {
    const { hono, household } = app();
    expect((await send(hono, 'POST', '/api/invites', { role: 'member' }, null)).status).toBe(401);
    expect((await send(hono, 'POST', '/api/invites', { role: 'owner' })).status).toBe(400);
    expect((await send(hono, 'POST', '/api/invites/accept', { token: 'short' })).status).toBe(400);
    expect((await send(hono, 'PATCH', '/api/household', { name: ' ' })).status).toBe(400);
    expect(household.createInvite).not.toHaveBeenCalled();
  });

  it('answers each success with its status', async () => {
    const { hono } = app();
    expect((await send(hono, 'POST', '/api/invites', { role: 'member' })).status).toBe(201);
    expect((await send(hono, 'GET', '/api/invites')).status).toBe(200);
    expect((await send(hono, 'POST', '/api/invites/preview', { token: CODE })).status).toBe(200);
    expect((await send(hono, 'POST', '/api/invites/accept', { token: CODE })).status).toBe(200);
    expect((await send(hono, 'PATCH', `/api/members/${USER}`, { role: 'viewer' })).status).toBe(
      204,
    );
    expect((await send(hono, 'DELETE', `/api/members/${USER}`)).status).toBe(204);
    expect((await send(hono, 'POST', '/api/household/leave')).status).toBe(204);
    expect((await send(hono, 'PATCH', '/api/household', { name: 'Gelpis' })).status).toBe(204);
  });

  it('maps refusals: forbidden 403, not_member 404, a cancelled-or-unknown invite 404, others 409', async () => {
    const refuse = (key: string) => vi.fn().mockRejectedValue(new HouseholdRefusal(key as never));
    expect(
      (
        await send(app({ createInvite: refuse('forbidden') }).hono, 'POST', '/api/invites', {
          role: 'member',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await send(
          app({ removeMember: refuse('not_member') }).hono,
          'DELETE',
          `/api/members/${USER}`,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await send(
          app({ cancelInvite: refuse('invite_unknown') }).hono,
          'DELETE',
          `/api/invites/${USER}`,
        )
      ).status,
    ).toBe(404);
    const used = await send(
      app({ acceptInvite: refuse('invite_used') }).hono,
      'POST',
      '/api/invites/accept',
      { token: CODE },
    );
    expect([used.status, await used.json()]).toEqual([409, { error: 'invite_used' }]);
    expect(
      (
        await send(app({ setRole: refuse('last_admin') }).hono, 'PATCH', `/api/members/${USER}`, {
          role: 'member',
        })
      ).status,
    ).toBe(409);
  });

  it('answers 404 for an id that is not a UUID', async () => {
    const { hono, household } = app();
    expect((await send(hono, 'DELETE', '/api/members/nope')).status).toBe(404);
    expect(household.removeMember).not.toHaveBeenCalled();
  });
});
