import type { FeedbackRequest } from '@recipe-app/domain';
import { describe, expect, it, vi } from 'vitest';
import { UnauthorizedError } from '../auth/verify';
import type { AsUser } from '../db/asUser';
import { createRateLimiter } from '../rateLimit';
import { createFeedbackService, type GitHubConfig } from './service';

const GITHUB: GitHubConfig = {
  token: 'gh-token',
  repo: 'JHGelpi/recipe-app',
  apiUrl: 'https://api.github.com',
};

const request: FeedbackRequest = {
  report: {
    kind: 'problem',
    summary: 'Photo import hangs',
    happened: 'It spun forever.',
    expected: 'A draft.',
    steps: '1. Import a photo',
    frequency: 'Every time',
    area: 'Import',
  },
  details: {
    build: '2026-10-23 12:24',
    storage: 'persistent',
    userAgent: 'Mozilla/5.0',
    display: 'Browser tab',
    screen: '1280 × 800',
    appearance: 'System',
    units: 'As written',
    online: true,
    sentAt: '2026-10-23 14:05 (UTC)',
    offlineRecently: false,
    waitingUploads: 0,
  },
};

// The user's row as the database answers it, with what the token would not tell.
const asUser = vi.fn(async (_token, fn) =>
  fn(Object.assign(async () => [{ user_id: 'user-1', reporter: 'r-3f9a1c', role: 'viewer' }], {})),
) as unknown as AsUser;

const filed = () =>
  new Response(JSON.stringify({ number: 77, html_url: 'https://github.com/x/y/issues/77' }), {
    status: 201,
  });

function service(fetch: typeof globalThis.fetch, overrides: { github?: GitHubConfig | null } = {}) {
  const log = vi.fn();
  return {
    log,
    feedback: createFeedbackService({
      asUser,
      github: overrides.github === undefined ? GITHUB : overrides.github,
      fetch,
      limit: createRateLimiter({ limit: 5, windowMs: 86_400_000 }),
      log,
    }),
  };
}

describe('the feedback service (FR-45)', () => {
  it('files an issue with the token, the bug label and the anonymous reporter, nothing personal', async () => {
    const fetch = vi.fn().mockResolvedValue(filed());
    const { feedback } = service(fetch);
    expect(await feedback.send('jwt', request)).toEqual({
      kind: 'filed',
      number: 77,
      url: 'https://github.com/x/y/issues/77',
    });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://api.github.com/repos/JHGelpi/recipe-app/issues');
    expect(init.headers.Authorization).toBe('Bearer gh-token');
    const sent = JSON.parse(init.body as string);
    expect(Object.keys(sent).sort()).toEqual(['body', 'labels', 'title']);
    expect(sent.labels).toEqual(['bug']);
    expect(sent.body).toContain('Reporter r-3f9a1c');
    // The role comes from the database, not the token.
    expect(sent.body).toContain('- **Role:** Viewer');
    for (const personal of ['user-1', 'jwt', '@example', 'household']) {
      expect(sent.body).not.toContain(personal);
    }
  });

  it('an idea gets the feature label', async () => {
    const fetch = vi.fn().mockResolvedValue(filed());
    const { feedback } = service(fetch);
    await feedback.send('jwt', {
      ...request,
      report: { kind: 'idea', summary: 'Meal plan', want: 'A plan', why: 'Sundays' },
    });
    expect(JSON.parse(fetch.mock.calls[0]![1].body as string).labels).toEqual(['feature']);
  });

  it('without a valid session nothing is filed', async () => {
    const fetch = vi.fn();
    const refusing = vi.fn().mockRejectedValue(new UnauthorizedError('expired'));
    const feedback = createFeedbackService({
      asUser: refusing as unknown as AsUser,
      github: GITHUB,
      fetch,
      limit: createRateLimiter({ limit: 5, windowMs: 1 }),
      log: vi.fn(),
    });
    await expect(feedback.send('bad', request)).rejects.toBeInstanceOf(UnauthorizedError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('allows five a day; the sixth is refused without calling GitHub', async () => {
    const fetch = vi.fn().mockImplementation(async () => filed());
    const { feedback } = service(fetch);
    for (let i = 0; i < 5; i++) expect((await feedback.send('jwt', request)).kind).toBe('filed');
    expect(await feedback.send('jwt', request)).toEqual({ kind: 'limit' });
    expect(fetch).toHaveBeenCalledTimes(5);
  });

  it('a GitHub failure or timeout does not count toward the limit', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 502 }))
      .mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError'))
      .mockImplementation(async () => filed());
    const { feedback, log } = service(fetch);
    expect(await feedback.send('jwt', request)).toEqual({ kind: 'unavailable' });
    expect(await feedback.send('jwt', request)).toEqual({ kind: 'unavailable' });
    for (let i = 0; i < 5; i++) expect((await feedback.send('jwt', request)).kind).toBe('filed');
    expect(await feedback.send('jwt', request)).toEqual({ kind: 'limit' });
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'feedback_failed', reason: 'status_502' }),
    );
  });

  it('without a token configured it says so and touches nothing', async () => {
    const fetch = vi.fn();
    const { feedback } = service(fetch, { github: null });
    expect(await feedback.send('jwt', request)).toEqual({ kind: 'not_configured' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
