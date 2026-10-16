import { expect, type Page } from '@playwright/test';
import { env } from '../test-support/env';
import { watchMailbox } from '../test-support/mail';

export const SEED = {
  adminA: 'admin-a@example.test',
  memberA: 'member-a@example.test',
  viewerA: 'viewer-a@example.test',
  adminB: 'admin-b@example.test',
} as const;

export function freshEmail(tag: string): string {
  return `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
}

// GoTrue sends at most one email per address per AUTH_EMAIL_MAX_FREQUENCY
// (1s in .env). Seed users sign in back to back across tests, so space out
// requests for the same address. Workers is 1, so this map sees every request.
const EMAIL_SPACING_MS = 1_100;
const lastRequestAt = new Map<string, number>();

/** Fills the email step and returns the code that was emailed. */
export async function requestCode(page: Page, email: string): Promise<string> {
  const wait = (lastRequestAt.get(email) ?? 0) + EMAIL_SPACING_MS - Date.now();
  if (wait > 0) await page.waitForTimeout(wait);
  lastRequestAt.set(email, Date.now());
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  const mailbox = await watchMailbox(env.mailUrl, email);
  await page.getByRole('button', { name: 'Send code' }).click();
  return mailbox.nextCode();
}

export async function signIn(page: Page, email: string): Promise<void> {
  const code = await requestCode(page, email);
  await page.getByLabel('Code').fill(code);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Recipes' })).toBeVisible();
}

export async function addRecipe(page: Page, title: string): Promise<void> {
  await page.getByLabel('Recipe title').fill(title);
  await page.getByRole('button', { name: 'Add recipe' }).click();
  await expect(page.getByText(title, { exact: true })).toBeVisible();
}
