import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { env } from '../../../../test-support/env';
import { signInFresh } from '../../../../test-support/auth';
import { adminSql } from '../helpers/db';

// Fresh people each run: the limit is per person and the stack outlives a run.
const fresh = (tag: string) => signInFresh(`feedback-${tag}-${randomUUID()}@example.test`);

const details = {
  build: 'test',
  storage: 'persistent',
  userAgent: 'vitest',
  display: 'Browser tab',
  screen: '1280 × 800',
  appearance: 'System',
  units: 'As written',
  online: true,
  sentAt: '2026-10-23 14:05 (UTC)',
};

const idea = (summary: string) => ({
  report: { kind: 'idea', summary, want: 'A week view', why: 'I plan on Sundays' },
  details,
});

function post(token: string | null, body: unknown): Promise<Response> {
  return fetch(`${env.apiUrl}/feedback`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

type FiledIssue = { title: string; body: string; labels: string[]; repo: string; number: number };

async function filedIssue(title: string): Promise<FiledIssue | undefined> {
  const { issues } = (await (await fetch(`${env.fakeAiUrl}/__issues`)).json()) as {
    issues: FiledIssue[];
  };
  return issues.find((issue) => issue.title === title);
}

describe('POST /api/feedback (FR-45)', () => {
  it('files an issue under the anonymous reporter id, with no email or household', async () => {
    const person = await fresh('idea');
    const summary = `Meal plan ${randomUUID()}`;
    const response = await post(person.accessToken, idea(summary));
    expect(response.status).toBe(201);
    const { url, number } = (await response.json()) as { url: string; number: number };
    expect(url).toBe(`https://github.com/JHGelpi/recipe-app/issues/${number}`);

    const issue = (await filedIssue(summary))!;
    expect(issue.repo).toBe('JHGelpi/recipe-app');
    expect(issue.labels).toEqual(['feature']);
    const [row] = await adminSql<{ reporter_id: string }[]>`
      select reporter_id from public.feedback_reporters where user_id = ${person.userId}`;
    expect(issue.body).toContain(`Reporter ${row!.reporter_id}`);
    expect(issue.body).toContain('- **Role:** Admin');
    for (const personal of [person.email, person.email.split('@')[0]!, person.userId]) {
      expect(issue.body).not.toContain(personal);
    }
    expect(issue.body).not.toContain(person.householdId!);
  });

  it('refuses without a session, and files nothing', async () => {
    const summary = `Signed out ${randomUUID()}`;
    expect((await post(null, idea(summary))).status).toBe(401);
    expect((await post('not-a-token', idea(summary))).status).toBe(401);
    expect(await filedIssue(summary)).toBeUndefined();
  });

  it('five a day per person; a GitHub failure does not count', async () => {
    const person = await fresh('limit');
    // The fake GitHub fails this title once, then files it.
    const flaky = `FAKE_GITHUB_DOWN ${randomUUID()}`;
    expect((await post(person.accessToken, idea(flaky))).status).toBe(502);
    expect((await post(person.accessToken, idea(flaky))).status).toBe(201);
    for (let i = 1; i < 5; i++) {
      expect((await post(person.accessToken, idea(`Limit ${i} ${randomUUID()}`))).status).toBe(201);
    }
    const sixth = await post(person.accessToken, idea(`Sixth ${randomUUID()}`));
    expect(sixth.status).toBe(429);
    // Someone else still can.
    const other = await fresh('other');
    expect((await post(other.accessToken, idea(`Other ${randomUUID()}`))).status).toBe(201);
  });
});
