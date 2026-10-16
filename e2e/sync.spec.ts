import { expect, test } from '@playwright/test';
import { addRecipe, SEED, session, unique } from './helpers';

const NFR5_MS = 10_000; // NFR-5: visible on other devices within ~10 s

test('a signed-in session goes online and receives its household recipes', async ({ browser }) => {
  const page = await session(browser, SEED.memberA);
  await expect(page.getByText('Seed pancakes', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/^Online · /)).toBeVisible();
  await expect(page.getByText('Seed curry')).toHaveCount(0);
});

test('a recipe added in one session appears in the same household within 10 seconds and never in another', async ({
  browser,
}) => {
  const member = await session(browser, SEED.memberA);
  const admin = await session(browser, SEED.adminA);
  const outsider = await session(browser, SEED.adminB);
  await expect(admin.getByText('Seed pancakes', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(outsider.getByText('Seed curry', { exact: true })).toBeVisible({ timeout: 30_000 });

  const title = unique('Shared soup');
  await addRecipe(member, title);

  await expect(admin.getByText(title, { exact: true })).toBeVisible({ timeout: NFR5_MS });
  await expect(member.getByText('Online · 0 unsynced')).toBeVisible({ timeout: NFR5_MS });

  // The other household has had the same 10 seconds and more to receive it.
  await outsider.waitForTimeout(3_000);
  await expect(outsider.getByText(title)).toHaveCount(0);
});

test('a recipe added offline is queued and syncs when the network returns', async ({ browser }) => {
  const member = await session(browser, SEED.memberA);
  const admin = await session(browser, SEED.adminA);
  await expect(member.getByText('Seed pancakes', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(admin.getByText('Seed pancakes', { exact: true })).toBeVisible({ timeout: 30_000 });

  await member.context().setOffline(true);
  const title = unique('Offline stew');
  await addRecipe(member, title);
  await expect(member.getByText('Offline · 1 unsynced')).toBeVisible({ timeout: 30_000 });
  await admin.waitForTimeout(3_000);
  await expect(admin.getByText(title)).toHaveCount(0);

  await member.context().setOffline(false);
  // Reconnection backs off, so allow longer than the online target.
  await expect(admin.getByText(title, { exact: true })).toBeVisible({ timeout: 45_000 });
  await expect(member.getByText('Online · 0 unsynced')).toBeVisible({ timeout: 45_000 });
});
