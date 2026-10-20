import type { Context, Hono } from 'hono';
import type { PassKind, SignupService } from './service';

const KINDS: readonly string[] = ['invite', 'share', 'friend'];
const CODE = /^[A-Za-z0-9_-]{43}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Production spec §4. Signed out; answers only "pass" or "link_expired". */
export function registerSignupRoutes(
  app: Hono,
  deps: {
    signup: SignupService;
    limitEmail: (key: string) => boolean;
    limitCode: (key: string) => boolean;
    limitIp: (key: string) => boolean;
    limitAll: (key: string) => boolean;
  },
): void {
  const ip = (c: Context) => c.req.header('X-Client-IP') ?? 'unknown';

  app.post('/api/signup-pass', async (c) => {
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    const kind = body?.kind;
    const code = body?.code;
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (
      typeof kind !== 'string' ||
      !KINDS.includes(kind) ||
      typeof code !== 'string' ||
      !CODE.test(code) ||
      email.length > 254 ||
      !EMAIL.test(email)
    ) {
      return c.json({ error: 'invalid_body' }, 400);
    }
    // Per address, per email, per link, then everyone: a refused check
    // counts against none after it.
    if (
      !deps.limitIp(ip(c)) ||
      !deps.limitEmail(email) ||
      !deps.limitCode(code) ||
      !deps.limitAll('all')
    )
      return c.json({ error: 'too_many' }, 429);
    const granted = await deps.signup.grant(kind as PassKind, code, email);
    return granted ? c.body(null, 204) : c.json({ error: 'link_expired' }, 404);
  });

  // FR-6: lets /welcome/<code> say a link has ended before anyone types an email.
  app.post('/api/friend-links/status', async (c) => {
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    const code = body?.code;
    if (typeof code !== 'string' || !CODE.test(code)) return c.json({ error: 'invalid_body' }, 400);
    if (!deps.limitIp(ip(c)) || !deps.limitCode(code) || !deps.limitAll('all'))
      return c.json({ error: 'too_many' }, 429);
    return c.json({ status: await deps.signup.friendLinkStatus(code) });
  });
}
