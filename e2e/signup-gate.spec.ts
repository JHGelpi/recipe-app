import { expect, test } from './fixtures';
import { createRecipe, freshEmail, requestCode, SEED, setGate, signIn, unique } from './helpers';
import { watchMailbox } from '../test-support/mail';
import { env } from '../test-support/env';

test.afterEach(async () => setGate(false));

const INVITE_ONLY =
  'Dishkept is invite-only for now. Ask someone who uses it to send you an invite.';

async function enterEmail(page: import('@playwright/test').Page, email: string) {
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send code' }).click();
}

async function finishSignIn(page: import('@playwright/test').Page, email: string) {
  const mailbox = await watchMailbox(env.mailUrl, email);
  await enterEmail(page, email);
  await page.getByLabel('Code').fill(await mailbox.nextCode());
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('with the gate on, a stranger is told Dishkept is invite-only', async ({ page }) => {
  await setGate(true);
  await page.goto('/');
  await enterEmail(page, freshEmail('stranger'));
  await expect(page.getByText(INVITE_ONLY)).toBeVisible();
});

test('an existing account signs in normally with the gate on', async ({ page }) => {
  await setGate(true);
  await signIn(page, SEED.memberA);
});

test('a friend link from Household lets a new person sign up (FR-6)', async ({
  page,
  browser,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await signIn(page, freshEmail('friend-owner'));
  await page.getByRole('link', { name: 'Household', exact: true }).click();
  await page.getByRole('button', { name: 'Invite a friend to Dishkept' }).click();
  await expect(page.getByText('Link copied')).toBeVisible();
  const url = await page.evaluate(() => navigator.clipboard.readText());
  expect(url).toMatch(/\/welcome\/[A-Za-z0-9_-]{43}$/);

  await setGate(true);
  const friend = await (await browser.newContext()).newPage();
  await friend.goto(url);
  await expect(
    friend.getByText('Someone invited you to make your own recipe collection.'),
  ).toBeVisible();
  await finishSignIn(friend, freshEmail('friend'));
  await expect(friend.getByRole('heading', { name: 'Recipes' })).toBeVisible();
  await friend.context().close();
});

test('an invite link lets a new person sign up with the gate on (FR-3)', async ({
  page,
  browser,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await signIn(page, freshEmail('gate-inviter'));
  await page.getByRole('link', { name: 'Household', exact: true }).click();
  await page.getByRole('button', { name: 'Share invite' }).click();
  const url = (await page.getByLabel('Invite link').textContent())!.trim();

  await setGate(true);
  const guest = await (await browser.newContext()).newPage();
  await guest.goto(url);
  await guest.getByRole('link', { name: 'Sign in' }).click();
  await finishSignIn(guest, freshEmail('gate-invitee'));
  await expect(guest.getByRole('button', { name: /^Join/ })).toBeVisible();
  await guest.context().close();
});

test('a shared recipe lets a new person sign up to save it (FR-27)', async ({ page, browser }) => {
  await signIn(page, freshEmail('gate-sharer'));
  const title = unique('Gate soup');
  await createRecipe(page, { title, ingredients: '1 egg', steps: 'Cook.' });
  await page.getByRole('button', { name: 'Share' }).click();
  await page.getByRole('button', { name: 'Link' }).click();
  const url = (await page.getByLabel('Share link').textContent())!.trim();

  await setGate(true);
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(url);
  await visitor.getByRole('button', { name: 'Save to my recipes' }).click();
  await finishSignIn(visitor, freshEmail('gate-saver'));
  await expect(visitor.getByRole('heading', { name: title })).toBeVisible();
  await visitor.context().close();
});

test('an existing account signs in through a dead friend link; a new one is told it expired', async ({
  page,
}) => {
  await setGate(true);
  await page.goto(`/welcome/${'d'.repeat(43)}`);
  await enterEmail(page, freshEmail('late-friend'));
  await expect(page.getByText('This link has expired. Ask for a new one.')).toBeVisible();
  const code = await requestCode(page, SEED.adminA);
  expect(code).toMatch(/^\d{6}$/);
});
