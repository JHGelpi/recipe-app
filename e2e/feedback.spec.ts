import { expect, test, type Page } from './fixtures';
import { freshEmail, settled, signIn, unique } from './helpers';
import { env } from '../test-support/env';

type FiledIssue = { title: string; body: string; labels: string[] };

async function filed(title: string): Promise<FiledIssue | undefined> {
  const { issues } = (await (await fetch(`${env.fakeAiUrl}/__issues`)).json()) as {
    issues: FiledIssue[];
  };
  return issues.find((issue) => issue.title === title);
}

async function openFeedback(page: Page) {
  await page.getByRole('link', { name: 'Household', exact: true }).click();
  await settled(page);
  await page.getByRole('link', { name: 'Send feedback' }).click();
  await expect(page.getByRole('heading', { name: 'Send feedback', level: 1 })).toBeVisible();
}

test('an idea is filed on GitHub with the details shown first, and nothing personal (FR-45)', async ({
  page,
}) => {
  const email = freshEmail('feedback-idea');
  await signIn(page, email);
  await page.getByRole('link', { name: 'Household', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Dishkept on GitHub' })).toHaveAttribute(
    'href',
    'https://github.com/JHGelpi/recipe-app',
  );
  await openFeedback(page);
  await expect(
    page.getByText('What you send is posted publicly on GitHub. Leave out names, emails'),
  ).toBeVisible();

  // Required answers are asked for, and nothing is sent.
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Add a short summary')).toBeVisible();

  const summary = unique('Plan the week');
  await page.getByLabel('Short summary').fill(summary);
  await page.getByLabel('What would you like Dishkept to do?').fill('A week view for dinners.');
  await page
    .getByLabel('Why would this help? What are you trying to do when you need it?')
    .fill('We plan on Sundays.');

  const details = page.getByRole('button', { name: "Details we'll include" });
  await expect(details).toHaveAttribute('aria-expanded', 'false');
  await details.click();
  await expect(page.getByText('Opened as:')).toBeVisible();
  await expect(page.getByText(/^Role: Admin/)).toBeVisible();
  await expect(page.getByText(/^Sent: \d{4}-\d{2}-\d{2}/)).toBeVisible();

  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Thanks! We got it.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Follow it on GitHub' })).toHaveAttribute(
    'href',
    /^https:\/\/github\.com\/JHGelpi\/recipe-app\/issues\/\d+$/,
  );

  const issue = (await filed(summary))!;
  expect(issue.labels).toEqual(['feature']);
  expect(issue.body).toContain('### Why would this help?');
  expect(issue.body).toMatch(/Sent from Dishkept · Reporter r-[0-9a-f]{6}$/);
  expect(issue.body).not.toContain(email);
  expect(issue.body).not.toContain(email.split('@')[0]!);
  expect(issue.body).not.toContain('household');
});

test('a problem report keeps its draft when sending fails, and Try again files it (FR-45)', async ({
  page,
}) => {
  await signIn(page, freshEmail('feedback-problem'));
  await openFeedback(page);
  await page.getByRole('tab', { name: 'Report a problem' }).click();

  // The fake GitHub fails this title the first time.
  const summary = unique('FAKE_GITHUB_DOWN photo import hangs');
  await page.getByLabel('Short summary').fill(summary);
  await page.getByLabel('What happened?').fill('The spinner never stopped.');
  await page.getByLabel('What did you expect to happen?').fill('A draft to review.');
  const steps = page.getByLabel('What did you do just before it happened? List the steps.');
  await expect(steps).toHaveValue('1. ');
  await steps.fill('1. Tap +\n2. Import a photo');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Choose how often it happens')).toBeVisible();
  await page.getByRole('button', { name: 'Sometimes' }).click();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Import', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await page.getByRole('button', { name: "Details we'll include" }).click();
  await expect(page.getByText('Offline in the last 10 minutes:')).toBeVisible();
  await expect(page.getByText('Uploads waiting:')).toBeVisible();

  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: "Couldn't send it" })).toBeVisible();
  await expect(page.getByLabel('What happened?')).toHaveValue('The spinner never stopped.');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByText('Thanks! We got it.')).toBeVisible();

  const issue = (await filed(summary))!;
  expect(issue.labels).toEqual(['bug']);
  expect(issue.body).toContain('### How often does it happen?\n\nSometimes');
  expect(issue.body).toContain('### Which part of the app?\n\nImport');
  expect(issue.body).toContain('- **Offline in the last 10 minutes:** No');
});

test('offline, feedback and the GitHub link say they need a connection (FR-45)', async ({
  page,
  context,
}) => {
  await signIn(page, freshEmail('feedback-offline'));
  await page.getByRole('link', { name: 'Household', exact: true }).click();
  await settled(page);
  await context.setOffline(true);
  await expect(page.getByText('Needs a connection.')).toHaveCount(2);
  await expect(page.getByRole('link', { name: 'Send feedback' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Dishkept on GitHub' })).toHaveCount(0);
  await context.setOffline(false);
  await expect(page.getByRole('link', { name: 'Send feedback' })).toBeVisible();
});
