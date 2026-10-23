import { expect, test } from './fixtures';
import postgres from 'postgres';
import { env } from '../test-support/env';
import { createRecipe, expectNotListed, findRecipe, SEED, session, unique } from './helpers';

// From db/seed.sql.
const VIEWER_A_ID = '00000000-0000-0000-0000-0000000000a3';
const SEED_PANCAKES_ID = '00000000-0000-0000-0000-0000000000c1';

test('the heart shows a recipe under Favorites, only for the user who chose it', async ({
  browser,
}) => {
  const member = await session(browser, SEED.memberA);
  const admin = await session(browser, SEED.adminA);
  const title = unique('Starred pie');
  await createRecipe(member, { title });
  await member.getByRole('button', { name: 'Favorite', exact: true }).click();
  await expect(member.getByRole('button', { name: 'Unfavorite', exact: true })).toBeVisible();
  await member.getByRole('link', { name: 'All recipes' }).click();
  await member.getByRole('link', { name: 'Favorites', exact: true }).click();
  await expect(await findRecipe(member, title)).toBeVisible();
  await expectNotListed(member, 'Seed pancakes');

  await expect(await findRecipe(admin, title)).toBeVisible({ timeout: 10_000 });
  await admin.getByRole('link', { name: 'Favorites', exact: true }).click();
  await expectNotListed(admin, title);
});

test('a viewer can favorite a recipe', async ({ browser }) => {
  // Arranged in the database, so the test does not depend on earlier runs or
  // on reading the heart before its state has loaded.
  const sql = postgres(env.adminDbUrl, { max: 1, onnotice: () => {} });
  try {
    await sql`delete from favorites where user_id = ${VIEWER_A_ID} and recipe_id = ${SEED_PANCAKES_ID}`;
  } finally {
    await sql.end();
  }
  const viewer = await session(browser, SEED.viewerA);
  await (await findRecipe(viewer, 'Seed pancakes')).click({ timeout: 30_000 });
  await viewer.getByRole('button', { name: 'Favorite', exact: true }).click();
  await expect(viewer.getByRole('button', { name: 'Unfavorite', exact: true })).toBeVisible();
  await viewer.getByRole('link', { name: 'All recipes' }).click();
  await viewer.getByRole('link', { name: 'Favorites', exact: true }).click();
  await expect(await findRecipe(viewer, 'Seed pancakes')).toBeVisible();
});
