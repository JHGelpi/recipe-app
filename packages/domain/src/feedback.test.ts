import { describe, expect, it } from 'vitest';
import {
  feedbackDetailLines,
  feedbackIssue,
  feedbackRequestSchema,
  type FeedbackDetails,
} from './feedback';

const details: FeedbackDetails = {
  build: '2026-10-23 12:24',
  storage: 'persistent',
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
  display: 'Installed app',
  screen: '390 × 844',
  appearance: 'Dark',
  units: 'Metric',
  online: true,
  sentAt: '2026-10-23 14:05 (America/New_York, UTC−04:00)',
};

const idea = {
  kind: 'idea' as const,
  summary: 'Plan meals for the week',
  want: 'A week view to plan dinners.',
  why: 'I plan on Sundays.',
};

const problem = {
  kind: 'problem' as const,
  summary: 'Photo import hangs',
  happened: 'It spun forever.',
  expected: 'A draft to review.',
  steps: '1. Tap +\n2. Import a photo',
  frequency: 'Sometimes' as const,
  area: 'Import' as const,
};

describe('feedbackRequestSchema (FR-45)', () => {
  it('accepts both forms with their required answers', () => {
    expect(feedbackRequestSchema.safeParse({ report: idea, details }).success).toBe(true);
    expect(
      feedbackRequestSchema.safeParse({
        report: problem,
        details: { ...details, offlineRecently: false, waitingUploads: 0 },
      }).success,
    ).toBe(true);
  });

  it('refuses a missing summary or required answer, and an unknown choice', () => {
    for (const report of [
      { ...idea, summary: '  ' },
      { ...idea, why: '' },
      { ...problem, steps: '' },
      { ...problem, area: 'Settings' },
      { ...problem, frequency: 'Often' },
    ]) {
      expect(feedbackRequestSchema.safeParse({ report, details }).success).toBe(false);
    }
  });

  it('refuses any detail it doesn’t list, so nothing personal can ride along', () => {
    for (const extra of [{ email: 'a@b.c' }, { householdName: 'Smith household' }, { name: 'A' }]) {
      expect(
        feedbackRequestSchema.safeParse({ report: idea, details: { ...details, ...extra } })
          .success,
      ).toBe(false);
    }
    expect(
      feedbackRequestSchema.safeParse({ report: { ...idea, email: 'a@b.c' }, details }).success,
    ).toBe(false);
  });
});

describe('feedbackIssue (FR-45)', () => {
  it('an idea is labelled feature, with its sections, the details and the reporter', () => {
    const issue = feedbackIssue(idea, details, 'viewer', 'r-3f9a1c');
    expect(issue.title).toBe('Plan meals for the week');
    expect(issue.labels).toEqual(['feature']);
    expect(issue.body).toContain('### What would you like Dishkept to do?\n\nA week view');
    expect(issue.body).toContain('### How do you handle this today?\n\n_No answer_');
    expect(issue.body).toContain('- **Role:** Viewer');
    expect(issue.body).toContain('- **Screen:** 390 × 844');
    expect(issue.body.endsWith('Sent from Dishkept · Reporter r-3f9a1c')).toBe(true);
    expect(issue.body).not.toContain('Offline in the last 10 minutes');
  });

  it('a problem is labelled bug, and notes recent offline time and waiting uploads', () => {
    const issue = feedbackIssue(
      problem,
      { ...details, offlineRecently: true, waitingUploads: 2 },
      'member',
      'r-000001',
    );
    expect(issue.labels).toEqual(['bug']);
    const headings = [...issue.body.matchAll(/^### (.+)$/gm)].map((match) => match[1]);
    expect(headings).toEqual([
      'What happened?',
      'What did you expect to happen?',
      'What did you do just before it happened? List the steps.',
      'How often does it happen?',
      'Which part of the app?',
      'Details',
    ]);
    expect(issue.body).toContain('- **Offline in the last 10 minutes:** Yes');
    expect(issue.body).toContain('- **Uploads waiting:** 2');
  });

  it('an @mention can’t notify anyone on GitHub', () => {
    const issue = feedbackIssue(
      { ...idea, summary: 'Ping @octocat', want: 'Ask @someone' },
      details,
      'admin',
      'r-3f9a1c',
    );
    expect(issue.title).not.toMatch(/@\w/);
    expect(issue.body).not.toMatch(/@\w/);
  });

  it('the detail lines are the same ones the app shows before sending', () => {
    expect(feedbackDetailLines(details, 'admin').map(([name]) => name)).toEqual([
      'App build',
      'Storage',
      'Browser and OS',
      'Opened as',
      'Screen',
      'Appearance',
      'Units',
      'Online',
      'Role',
      'Sent',
    ]);
  });
});
