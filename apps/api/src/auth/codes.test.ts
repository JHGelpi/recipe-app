import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { registerCodeRoutes } from './codes';
import { createLockout } from './lockout';

function setup(status: number, body: unknown = {}) {
  const fetch = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json', 'X-Supabase-Api-Version': '2024-01-01' },
      }),
  );
  const lockout = createLockout({ limit: 2, windowMs: 60_000 });
  const app = new Hono();
  registerCodeRoutes(app, { authUrl: 'http://auth:9999', fetch, lockout });
  const send = (path: string, payload: unknown, headers: Record<string, string> = {}) =>
    app.request(`/api/auth${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(payload),
    });
  return { fetch, lockout, send };
}

const code = { type: 'email', email: ' Ann@Example.test ', token: '12345678' };

describe('the email code relay (#72)', () => {
  it('passes a request to GoTrue unchanged, with the visitor address, and returns its answer', async () => {
    const { fetch, send } = setup(200, { access_token: 't' });
    const response = await send(
      '/otp?redirect_to=x',
      { email: 'a@example.test' },
      {
        'X-Client-IP': '203.0.113.9',
        'X-Supabase-Api-Version': '2024-01-01',
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ access_token: 't' });
    expect(response.headers.get('x-supabase-api-version')).toBe('2024-01-01');
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://auth:9999/otp?redirect_to=x');
    const headers = init.headers as Headers;
    expect(headers.get('x-client-ip')).toBe('203.0.113.9');
    expect(headers.get('x-supabase-api-version')).toBe('2024-01-01');
  });

  it('refuses an email after too many wrong codes, whatever the code, without asking GoTrue', async () => {
    const { fetch, send } = setup(403, { error_code: 'otp_expired' });
    expect((await send('/verify', code)).status).toBe(403);
    expect((await send('/verify', { ...code, email: 'ann@example.test' })).status).toBe(403);
    const locked = await send('/verify', code);
    expect(locked.status).toBe(429);
    expect(await locked.json()).toMatchObject({ error_code: 'too_many_wrong_codes' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('a new code clears the count', async () => {
    const { lockout, send } = setup(200);
    lockout.fail('ann@example.test');
    lockout.fail('ann@example.test');
    expect((await send('/otp', { email: 'ANN@example.test' })).status).toBe(200);
    expect(lockout.locked('ann@example.test')).toBe(false);
  });

  it("does not count GoTrue's own rate limit as a wrong code", async () => {
    const { lockout, send } = setup(429, { error_code: 'over_request_rate_limit' });
    for (let i = 0; i < 3; i++) expect((await send('/verify', code)).status).toBe(429);
    expect(lockout.locked('ann@example.test')).toBe(false);
  });

  it('answers 400 without an email, and never calls GoTrue', async () => {
    const { fetch, send } = setup(200);
    expect((await send('/verify', { token: '1' })).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
});
