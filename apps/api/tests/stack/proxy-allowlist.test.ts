import { describe, expect, it } from 'vitest';
import { env } from '../../../../test-support/env';

// Issue #68: the proxy forwards only the GoTrue and PowerSync routes the app
// uses. Everything else answers 404 from the proxy, before reaching either.
const send = async (method: string, path: string, body?: unknown) => {
  const response = await fetch(`${env.publicUrl}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  await response.body?.cancel();
  return response.status;
};

describe('the proxy allow-list (#68)', () => {
  it.each([
    ['GET', '/auth/admin/users'],
    ['POST', '/auth/signup', { email: 'nobody@example.test', password: 'password-123456' }],
    ['POST', '/auth/token?grant_type=password', { email: 'a@example.test', password: 'x' }],
    ['POST', '/auth/token?grant_type=refresh_token&grant_type=password', {}],
    ['PUT', '/auth/user', { password: 'password-123456' }],
    ['POST', '/auth/recover', { email: 'a@example.test' }],
    ['POST', '/auth/invite', { email: 'a@example.test' }],
    ['GET', '/auth/settings'],
    ['GET', '/auth/verify?token=x&type=signup'],
    ['GET', '/sync/api/admin/v1/diagnostics'],
    ['POST', '/sync/api/admin/v1/validate', {}],
    ['GET', '/sync/probes/liveness'],
  ])('%s %s is refused at the proxy', async (method, path, body?) => {
    expect(await send(method, path, body)).toBe(404);
  });

  it.each([
    ['GET', '/auth/health', 200],
    ['GET', '/auth/.well-known/jwks.json', 200],
    // Reached GoTrue or PowerSync, which refuse a request with no session.
    ['GET', '/auth/user', 401],
    ['POST', '/auth/logout', 401],
    ['POST', '/auth/token?grant_type=refresh_token', 400],
    ['POST', '/sync/sync/stream', 401],
    ['GET', '/sync/write-checkpoint2.json?client_id=x', 401],
  ])('%s %s reaches the service', async (method, path, status) => {
    expect(await send(method, path, method === 'POST' ? {} : undefined)).toBe(status);
  });
});
