import { FEEDBACK_DAILY_LIMIT, type FeedbackRequest } from '@recipe-app/domain';
import type { ApiDeps } from '../imports/api';

export type FeedbackResult =
  | { ok: true; number: number; url: string }
  | { ok: false; reason: 'limit' | 'unavailable' | 'not_configured' | 'reauth' | 'invalid' };

/** What the person reads for each failure; the draft stays either way. */
export const FEEDBACK_MESSAGES: Record<Exclude<FeedbackResult, { ok: true }>['reason'], string> = {
  limit: `You've sent ${FEEDBACK_DAILY_LIMIT} today. Try again tomorrow.`,
  unavailable: "Couldn't send it just now. Your report is still here, so try again.",
  not_configured: "Feedback isn't set up on this server yet.",
  reauth: 'Sign in again to send feedback.',
  invalid: 'Something in the form could not be sent. Check it and try again.',
};

const REASONS: Record<number, Exclude<FeedbackResult, { ok: true }>['reason']> = {
  400: 'invalid',
  401: 'reauth',
  429: 'limit',
  503: 'not_configured',
};

/** FR-45: files the report through the API, which holds the GitHub token. Never throws. */
export async function sendFeedback(
  request: FeedbackRequest,
  deps: ApiDeps,
): Promise<FeedbackResult> {
  try {
    const response = await deps.fetch(`${deps.apiUrl}/feedback`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${deps.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (response.status === 201) {
      const body = (await response.json()) as { number?: unknown; url?: unknown };
      if (typeof body.number === 'number' && typeof body.url === 'string') {
        return { ok: true, number: body.number, url: body.url };
      }
      return { ok: false, reason: 'unavailable' };
    }
    return { ok: false, reason: REASONS[response.status] ?? 'unavailable' };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}
