import { feedbackDetailsSchema } from '@recipe-app/domain';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FEEDBACK_MESSAGES, sendFeedback } from './api';
import { feedbackDetails, sentAt, type DeviceFacts } from './details';
import { offlineWithin, resetOfflineTracking, startOfflineTracking } from './offline';

const facts: DeviceFacts = {
  buildTime: '2026-10-23 12:24',
  storage: 'persistent',
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
  standalone: true,
  screen: { width: 390, height: 844 },
  appearance: 'dark',
  units: 'metric',
  online: false,
  now: new Date('2026-10-23T18:05:00Z'),
  timeZone: 'America/New_York',
};

describe('feedbackDetails (FR-45)', () => {
  it('describes the device only, in the shape the API accepts', () => {
    const details = feedbackDetails(facts, null);
    expect(details).toMatchObject({
      display: 'Installed app',
      screen: '390 × 844',
      appearance: 'Dark',
      units: 'Metric',
      online: false,
    });
    expect(details).not.toHaveProperty('offlineRecently');
    expect(feedbackDetailsSchema.safeParse(details).success).toBe(true);
  });

  it('a problem report adds recent offline time and waiting uploads', () => {
    const details = feedbackDetails(
      { ...facts, standalone: false },
      { offlineRecently: true, waitingUploads: 3 },
    );
    expect(details).toMatchObject({
      display: 'Browser tab',
      offlineRecently: true,
      waitingUploads: 3,
    });
    expect(feedbackDetailsSchema.safeParse(details).success).toBe(true);
  });

  it('the time names the zone and its offset', () => {
    expect(sentAt(facts.now, 'America/New_York')).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2} \(America\/New_York, UTC[+−]\d{2}:\d{2}\)$/,
    );
    expect(sentAt(facts.now, undefined)).toMatch(/\(UTC[+−]\d{2}:\d{2}\)$/);
  });
});

describe('offlineWithin (FR-45)', () => {
  afterEach(() => {
    resetOfflineTracking();
    vi.unstubAllGlobals();
  });

  it('is true while offline, and for ten minutes after the connection comes back', () => {
    const listeners: Record<string, () => void> = {};
    vi.stubGlobal('navigator', { onLine: true });
    vi.stubGlobal('window', {
      addEventListener: (name: string, fn: () => void) => (listeners[name] = fn),
    });
    let now = 0;
    startOfflineTracking(() => now);
    expect(offlineWithin(600_000, now, true)).toBe(false);
    expect(offlineWithin(600_000, now, false)).toBe(true);
    now = 1_000;
    listeners.offline!();
    now = 5_000;
    listeners.online!();
    expect(offlineWithin(600_000, 5_000 + 600_000, true)).toBe(true);
    expect(offlineWithin(600_000, 5_001 + 600_000, true)).toBe(false);
  });
});

describe('sendFeedback (FR-45)', () => {
  const request = {
    report: { kind: 'idea' as const, summary: 'Plan', want: 'A plan', why: 'Sundays' },
    details: feedbackDetails(facts, null),
  };
  const deps = (response: Response | Error) => ({
    fetch: vi.fn(async () => {
      if (response instanceof Error) throw response;
      return response;
    }),
    apiUrl: '/api',
    token: 'jwt',
  });

  it('posts to the API with the session and returns the issue', async () => {
    const d = deps(
      new Response(JSON.stringify({ number: 3, url: 'https://github.com/x/y/issues/3' }), {
        status: 201,
      }),
    );
    expect(await sendFeedback(request, d)).toEqual({
      ok: true,
      number: 3,
      url: 'https://github.com/x/y/issues/3',
    });
    const [url, init] = d.fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/feedback');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt');
  });

  it('names each failure, and never throws', async () => {
    expect(await sendFeedback(request, deps(new Response('{}', { status: 429 })))).toEqual({
      ok: false,
      reason: 'limit',
    });
    expect(FEEDBACK_MESSAGES.limit).toBe("You've sent 5 today. Try again tomorrow.");
    for (const [status, reason] of [
      [401, 'reauth'],
      [502, 'unavailable'],
      [503, 'not_configured'],
      [500, 'unavailable'],
    ] as const) {
      expect(await sendFeedback(request, deps(new Response('{}', { status })))).toEqual({
        ok: false,
        reason,
      });
    }
    expect(await sendFeedback(request, deps(new TypeError('offline')))).toEqual({
      ok: false,
      reason: 'unavailable',
    });
  });
});
