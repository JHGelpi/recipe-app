import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import { env } from '../test-support/env';
import { createRecipe, SEED, session, unique } from './helpers';

test('Move to Trash, then Restore, on two sessions', async ({ browser }) => {
  const member = await session(browser, SEED.memberA);
  const admin = await session(browser, SEED.adminA);
  const title = unique('Trashed tart');
  await createRecipe(member, { title });

  member.once('dialog', (dialog) => void dialog.accept());
  await member.getByRole('button', { name: 'Move to Trash' }).click();
  await expect(member.getByRole('heading', { name: 'Recipes', level: 1 })).toBeVisible();
  await expect(member.getByText(title, { exact: true })).toHaveCount(0);

  await admin.getByRole('link', { name: 'Trash' }).click();
  await expect(admin.getByText(title, { exact: true })).toBeVisible({ timeout: 10_000 });
  // The household has other trash; check this recipe's own row.
  await expect(admin.getByText(title, { exact: true }).locator('xpath=..')).toContainText(
    'Deletes in 30 days',
  );
  await admin.getByRole('button', { name: `Restore ${title}` }).click();
  await expect(admin.getByText(title, { exact: true })).toHaveCount(0);

  await expect(member.getByText(title, { exact: true })).toBeVisible({ timeout: 10_000 });
});

test('trash older than 30 days is deleted for good when a member comes online', async ({
  browser,
}) => {
  const sql = postgres(env.adminDbUrl, { max: 1, onnotice: () => {} });
  try {
    const member = await session(browser, SEED.memberA);
    const title = unique('Ancient soup');
    await createRecipe(member, { title });
    await expect
      .poll(async () => (await sql`select 1 from recipes where title = ${title}`).length, {
        timeout: 15_000,
      })
      .toBe(1);
    await sql`update recipes set deleted_at = now() - interval '31 days' where title = ${title}`;

    // A fresh device has never purged, so connecting triggers the purge.
    await session(browser, SEED.memberA);
    await expect
      .poll(async () => (await sql`select 1 from recipes where title = ${title}`).length, {
        timeout: 30_000,
      })
      .toBe(0);
    await member.getByRole('link', { name: 'All recipes' }).click();
    await member.getByRole('link', { name: 'Trash' }).click();
    await expect(member.getByText(title, { exact: true })).toHaveCount(0);
  } finally {
    await sql.end();
  }
});

test('a viewer opening /trash is sent to the list', async ({ browser }) => {
  const viewer = await session(browser, SEED.viewerA);
  await viewer.goto('/trash');
  await expect(viewer.getByRole('heading', { name: 'Recipes', level: 1 })).toBeVisible();
});
