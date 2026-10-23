import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { UnauthorizedError } from '../auth/verify';
import { registerFeedbackRoutes } from './routes';
import type { FeedbackOutcome } from './service';

const body = {
  report: { kind: 'idea', summary: 'Meal plan', want: 'A week view', why: 'I plan on Sundays' },
  details: {
    build: 'dev',
    storage: 'persistent',
    userAgent: 'Mozilla/5.0',
    display: 'Browser tab',
    screen: '1280 × 800',
    appearance: 'Light',
    units: 'US',
    online: true,
    sentAt: '2026-10-23 14:05 (UTC)',
  },
};

function app(outcome: FeedbackOutcome, verify = vi.fn().mockResolvedValue({ sub: 'user-1' })) {
  const send = vi.fn().mockResolvedValue(outcome);
  const hono = new Hono();
  hono.onError((error, c) =>
    error instanceof UnauthorizedError ? c.json({ error: 'unauthorized' }, 401) : c.json({}, 500),
  );
  registerFeedbackRoutes(hono, { verify, feedback: { send } });
  const post = (payload: unknown, token: string | null = 'jwt') =>
    hono.request('/api/feedback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    });
  return { post, send };
}

describe('POST /api/feedback (FR-45)', () => {
  it('needs a session: none, or a bad one, is a 401 and nothing is sent', async () => {
    const none = app({ kind: 'limit' });
    expect((await none.post(body, null)).status).toBe(401);
    const bad = app({ kind: 'limit' }, vi.fn().mockRejectedValue(new UnauthorizedError('expired')));
    expect((await bad.post({ nonsense: true })).status).toBe(401);
    expect(none.send).not.toHaveBeenCalled();
    expect(bad.send).not.toHaveBeenCalled();
  });

  it('refuses a body that is not a report, or carries extra fields', async () => {
    const { post, send } = app({ kind: 'limit' });
    expect((await post({ report: body.report })).status).toBe(400);
    expect((await post({ ...body, details: { ...body.details, email: 'a@b.c' } })).status).toBe(
      400,
    );
    expect(send).not.toHaveBeenCalled();
  });

  it('answers 201 with the issue, 429 at the limit, 502 when GitHub fails, 503 unset', async () => {
    const created = await app({ kind: 'filed', number: 9, url: 'https://github.com/x/y/9' }).post(
      body,
    );
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ number: 9, url: 'https://github.com/x/y/9' });
    expect((await app({ kind: 'limit' }).post(body)).status).toBe(429);
    expect((await app({ kind: 'unavailable' }).post(body)).status).toBe(502);
    expect((await app({ kind: 'not_configured' }).post(body)).status).toBe(503);
  });
});
