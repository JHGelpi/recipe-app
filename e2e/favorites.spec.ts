import { expect, test } from '@playwright/test';
import { createRecipe, SEED, session, unique } from './helpers';

test('starring shows a recipe under Favorites, only for the user who starred it', async ({
  browser,
}) => {
  const member = await session(browser, SEED.memberA);
  const admin = await session(browser, SEED.adminA);
  const title = unique('Starred pie');
  await createRecipe(member, { title });
  await member.getByRole('button', { name: 'Star' }).click();
  await expect(member.getByRole('button', { name: 'Unstar' })).toBeVisible();
  await member.getByRole('link', { name: 'All recipes' }).click();
  await member.getByRole('tab', { name: 'Favorites' }).click();
  await expect(member.getByText(title, { exact: true })).toBeVisible();
  await expect(member.getByText('Seed pancakes', { exact: true })).toHaveCount(0);

  await expect(admin.getByText(title, { exact: true })).toBeVisible({ timeout: 10_000 });
  await admin.getByRole('tab', { name: 'Favorites' }).click();
  await expect(admin.getByText(title, { exact: true })).toHaveCount(0);
});

test('a viewer can star a recipe', async ({ browser }) => {
  const viewer = await session(browser, SEED.viewerA);
  await viewer.getByText('Seed pancakes', { exact: true }).click({ timeout: 30_000 });
  // Independent of earlier runs: un-star first if a previous run left it starred.
  const unstar = viewer.getByRole('button', { name: 'Unstar' });
  if (await unstar.isVisible()) await unstar.click();
  await viewer.getByRole('button', { name: 'Star' }).click();
  await expect(unstar).toBeVisible();
  await viewer.getByRole('link', { name: 'All recipes' }).click();
  await viewer.getByRole('tab', { name: 'Favorites' }).click();
  await expect(viewer.getByText('Seed pancakes', { exact: true })).toBeVisible();
});
