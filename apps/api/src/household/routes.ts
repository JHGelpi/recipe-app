import {
  householdRenameSchema,
  inviteCreateSchema,
  inviteTokenBodySchema,
  memberRoleBodySchema,
  type HouseholdError,
} from '@recipe-app/domain';
import type { Context, Hono } from 'hono';
import { bearer } from '../bearer';
import { isGuid } from '../ids';
import { HouseholdRefusal, type HouseholdService } from './service';

const STATUS: Partial<Record<HouseholdError, 403 | 404>> = { forbidden: 403, not_member: 404 };

/** FR-3–FR-6 (spec §5). */
export function registerHouseholdRoutes(app: Hono, deps: { household: HouseholdService }): void {
  const { household } = deps;

  // Any schema with safeParse: the domain package's zod schemas.
  type Parser<T> = { safeParse(value: unknown): { success: true; data: T } | { success: false } };
  async function body<T>(c: Context, schema: Parser<T>): Promise<T | null> {
    const parsed = schema.safeParse(await c.req.json().catch(() => null));
    return parsed.success ? parsed.data : null;
  }

  // Runs an action; a refusal becomes its status and key.
  async function handle(
    c: Context,
    action: (token: string) => Promise<Response>,
    notFound: HouseholdError[] = [],
  ) {
    const token = bearer(c.req.header('Authorization'));
    if (!token) return c.json({ error: 'unauthorized' }, 401);
    try {
      return await action(token);
    } catch (error) {
      if (!(error instanceof HouseholdRefusal)) throw error;
      const status = notFound.includes(error.key) ? 404 : (STATUS[error.key] ?? 409);
      return c.json({ error: error.key }, status);
    }
  }

  app.post('/api/invites', (c) =>
    handle(c, async (token) => {
      const parsed = await body(c, inviteCreateSchema);
      if (!parsed) return c.json({ error: 'invalid_body' }, 400);
      return c.json(await household.createInvite(token, parsed.role), 201);
    }),
  );
  // FR-6: a link for a friend to start their own household (production spec §4).
  app.post('/api/friend-links', (c) =>
    handle(c, async (token) => c.json(await household.createFriendLink(token), 201)),
  );
  app.get('/api/friend-links', (c) =>
    handle(c, async (token) => c.json(await household.listFriendLinks(token))),
  );
  app.delete('/api/friend-links/:id', (c) =>
    handle(
      c,
      async (token) => {
        if (!isGuid(c.req.param('id'))) return c.json({ error: 'not_found' }, 404);
        await household.revokeFriendLink(token, c.req.param('id'));
        return c.body(null, 204);
      },
      ['link_unknown'],
    ),
  );
  app.get('/api/invites', (c) =>
    handle(c, async (token) => c.json(await household.listInvites(token))),
  );
  app.delete('/api/invites/:id', (c) =>
    handle(
      c,
      async (token) => {
        if (!isGuid(c.req.param('id'))) return c.json({ error: 'not_found' }, 404);
        await household.cancelInvite(token, c.req.param('id'));
        return c.body(null, 204);
      },
      ['invite_unknown'],
    ),
  );
  app.post('/api/invites/preview', (c) =>
    handle(c, async (token) => {
      const parsed = await body(c, inviteTokenBodySchema);
      if (!parsed) return c.json({ error: 'invalid_body' }, 400);
      return c.json(await household.previewInvite(token, parsed.token));
    }),
  );
  app.post('/api/invites/accept', (c) =>
    handle(c, async (token) => {
      const parsed = await body(c, inviteTokenBodySchema);
      if (!parsed) return c.json({ error: 'invalid_body' }, 400);
      return c.json(await household.acceptInvite(token, parsed.token));
    }),
  );
  app.patch('/api/members/:userId', (c) =>
    handle(c, async (token) => {
      if (!isGuid(c.req.param('userId'))) return c.json({ error: 'not_found' }, 404);
      const parsed = await body(c, memberRoleBodySchema);
      if (!parsed) return c.json({ error: 'invalid_body' }, 400);
      await household.setRole(token, c.req.param('userId'), parsed.role);
      return c.body(null, 204);
    }),
  );
  app.delete('/api/members/:userId', (c) =>
    handle(c, async (token) => {
      if (!isGuid(c.req.param('userId'))) return c.json({ error: 'not_found' }, 404);
      await household.removeMember(token, c.req.param('userId'));
      return c.body(null, 204);
    }),
  );
  app.post('/api/household/leave', (c) =>
    handle(c, async (token) => {
      await household.leave(token);
      return c.body(null, 204);
    }),
  );
  app.patch('/api/household', (c) =>
    handle(c, async (token) => {
      const parsed = await body(c, householdRenameSchema);
      if (!parsed) return c.json({ error: 'invalid_body' }, 400);
      await household.rename(token, parsed.name);
      return c.body(null, 204);
    }),
  );
}
