import { expect, test } from '@playwright/test';
import {
  addRecipe,
  expireSavedSession,
  freshEmail,
  reloadOffline,
  SEED,
  session,
  unique,
  waitForServiceWorker,
} from './helpers';

test('the app opens with no network once it has been loaded, and offline writes sync later', async ({
  browser,
}) => {
  const member = await session(browser, SEED.memberA);
  await expect(member.getByText('Seed pancakes', { exact: true })).toBeVisible({ timeout: 30_000 });
  await waitForServiceWorker(member);

  await member.context().setOffline(true);
  await reloadOffline(member);
  await expect(member.getByRole('heading', { name: 'Recipes' })).toBeVisible();
  await expect(member.getByText('Seed pancakes', { exact: true })).toBeVisible();
  await expect(member.getByText(/^Offline · /)).toBeVisible();

  const title = unique('Cold start pie');
  await addRecipe(member, title);
  await expect(member.getByText('Offline · 1 unsynced')).toBeVisible({ timeout: 30_000 });

  const admin = await session(browser, SEED.adminA);
  await member.context().setOffline(false);
  await expect(admin.getByText(title, { exact: true })).toBeVisible({ timeout: 45_000 });
});

test('an expired token offline keeps the user signed in, and it renews once online', async ({
  browser,
}) => {
  const page = await session(browser, freshEmail('stale'));
  const first = unique('Stale-token stew');
  await addRecipe(page, first);
  await expect(page.getByText('Online · 0 unsynced')).toBeVisible({ timeout: 30_000 });
  await waitForServiceWorker(page);

  await page.context().setOffline(true);
  await expireSavedSession(page);
  await reloadOffline(page);
  await expect(page.getByText(first, { exact: true })).toBeVisible();
  await expect(page.getByLabel('Email')).toHaveCount(0);

  const second = unique('Stale-token soup');
  await addRecipe(page, second);
  await expect(page.getByText('Offline · 1 unsynced')).toBeVisible({ timeout: 30_000 });

  await page.context().setOffline(false);
  await expect(page.getByText('Online · 0 unsynced')).toBeVisible({ timeout: 60_000 });
  const expiresAt = await page.evaluate(
    () =>
      (JSON.parse(localStorage.getItem('supabase.auth.token') ?? '{}') as { expires_at?: number })
        .expires_at ?? 0,
  );
  expect(expiresAt * 1000).toBeGreaterThan(Date.now());
});

test('opening offline before anyone signs in shows the sign-in screen and a clear message', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByLabel('Email')).toBeVisible();
  await waitForServiceWorker(page);

  await page.context().setOffline(true);
  await page.reload();
  await expect(page.getByLabel('Email')).toBeVisible();
  await page.getByLabel('Email').fill(freshEmail('nobody'));
  await page.getByRole('button', { name: 'Send code' }).click();
  await expect(
    page.getByText('Could not reach the server. Check your connection and try again.'),
  ).toBeVisible();
});

test('the service worker leaves API and auth requests to the network', async ({ page }) => {
  await page.goto('/');
  await waitForServiceWorker(page);
  const types = await page.evaluate(async () => {
    const api = await fetch('/api/health');
    const auth = await fetch('/auth/health');
    return [api.headers.get('content-type'), auth.headers.get('content-type')];
  });
  expect(types[0]).toContain('application/json');
  expect(types[1]).toContain('application/json');
});

test('sw.js is never cached by HTTP and precaches the app shell', async ({ request }) => {
  const response = await request.get('/sw.js');
  expect(response.ok()).toBe(true);
  expect(response.headers()['cache-control']).toBe('no-cache');
  expect(response.headers()['content-type']).toContain('javascript');
  const source = await response.text();
  expect(source).toContain('precacheAndRoute');
  expect(source).toContain('index.html');
});
