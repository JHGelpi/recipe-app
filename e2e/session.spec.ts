import { expect, test } from '@playwright/test';
import {
  addRecipe,
  expireSavedSession,
  findRecipe,
  freshEmail,
  revokeSession,
  session,
  signIn,
  unique,
} from './helpers';

test('when the server ends the session, unsynced recipes survive and upload after the same user signs back in', async ({
  browser,
}) => {
  const email = freshEmail('revoked');
  const page = await session(browser, email);
  const context = page.context();
  await expect(page.getByText(/^Online · /)).toBeVisible({ timeout: 30_000 });

  // Hold uploads so the recipe stays unsynced while online.
  await context.route('**/api/upload', (route) => route.abort());
  const title = unique('Kept casserole');
  await addRecipe(page, title);
  await expect(page.getByText(/· 1 unsynced$/)).toBeVisible({ timeout: 30_000 });

  await revokeSession(page);
  await expireSavedSession(page);
  await page.reload();
  await expect(page.getByLabel('Email')).toBeVisible({ timeout: 30_000 });

  await context.unroute('**/api/upload');
  await signIn(page, email);
  await expect(await findRecipe(page, title)).toBeVisible();
  await expect(page.getByText('Online · 0 unsynced')).toBeVisible({ timeout: 45_000 });

  // The server has it: a fresh device for the same user receives it.
  const other = await session(browser, email);
  await expect(await findRecipe(other, title)).toBeVisible({ timeout: 30_000 });
});

test('when the server ends the session and a different user signs in, the old data is wiped first', async ({
  browser,
}) => {
  const page = await session(browser, freshEmail('previous'));
  const title = unique('Private pie');
  await addRecipe(page, title);
  await expect(page.getByText('Online · 0 unsynced')).toBeVisible({ timeout: 30_000 });

  await revokeSession(page);
  await expireSavedSession(page);
  await page.reload();
  await expect(page.getByLabel('Email')).toBeVisible({ timeout: 30_000 });

  // Record whether the old title is ever on screen, not just at the end:
  // the next user must not glimpse it while the wipe runs.
  await page.addInitScript((oldTitle) => {
    const check = () => {
      if (document.body?.innerText.includes(oldTitle)) sessionStorage.setItem('sawOld', '1');
    };
    new MutationObserver(check).observe(document, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  }, title);
  await signIn(page, freshEmail('next'));
  await expect(page.getByText('No recipes yet')).toBeVisible({ timeout: 30_000 });
  await expect(await findRecipe(page, title)).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem('sawOld'))).toBeNull();
});

test('signing out while offline still wipes the local data', async ({ browser }) => {
  const page = await session(browser, freshEmail('offline-out'));
  const title = unique('Forgotten fudge');
  await addRecipe(page, title);
  await expect(page.getByText('Online · 0 unsynced')).toBeVisible({ timeout: 30_000 });

  await page.context().setOffline(true);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByLabel('Email')).toBeVisible();

  await page.context().setOffline(false);
  await signIn(page, freshEmail('after-offline-out'));
  await expect(page.getByText('No recipes yet')).toBeVisible({ timeout: 30_000 });
  await expect(await findRecipe(page, title)).toHaveCount(0);
});
