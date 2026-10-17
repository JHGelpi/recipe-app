import { PHOTO_LIMITS, substitutionAskSchema } from '@recipe-app/domain';
import { Hono } from 'hono';
import { UnauthorizedError, type VerifyToken } from './auth/verify';
import type { AsUser } from './db/asUser';
import { isGuid } from './ids';
import type { ImportService } from './import/service';
import type { PhotoService } from './photos/service';
import type { SubstitutionService } from './substitutions/service';
import { applyOps, parseBody } from './upload/ops';

export type AppDeps = {
  verify: VerifyToken;
  asUser: AsUser;
  ping: () => Promise<void>;
  imports: ImportService;
  photos: PhotoService;
  substitutions: SubstitutionService;
};

const MAX_BODY_BYTES = 1024 * 1024;

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

  // FR-18: deletes the caller's household trash older than 30 days, photos
  // first (photos_purge: dismissed or replaced over 30 days ago, or of an
  // expired recipe), then their files once the rows are gone.
  app.post('/api/trash/purge', async (c) => {
    const token = bearer(c.req.header('Authorization'));
    if (!token) return c.json({ error: 'unauthorized' }, 401);
    await deps.verify(token);
    const { purged, photos } = await deps.asUser(token, async (tx) => {
      const photos = await tx<{ id: string; household_id: string }[]>`
        delete from public.photos
        where (deleted_at is not null and deleted_at < now() - interval '30 days')
           or recipe_id in (
             select id from public.recipes where deleted_at < now() - interval '30 days')
        returning id, household_id`;
      const rows = await tx`
        delete from public.recipes where deleted_at < now() - interval '30 days' returning id`;
      return { purged: rows.length, photos };
    });
    for (const photo of photos) {
      // A file left behind can no longer be served: its row is gone.
      await deps.photos.remove(photo.household_id, photo.id).catch((error: unknown) => {
        console.error(
          JSON.stringify({ event: 'photo_remove_failed', id: photo.id, message: String(error) }),
        );
      });
    }
    return c.json({ purged });
  });

  // FR-29, ADR-0012: claims the import as the user and answers at once; the
  // parse continues even if the phone goes away. A crash leaves the row
  // "parsing", which the next call reclaims after 5 minutes.
  app.post('/api/imports/:id/parse', async (c) => {
    const token = bearer(c.req.header('Authorization'));
    if (!token) return c.json({ error: 'unauthorized' }, 401);
    const id = c.req.param('id');
    if (!isGuid(id)) return c.json({ error: 'not_found' }, 404);
    const { outcome, claims } = await deps.imports.claim(token, id);
    if (outcome.kind === 'missing') return c.json({ error: 'not_found' }, 404);
    if (outcome.kind === 'forbidden') return c.json({ error: 'forbidden' }, 403);
    if (outcome.kind === 'photos_pending') return c.json({ error: 'photos_pending' }, 409);
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

  const PUT_STATUS = {
    missing: 404,
    gone: 410,
    forbidden: 403,
    not_jpeg: 415,
    wrong_size: 422,
  } as const;

  // FR-7, FR-15: a photo's file. The row must already be visible to the user.
  app.put('/api/photos/:id', async (c) => {
    const token = bearer(c.req.header('Authorization'));
    if (!token) return c.json({ error: 'unauthorized' }, 401);
    const claims = await deps.verify(token);
    const id = c.req.param('id');
    if (!isGuid(id)) return c.json({ error: 'not_found' }, 404);
    if (Number(c.req.header('Content-Length') ?? 0) > PHOTO_LIMITS.bytes) {
      return c.json({ error: 'too_large' }, 413);
    }
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.byteLength > PHOTO_LIMITS.bytes) return c.json({ error: 'too_large' }, 413);
    const outcome = await deps.photos.put(claims, id, bytes);
    if (outcome === 'stored') return c.body(null, 204);
    return c.json({ error: outcome }, PUT_STATUS[outcome]);
  });

  // NFR-2: served only to the photo's household. No browser cache keeps it:
  // the app holds its own offline copies, cleared on sign-out, and a cached
  // copy would outlive sign-out and be served without the RLS check.
  app.get('/api/photos/:id', async (c) => {
    const token = bearer(c.req.header('Authorization'));
    if (!token) return c.json({ error: 'unauthorized' }, 401);
    const id = c.req.param('id');
    if (!isGuid(id)) return c.json({ error: 'not_found' }, 404);
    const bytes = await deps.photos.get(token, id);
    if (!bytes) return c.json({ error: 'not_found' }, 404);
    return c.body(bytes as Uint8Array<ArrayBuffer>, 200, {
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'private, no-store',
    });
  });

  const ASK_STATUS = {
    forbidden: 403,
    missing: 404,
    quota: 402,
    ai_unavailable: 503,
    invalid_output: 422,
  } as const;
  const ASK_ERROR = {
    forbidden: 'forbidden',
    missing: 'not_found',
    quota: 'quota',
    ai_unavailable: 'ai_unavailable',
    invalid_output: 'invalid_output',
  } as const;

  // FR-24: substitutes for one ingredient, asked live and remembered.
  app.post('/api/substitutions', async (c) => {
    const token = bearer(c.req.header('Authorization'));
    if (!token) return c.json({ error: 'unauthorized' }, 401);
    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_body' }, 400);
    }
    const parsed = substitutionAskSchema.safeParse(payload);
    if (!parsed.success) return c.json({ error: 'invalid_body' }, 400);
    const outcome = await deps.substitutions.ask(token, parsed.data);
    if (outcome.kind === 'answer') {
      return c.json({ ...outcome.answer, ingredient_raw: outcome.ingredient_raw }, 200);
    }
    return c.json({ error: ASK_ERROR[outcome.kind] }, ASK_STATUS[outcome.kind]);
  });

  return app;
}
