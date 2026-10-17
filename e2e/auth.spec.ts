import { expect, test } from '@playwright/test';
import { env } from '../test-support/env';
import { watchMailbox } from '../test-support/mail';
import { addRecipe, expectNotListed, freshEmail, requestCode, signIn } from './helpers';

test('a new email signs in with a code and lands on an empty recipe list', async ({ page }) => {
  await signIn(page, freshEmail('new'));
  await expect(page.getByText('No recipes yet')).toBeVisible();
});

test('an email typed with capitals and spaces still signs in', async ({ page }) => {
  const email = freshEmail('caps');
  await page.goto('/');
  // The mailbox is watched under the normalised address.
  const mailbox = await watchMailbox(env.mailUrl, email);
  await page.getByLabel('Email').fill(`  ${email.toUpperCase()} `);
  await page.getByRole('button', { name: 'Send code' }).click();
  const code = await mailbox.nextCode();
  await page.getByLabel('Code').fill(code);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Recipes' })).toBeVisible();
});

test('an invalid email shows a message and sends nothing', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Email').fill('not-an-email');
  await page.getByRole('button', { name: 'Send code' }).click();
  await expect(page.getByText('Enter a valid email address.')).toBeVisible();
  await expect(page.getByLabel('Code')).toHaveCount(0);
});

test('a wrong code shows a message and the right code still works', async ({ page }) => {
  const code = await requestCode(page, freshEmail('wrong'));
  const wrong = code === '000000' ? '111111' : '000000';
  await page.getByLabel('Code').fill(wrong);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('That code is incorrect or has expired.')).toBeVisible();

  await page.getByLabel('Code').fill(code);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Recipes' })).toBeVisible();
});

test('the session survives a reload', async ({ page }) => {
  await signIn(page, freshEmail('reload'));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Recipes' })).toBeVisible();
});

test('signing out wipes the local database', async ({ page }) => {
  await signIn(page, freshEmail('first'));
  await addRecipe(page, 'Secret stew');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByLabel('Email')).toBeVisible();

  await signIn(page, freshEmail('second'));
  await expect(page.getByText('No recipes yet')).toBeVisible();
  await expectNotListed(page, 'Secret stew');
});
