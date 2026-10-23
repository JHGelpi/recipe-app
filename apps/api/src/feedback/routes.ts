import { feedbackRequestSchema } from '@recipe-app/domain';
import type { Hono } from 'hono';
import type { VerifyToken } from '../auth/verify';
import { bearer } from '../bearer';
import type { FeedbackService } from './service';

const STATUS = { limit: 429, unavailable: 502, not_configured: 503 } as const;

/** FR-45: an idea or problem report, filed on GitHub for a signed-in person. */
export function registerFeedbackRoutes(
  app: Hono,
  deps: { verify: VerifyToken; feedback: FeedbackService },
): void {
  app.post('/api/feedback', async (c) => {
    const token = bearer(c.req.header('Authorization'));
    if (!token) return c.json({ error: 'unauthorized' }, 401);
    // Checked before the body is read, so a bad session is always a 401.
    await deps.verify(token);
    const parsed = feedbackRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid_body' }, 400);
    const outcome = await deps.feedback.send(token, parsed.data);
    if (outcome.kind === 'filed') return c.json({ number: outcome.number, url: outcome.url }, 201);
    return c.json({ error: outcome.kind }, STATUS[outcome.kind]);
  });
}
