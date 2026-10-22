import { describe, expect, it, vi } from 'vitest';
import { acceptInvite, createInvite, previewInvite, setMemberRole } from './api';

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

describe('household api', () => {
  it('creates an invite with the token', async () => {
    const d = deps(json(201, { id: 'i1', code: CODE, expires_at: '2026-10-24T00:00:00.000Z' }));
    expect(await createInvite('member', d)).toEqual({
      ok: true,
      value: { id: 'i1', code: CODE, expires_at: '2026-10-24T00:00:00.000Z' },
    });
    expect(d.fetch).toHaveBeenCalledWith('https://app.test/api/invites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt' },
      body: JSON.stringify({ role: 'member' }),
    });
  });

  it.each([
    ['last_admin', 'Make someone else an Admin first'],
    ['invite_used', 'This invitation has already been used. Ask the sender for a new one.'],
    ['only_admin', 'Make someone else an Admin of your household first'],
    ['forbidden', 'Only an Admin can do that'],
  ])('turns the %s refusal into its message', async (key, message) => {
    expect(await setMemberRole('u1', 'viewer', deps(json(409, { error: key })))).toEqual({
      ok: false,
      message,
    });
  });

  it('never throws: a network failure is a message', async () => {
    expect(await acceptInvite(CODE, deps(new Error('offline')))).toEqual({
      ok: false,
      message: 'Changing the household needs a connection',
    });
    expect(
      (
        await previewInvite(
          CODE,
          deps(
            json(200, {
              status: 'ok',
              household_name: 'H',
              role: 'member',
              moving_recipes: 0,
              blocker: null,
            }),
          ),
        )
      ).ok,
    ).toBe(true);
  });
});
