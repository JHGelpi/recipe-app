import { Hono } from 'hono';
import { UnauthorizedError, type VerifyToken } from './auth/verify';
import type { AsUser } from './db/asUser';
import type { ImportService } from './import/service';
import { applyOps, parseBody } from './upload/ops';

export type AppDeps = {
  verify: VerifyToken;
  asUser: AsUser;
  ping: () => Promise<void>;
  imports: ImportService;
};

const MAX_BODY_BYTES = 1024 * 1024;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function bearer(header: string | undefined): string | null {
  return /^Bearer (.+)$/.exec(header ?? '')?.[1] ?? null;
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  app.onError((error, c) => {
    if (error instanceof UnauthorizedError) return c.json({ error: 'unauthorized' }, 401);
    // Everything else is ours to fix. The client keeps its changes queued and retries.
    console.error(
      JSON.stringify({ event: 'request_failed', path: c.req.path, message: String(error) }),
    );
    return c.json({ error: 'internal' }, 500);
  });

  app.get('/api/health', async (c) => {
    await deps.ping();
    return c.json({ ok: true });
  });

  app.post('/api/upload', async (c) => {
    const token = bearer(c.req.header('Authorization'));
    if (!token) return c.json({ error: 'unauthorized' }, 401);
    // Checked before the body is read, so a bad token is always a 401.
    await deps.verify(token);

    // The proxy refuses anything far larger before it reaches this process;
    // this is the exact limit.
    const raw = await c.req.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
      return c.json({ error: 'too_large' }, 413);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }
    const ops = parseBody(payload);
    if (!ops) return c.json({ error: 'invalid_body' }, 400);

    // One transaction for the batch: an unexpected failure applies nothing.
    const results = await deps.asUser(token, (tx) => applyOps(tx, ops));
    return c.json({ results });
  });

  // FR-18: deletes the caller's household trash older than 30 days. RLS
  // (recipes_purge) limits it to that household, to admins and members, and
  // to expired trash.
  app.post('/api/trash/purge', async (c) => {
    const token = bearer(c.req.header('Authorization'));
    if (!token) return c.json({ error: 'unauthorized' }, 401);
    await deps.verify(token);
    const purged = await deps.asUser(token, async (tx) => {
      const rows = await tx`
        delete from public.recipes where deleted_at < now() - interval '30 days' returning id`;
      return rows.length;
    });
    return c.json({ purged });
  });

  // FR-29, ADR-0012: claims the import as the user and answers at once; the
  // parse continues even if the phone goes away. A crash leaves the row
  // "parsing", which the next call reclaims after 5 minutes.
  app.post('/api/imports/:id/parse', async (c) => {
    const token = bearer(c.req.header('Authorization'));
    if (!token) return c.json({ error: 'unauthorized' }, 401);
    const id = c.req.param('id');
    if (!GUID.test(id)) return c.json({ error: 'not_found' }, 404);
    const { outcome, claims } = await deps.imports.claim(token, id);
    if (outcome.kind === 'missing') return c.json({ error: 'not_found' }, 404);
    if (outcome.kind === 'forbidden') return c.json({ error: 'forbidden' }, 403);
    if (outcome.kind === 'busy') return c.json({ status: outcome.status }, 409);
    void deps.imports.process(claims, outcome.row).catch((error: unknown) => {
      console.error(JSON.stringify({ event: 'import_write_failed', id, message: String(error) }));
    });
    return c.json({ status: 'parsing' }, 202);
  });

  // NFR-7: this month's AI spend for the caller's household, and the cap.
  app.get('/api/imports/usage', async (c) => {
    const token = bearer(c.req.header('Authorization'));
    if (!token) return c.json({ error: 'unauthorized' }, 401);
    return c.json(await deps.imports.usage(token));
  });

  return app;
}
