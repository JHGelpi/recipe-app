import { Hono } from 'hono';
import { expect, it, vi } from 'vitest';
import { createRateLimiter } from '../rateLimit';
import { registerSignupRoutes } from './routes';

const CODE = 'k3J9xQ2mZb7LwP0aYc5RdT8vNf1HgE4sUo6IiKjMnBq';

function app(granted = true, limit = 100, status: 'live' | 'ended' | 'unknown' = 'live') {
  const grant = vi.fn(async () => granted);
  const friendLinkStatus = vi.fn(async () => status);
  const hono = new Hono();
  registerSignupRoutes(hono, {
    signup: { grant, friendLinkStatus },
    limitEmail: createRateLimiter({ limit, windowMs: 60_000 }),
    limitCode: createRateLimiter({ limit, windowMs: 60_000 }),
  });
  const post = (body: unknown) =>
    hono.request('/api/signup-pass', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const check = (body: unknown) =>
    hono.request('/api/friend-links/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  return { grant, friendLinkStatus, post, check };
}

it('grants a pass for a valid body, with the email trimmed and lowercased', async () => {
  const { grant, post } = app();
  const response = await post({ kind: 'invite', code: CODE, email: ' Ann@Example.com ' });
  expect(response.status).toBe(204);
  expect(grant).toHaveBeenCalledWith('invite', CODE, 'ann@example.com');
});

it('a dead link is 404 link_expired', async () => {
  const response = await app(false).post({ kind: 'friend', code: CODE, email: 'a@b.co' });
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: 'link_expired' });
});

it.each([
  { kind: 'household', code: CODE, email: 'a@b.co' },
  { kind: 'share', code: 'short', email: 'a@b.co' },
  { kind: 'share', code: CODE, email: 'not-an-email' },
  { kind: 'share', code: CODE, email: `${'a'.repeat(250)}@b.co` },
  null,
])('a bad body is 400 and grants nothing: %j', async (body) => {
  const { grant, post } = app();
  expect((await post(body)).status).toBe(400);
  expect(grant).not.toHaveBeenCalled();
});

it('too many requests for one email are 429 before the database is asked', async () => {
  const { grant, post } = app(true, 1);
  await post({ kind: 'share', code: CODE, email: 'a@b.co' });
  const response = await post({ kind: 'share', code: CODE, email: 'a@b.co' });
  expect(response.status).toBe(429);
  expect(grant).toHaveBeenCalledTimes(1);
});

it('says whether a friend link is live, signed out, and refuses a malformed code', async () => {
  const ended = app(true, 100, 'ended');
  const response = await ended.check({ code: CODE });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: 'ended' });
  expect(ended.friendLinkStatus).toHaveBeenCalledWith(CODE);
  expect((await ended.check({ code: 'short' })).status).toBe(400);
});

it('friend link checks share the per-link limit', async () => {
  const { check } = app(true, 1);
  await check({ code: CODE });
  expect((await check({ code: CODE })).status).toBe(429);
});
