import { readFileSync } from 'node:fs';
import { parseReleaseNotes, releaseHeading } from '../packages/domain/src/releaseNotes';
import { expect, test } from './fixtures';
import { freshEmail, signIn } from './helpers';

// FR-47. The built app's version is the newest entry in RELEASE_NOTES.md; a
// device that last saw an older one stands in for a device that just updated.
const releases = parseReleaseNotes(readFileSync('RELEASE_NOTES.md', 'utf8'));
const current = releases[0]!;
const SEEN_KEY = 'dishkept.whatsNew.seen';

test('a first visit shows no What’s new sheet and records the version as seen', async ({
  page,
}) => {
  await signIn(page, freshEmail('whatsnew-first'));
  await expect(page.getByLabel('Build')).toContainText(`Version ${current.version} · Build`);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Recipes' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'What’s new' })).toHaveCount(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), SEEN_KEY)).toBe(current.version);
});

test('after an update the sheet shows once, only once signed in @firefox', async ({ page }) => {
  // A device that had the app before release notes: a service worker in
  // control, nothing stored.
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  await page.evaluate((key) => localStorage.removeItem(key), SEEN_KEY);
  await page.reload();
  expect(await page.evaluate((key) => localStorage.getItem(key), SEEN_KEY)).toBe('0.0.0');
  // Signed out: the notes wait.
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'What’s new' })).toHaveCount(0);

  await signIn(page, freshEmail('whatsnew-update'));
  const sheet = page.getByRole('dialog', { name: 'What’s new' });
  await expect(sheet).toBeVisible();
  // NFR-11: a screen reader lands in the sheet.
  await expect
    .poll(() => sheet.evaluate((element) => element.contains(document.activeElement)))
    .toBe(true);
  await expect(sheet.getByRole('heading', { name: releaseHeading(current) })).toBeVisible();
  for (const note of current.notes)
    await expect(sheet.getByText(note, { exact: true })).toBeVisible();
  await sheet.getByRole('button', { name: 'Got it' }).click();
  await expect(sheet).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Recipes' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'What’s new' })).toHaveCount(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), SEEN_KEY)).toBe(current.version);
});

test('the Household screen lists every release, newest first', async ({ page }) => {
  await signIn(page, freshEmail('whatsnew-list'));
  await page.getByRole('link', { name: 'Household' }).click();
  await expect(page.getByText(`Version ${current.version} · see what changed`)).toBeVisible();
  await page.getByRole('link', { name: 'What’s new' }).click();
  await expect(page.getByRole('heading', { name: 'What’s new', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(
    releases.map((release) => releaseHeading(release)),
  );
});
