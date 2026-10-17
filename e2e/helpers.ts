import { expect, type Browser, type Locator, type Page } from '@playwright/test';
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

export type RecipeInput = {
  title: string;
  servings?: string;
  prep?: string;
  cook?: string;
  ingredients?: string;
  steps?: string;
  tags?: string;
  notes?: string;
};

/** Fills the open editor. Empty fields are left as they are. */
export async function fillEditor(page: Page, input: RecipeInput): Promise<void> {
  const fields: [string, string | undefined][] = [
    ['Title', input.title],
    ['Servings', input.servings],
    ['Prep (min)', input.prep],
    ['Cook (min)', input.cook],
    ['Ingredients', input.ingredients],
    ['Steps', input.steps],
    ['Tags', input.tags],
    ['Notes', input.notes],
  ];
  for (const [label, value] of fields) {
    if (value !== undefined) await page.getByLabel(label, { exact: true }).fill(value);
  }
}

/** Creates a recipe through the editor and ends on the recipe's own screen. */
export async function createRecipe(page: Page, input: RecipeInput): Promise<void> {
  await page.getByRole('button', { name: 'New recipe' }).click();
  await fillEditor(page, input);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: input.title, level: 1 })).toBeVisible();
}

/** Creates a title-only recipe and returns to the list (the walking-skeleton flow). */
/**
 * Types a title into the Recipes list's search box and returns the title in
 * the results. The list is virtualized, so a recipe far down a long list is
 * not in the page until it is searched for; absence checks must search too.
 */
export async function findRecipe(page: Page, title: string): Promise<Locator> {
  await page.getByLabel('Search recipes').fill(title);
  return page.getByText(title, { exact: true });
}

/** Empties the search box, if it has text. */
export async function clearSearch(page: Page): Promise<void> {
  const clear = page.getByRole('button', { name: 'Clear search text' });
  if (await clear.isVisible()) await clear.click();
}

export async function addRecipe(page: Page, title: string): Promise<void> {
  await createRecipe(page, { title });
  await page.getByRole('link', { name: 'All recipes' }).click();
  await expect(await findRecipe(page, title)).toBeVisible();
  await clearSearch(page);
}

const AUTH_STORAGE_KEY = 'supabase.auth.token';

/** A signed-in page in its own browser context, as on its own device. */
export async function session(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, email);
  return page;
}

export function unique(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Ends every session of the page's user on the server, as an admin revoking it would. */
export async function revokeSession(page: Page): Promise<void> {
  const accessToken = await page.evaluate((key) => {
    const saved = JSON.parse(localStorage.getItem(key) ?? 'null') as { access_token?: string };
    return saved?.access_token ?? '';
  }, AUTH_STORAGE_KEY);
  const response = await fetch(`${env.authUrl}/logout?scope=global`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  expect(response.status).toBe(204);
}

/** Moves the saved access token's expiry into the past, so the next start must renew it. */
export async function expireSavedSession(page: Page): Promise<void> {
  await page.evaluate((key) => {
    const saved = JSON.parse(localStorage.getItem(key) ?? 'null') as { expires_at?: number };
    if (!saved) throw new Error('No saved session');
    saved.expires_at = Math.floor(Date.now() / 1000) - 60;
    localStorage.setItem(key, JSON.stringify(saved));
  }, AUTH_STORAGE_KEY);
}

/** Waits until the service worker controls the page, so it can open offline. */
export async function waitForServiceWorker(page: Page): Promise<void> {
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, undefined, {
    timeout: 30_000,
  });
}

/**
 * Reloads while offline. After a reload served by the service worker,
 * Chromium under Playwright reports navigator.onLine === true although the
 * network is still blocked (a real phone in airplane mode reports false), so
 * offline is applied again to restore the browser's offline state.
 */
export async function reloadOffline(page: Page): Promise<void> {
  await page.reload();
  await page.context().setOffline(false);
  await page.context().setOffline(true);
}

/**
 * Asserts a recipe is not on the Recipes list. Waits for the search to have
 * filtered the list ("No recipes match") before counting, so a match outside
 * the virtualized window of an unfiltered list cannot slip through.
 */
export async function expectNotListed(page: Page, title: string): Promise<void> {
  await page.getByLabel('Search recipes').fill(title);
  await expect(page.getByText('No recipes match')).toBeVisible();
  await expect(page.getByText(title, { exact: true })).toHaveCount(0);
}
