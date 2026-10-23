import { z } from 'zod';

/**
 * FR-45: an idea or a problem report, filed as a public GitHub issue. Only
 * what the person typed and the device details below leave the app; never an
 * email, a name, the household, recipe content, or invite and share links.
 */

export const FEEDBACK_SUMMARY_MAX = 120;
const TEXT_MAX = 4000;

const summary = z
  .string()
  .trim()
  .min(1, 'Add a short summary')
  .max(FEEDBACK_SUMMARY_MAX, `Keep the summary to ${FEEDBACK_SUMMARY_MAX} characters`);
const required = (message: string) =>
  z.string().trim().min(1, message).max(TEXT_MAX, `Keep this to ${TEXT_MAX} characters`);

export const FEEDBACK_FREQUENCIES = ['Every time', 'Sometimes', 'Just once'] as const;
export const FEEDBACK_AREAS = [
  'Recipes',
  'Import',
  'Cook mode',
  'Shopping list',
  'Cook diary',
  'Household',
  'Sign-in',
  'Other',
] as const;

export const ideaSchema = z.strictObject({
  kind: z.literal('idea'),
  summary,
  want: required('Say what you would like Dishkept to do'),
  why: required('Say why this would help'),
  today: z.string().trim().max(TEXT_MAX, `Keep this to ${TEXT_MAX} characters`).optional(),
});

export const problemSchema = z.strictObject({
  kind: z.literal('problem'),
  summary,
  happened: required('Say what happened'),
  expected: required('Say what you expected'),
  steps: required('List what you did just before'),
  frequency: z.enum(FEEDBACK_FREQUENCIES, { error: 'Choose how often it happens' }),
  area: z.enum(FEEDBACK_AREAS, { error: 'Choose a part of the app' }),
});

export const feedbackReportSchema = z.discriminatedUnion('kind', [ideaSchema, problemSchema]);

/** Filled in by the app. Strict: a field not listed here can't reach GitHub. */
export const feedbackDetailsSchema = z.strictObject({
  build: z.string().max(100),
  storage: z.string().max(60),
  userAgent: z.string().max(400),
  display: z.enum(['Installed app', 'Browser tab']),
  screen: z.string().regex(/^\d{1,5} × \d{1,5}$/),
  appearance: z.enum(['System', 'Light', 'Dark']),
  units: z.enum(['As written', 'US', 'Metric']),
  online: z.boolean(),
  sentAt: z.string().max(80),
  // Problem reports only.
  offlineRecently: z.boolean().optional(),
  waitingUploads: z.number().int().min(0).max(10_000).optional(),
});

export const feedbackRequestSchema = z.strictObject({
  report: feedbackReportSchema,
  details: feedbackDetailsSchema,
});

export type FeedbackReport = z.infer<typeof feedbackReportSchema>;
export type FeedbackDetails = z.infer<typeof feedbackDetailsSchema>;
export type FeedbackRequest = z.infer<typeof feedbackRequestSchema>;
export type FeedbackRole = 'admin' | 'member' | 'viewer';

/** The questions, as the forms and the issue both word them. */
export const FEEDBACK_QUESTIONS = {
  want: 'What would you like Dishkept to do?',
  why: 'Why would this help? What are you trying to do when you need it?',
  today: 'How do you handle this today?',
  happened: 'What happened?',
  expected: 'What did you expect to happen?',
  steps: 'What did you do just before it happened? List the steps.',
  frequency: 'How often does it happen?',
  area: 'Which part of the app?',
} as const;

export const FEEDBACK_NOTICE =
  'What you send is posted publicly on GitHub. Leave out names, emails, and anything personal.';

export const FEEDBACK_DAILY_LIMIT = 5;

const ROLE_NAME: Record<FeedbackRole, string> = {
  admin: 'Admin',
  member: 'Member',
  viewer: 'Viewer',
};

/** "@someone" would notify a GitHub user; a zero-width space keeps it plain text. */
function quiet(text: string): string {
  return text.replace(/@(?=\w)/g, '@​');
}

const yesNo = (value: boolean) => (value ? 'Yes' : 'No');

/** The auto-filled lines, in the order the "Details we'll include" section shows them. */
export function feedbackDetailLines(
  details: FeedbackDetails,
  role: FeedbackRole,
): [string, string][] {
  const lines: [string, string][] = [
    ['App build', details.build],
    ['Storage', details.storage],
    ['Browser and OS', details.userAgent],
    ['Opened as', details.display],
    ['Screen', details.screen],
    ['Appearance', details.appearance],
    ['Units', details.units],
    ['Online', yesNo(details.online)],
    ['Role', ROLE_NAME[role]],
    ['Sent', details.sentAt],
  ];
  if (details.offlineRecently !== undefined) {
    lines.push(['Offline in the last 10 minutes', yesNo(details.offlineRecently)]);
  }
  if (details.waitingUploads !== undefined) {
    lines.push(['Uploads waiting', String(details.waitingUploads)]);
  }
  return lines;
}

/** The GitHub issue: headed sections matching the form, the details, then the reporter. */
export function feedbackIssue(
  report: FeedbackReport,
  details: FeedbackDetails,
  role: FeedbackRole,
  reporterId: string,
): { title: string; body: string; labels: string[] } {
  const section = (heading: string, text: string | undefined) =>
    `### ${heading}\n\n${text?.trim() ? quiet(text.trim()) : '_No answer_'}`;
  const sections =
    report.kind === 'idea'
      ? [
          section(FEEDBACK_QUESTIONS.want, report.want),
          section(FEEDBACK_QUESTIONS.why, report.why),
          section(FEEDBACK_QUESTIONS.today, report.today),
        ]
      : [
          section(FEEDBACK_QUESTIONS.happened, report.happened),
          section(FEEDBACK_QUESTIONS.expected, report.expected),
          section(FEEDBACK_QUESTIONS.steps, report.steps),
          section(FEEDBACK_QUESTIONS.frequency, report.frequency),
          section(FEEDBACK_QUESTIONS.area, report.area),
        ];
  const detailList = feedbackDetailLines(details, role)
    .map(([name, value]) => `- **${name}:** ${quiet(value)}`)
    .join('\n');
  return {
    title: quiet(report.summary),
    body: [
      ...sections,
      `### Details\n\n${detailList}`,
      `---\nSent from Dishkept · Reporter ${reporterId}`,
    ].join('\n\n'),
    labels: [report.kind === 'idea' ? 'feature' : 'bug'],
  };
}
