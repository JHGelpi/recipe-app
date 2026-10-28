import type { Context, Hono } from 'hono';
import type { Lockout } from './lockout';

export type CodeRelayDeps = {
  /** GoTrue on the Docker network, e.g. http://auth:9999. */
  authUrl: string;
  fetch: typeof fetch;
  lockout: Lockout;
};

// Sent on to GoTrue. X-Client-IP is the proxy's, so GoTrue's per-address
// limits still see the visitor.
const FORWARD = ['content-type', 'x-client-info', 'x-supabase-api-version', 'x-client-ip'];
const RETURN = ['content-type', 'x-supabase-api-version'];
const MAX_BODY = 10_000;

/**
 * Issue #72: email codes are requested and checked through the API, which
 * counts wrong codes per email and passes everything else to GoTrue
 * unchanged. The proxy no longer routes /auth/otp or /auth/verify to GoTrue,
 * so the count cannot be skipped. After LIMIT wrong codes in the window the
 * email is refused until a new code is requested: each new code replaces the
 * old, so a few guesses per code stay hopeless, and nobody can keep someone
 * else locked out.
 */
export function registerCodeRoutes(app: Hono, deps: CodeRelayDeps): void {
  async function relay(c: Context, path: '/otp' | '/verify') {
    const raw = await c.req.text();
    if (raw.length > MAX_BODY) return c.json({ code: 413, msg: 'Request too large' }, 413);
    let body: Record<string, unknown> | null = null;
    try {
      body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      // Answered below like any request without an email.
    }
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!email) {
      return c.json(
        { code: 400, error_code: 'validation_failed', msg: 'An email is required' },
        400,
      );
    }
    if (path === '/verify' && deps.lockout.locked(email)) {
      return c.json(
        {
          code: 429,
          error_code: 'too_many_wrong_codes',
          msg: 'Too many wrong codes. Request a new code.',
        },
        429,
      );
    }

    const url = new URL(c.req.url);
    const headers = new Headers();
    for (const name of FORWARD) {
      const value = c.req.header(name);
      if (value) headers.set(name, value);
    }
    const response = await deps.fetch(`${deps.authUrl}${path}${url.search}`, {
      method: 'POST',
      headers,
      body: raw,
    });
    const text = await response.text();
    if (path === '/otp' && response.ok) deps.lockout.clear(email);
    if (path === '/verify') {
      if (response.ok) deps.lockout.clear(email);
      // GoTrue's own per-address limit is not a wrong code.
      else if (response.status !== 429) deps.lockout.fail(email);
    }
    const back = new Headers();
    for (const name of RETURN) {
      const value = response.headers.get(name);
      if (value) back.set(name, value);
    }
    return new Response(text, { status: response.status, headers: back });
  }

  app.post('/api/auth/otp', (c) => relay(c, '/otp'));
  app.post('/api/auth/verify', (c) => relay(c, '/verify'));
}
