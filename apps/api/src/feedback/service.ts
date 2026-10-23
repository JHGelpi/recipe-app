import { feedbackIssue, type FeedbackRequest, type FeedbackRole } from '@recipe-app/domain';
import type { AsUser } from '../db/asUser';
import type { RateLimiter } from '../rateLimit';

/** A fine-grained token scoped to Issues on one repository (NFR-3); null when not set up. */
export type GitHubConfig = { token: string; repo: string; apiUrl: string };

export type FeedbackOutcome =
  | { kind: 'filed'; number: number; url: string }
  | { kind: 'limit' }
  | { kind: 'unavailable' }
  | { kind: 'not_configured' };

export type FeedbackService = {
  send(token: string, request: FeedbackRequest): Promise<FeedbackOutcome>;
};

const ROLES: readonly FeedbackRole[] = ['admin', 'member', 'viewer'];

/**
 * FR-45: files an idea or problem as a GitHub issue under the person's
 * anonymous reporter id. Only a filed issue counts toward the daily limit.
 */
export function createFeedbackService(deps: {
  asUser: AsUser;
  github: GitHubConfig | null;
  fetch: typeof fetch;
  /** Per person, FEEDBACK_DAILY_LIMIT a day. */
  limit: RateLimiter;
  log: (event: Record<string, unknown>) => void;
  timeoutMs?: number;
}): FeedbackService {
  return {
    async send(token, request) {
      const github = deps.github;
      if (!github) return { kind: 'not_configured' };
      // Verifies the token first: no session, no issue. The role is read live,
      // not from the token, which can be up to an hour old.
      const me = await deps.asUser(token, async (tx) => {
        const [row] = await tx<{ user_id: string; reporter: string; role: string | null }[]>`
          select public.auth_user_id() as user_id, public.feedback_reporter_id() as reporter,
                 public.auth_household_role() as role`;
        return row!;
      });
      if (!deps.limit(me.user_id)) return { kind: 'limit' };
      const role = ROLES.find((name) => name === me.role) ?? 'member';
      const issue = feedbackIssue(request.report, request.details, role, me.reporter);

      const failed = (reason: string): FeedbackOutcome => {
        deps.limit.refund(me.user_id);
        deps.log({ event: 'feedback_failed', reporter: me.reporter, reason });
        return { kind: 'unavailable' };
      };
      let response: Response;
      try {
        response = await deps.fetch(`${github.apiUrl}/repos/${github.repo}/issues`, {
          method: 'POST',
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${github.token}`,
            'Content-Type': 'application/json',
            'User-Agent': 'dishkept-feedback',
            'X-GitHub-Api-Version': '2022-11-28',
          },
          body: JSON.stringify(issue),
          signal: AbortSignal.timeout(deps.timeoutMs ?? 15_000),
        });
      } catch (error) {
        return failed(error instanceof Error ? error.name : 'fetch');
      }
      if (response.status !== 201) return failed(`status_${response.status}`);
      const filed = (await response.json().catch(() => null)) as {
        number?: unknown;
        html_url?: unknown;
      } | null;
      const url = typeof filed?.html_url === 'string' ? filed.html_url : null;
      if (typeof filed?.number !== 'number' || !url?.startsWith('https://')) {
        // GitHub may have filed it; counted, so a retry can't file it twice unseen.
        deps.log({ event: 'feedback_unreadable', reporter: me.reporter });
        return { kind: 'unavailable' };
      }
      deps.log({ event: 'feedback_filed', reporter: me.reporter, number: filed.number });
      return { kind: 'filed', number: filed.number, url };
    },
  };
}
