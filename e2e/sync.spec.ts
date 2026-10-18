import { expect, test } from './fixtures';
import { addRecipe, expectNotListed, findRecipe, SEED, session, unique } from './helpers';

const NFR5_MS = 10_000; // NFR-5: visible on other devices within ~10 s

test('a signed-in session goes online and receives its household recipes', async ({ browser }) => {
  const page = await session(browser, SEED.memberA);
  await expect(await findRecipe(page, 'Seed pancakes')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/^Online · /)).toBeVisible();
  await expectNotListed(page, 'Seed curry');
});

test('a recipe added in one session appears in the same household within 10 seconds and never in another', async ({
  browser,
}) => {
  const member = await session(browser, SEED.memberA);
  const admin = await session(browser, SEED.adminA);
  const outsider = await session(browser, SEED.adminB);
  await expect(await findRecipe(admin, 'Seed pancakes')).toBeVisible({ timeout: 30_000 });
  await expect(await findRecipe(outsider, 'Seed curry')).toBeVisible({ timeout: 30_000 });

  const title = unique('Shared soup');
  await addRecipe(member, title);

  await expect(await findRecipe(admin, title)).toBeVisible({ timeout: NFR5_MS });
  await expect(member.getByText('Online · 0 unsynced')).toBeVisible({ timeout: NFR5_MS });

  // The other household has had the same 10 seconds and more to receive it.
  await outsider.waitForTimeout(3_000);
  await expectNotListed(outsider, title);
});

test('a recipe added offline is queued and syncs when the network returns', async ({ browser }) => {
  const member = await session(browser, SEED.memberA);
  const admin = await session(browser, SEED.adminA);
  await expect(await findRecipe(member, 'Seed pancakes')).toBeVisible({ timeout: 30_000 });
  await expect(await findRecipe(admin, 'Seed pancakes')).toBeVisible({ timeout: 30_000 });

  await member.context().setOffline(true);
  const title = unique('Offline stew');
  await addRecipe(member, title);
  await expect(member.getByText('Offline · 1 unsynced')).toBeVisible({ timeout: 30_000 });
  await admin.waitForTimeout(3_000);
  await expectNotListed(admin, title);

  await member.context().setOffline(false);
  // Reconnection backs off, so allow longer than the online target.
  await expect(await findRecipe(admin, title)).toBeVisible({ timeout: 45_000 });
  await expect(member.getByText('Online · 0 unsynced')).toBeVisible({ timeout: 45_000 });
});
