import type { Context, Hono } from 'hono';
import { bearer } from '../bearer';
import { isGuid } from '../ids';
import { ShareRefusal, type SharingService } from './service';

const CODE = /^[A-Za-z0-9_-]{43}$/;
const STATUS = {
  forbidden: 403,
  share_unavailable: 404,
  not_found: 404,
  own_household: 409,
} as const;

/** FR-26, FR-27 (spec §5). Reads need no token; everything else does. */
export function registerSharingRoutes(app: Hono, deps: { sharing: SharingService }): void {
  const { sharing } = deps;

  async function signedIn(c: Context, action: (token: string) => Promise<Response>) {
    const token = bearer(c.req.header('Authorization'));
    if (!token) return c.json({ error: 'unauthorized' }, 401);
    try {
      return await action(token);
    } catch (error) {
      if (!(error instanceof ShareRefusal)) throw error;
      return c.json({ error: error.key }, STATUS[error.key]);
    }
  }

  async function recipeId(c: Context): Promise<string | null> {
    const body = (await c.req.json().catch(() => null)) as { recipe_id?: unknown } | null;
    return typeof body?.recipe_id === 'string' && isGuid(body.recipe_id) ? body.recipe_id : null;
  }

  app.post('/api/shares', (c) =>
    signedIn(c, async (token) => {
      const id = await recipeId(c);
      if (!id) return c.json({ error: 'invalid_body' }, 400);
      return c.json(await sharing.create(token, id), 201);
    }),
  );

  app.post('/api/shares/stop', (c) =>
    signedIn(c, async (token) => {
      const id = await recipeId(c);
      if (!id) return c.json({ error: 'invalid_body' }, 400);
      return c.json({ stopped: await sharing.stop(token, id) });
    }),
  );

  app.get('/api/shares/:code', async (c) => {
    c.header('Cache-Control', 'no-store');
    if (!CODE.test(c.req.param('code'))) return c.json({ status: 'unknown' }, 404);
    const { status, snapshot } = await sharing.read(c.req.param('code'));
    if (status !== 'ok' || !snapshot) return c.json({ status }, 404);
    return c.json({ snapshot, has_photo: snapshot.photo !== null });
  });

  app.get('/api/shares/:code/photo', async (c) => {
    c.header('Cache-Control', 'no-store');
    if (!CODE.test(c.req.param('code'))) return c.json({ error: 'not_found' }, 404);
    const bytes = await sharing.photo(c.req.param('code'));
    if (!bytes) return c.json({ error: 'not_found' }, 404);
    return c.body(bytes as Uint8Array<ArrayBuffer>, 200, { 'Content-Type': 'image/jpeg' });
  });

  app.post('/api/shares/:code/save', (c) =>
    signedIn(c, async (token) => {
      if (!CODE.test(c.req.param('code'))) return c.json({ error: 'share_unavailable' }, 404);
      return c.json(await sharing.save(token, c.req.param('code')), 201);
    }),
  );
}
