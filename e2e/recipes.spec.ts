import { expect, test } from '@playwright/test';
import {
  createRecipe,
  fillEditor,
  findRecipe,
  freshEmail,
  SEED,
  session,
  signIn,
  unique,
} from './helpers';

const NFR5_MS = 10_000;

test('a recipe typed in full shows every field as typed and reaches another member', async ({
  browser,
}) => {
  const member = await session(browser, SEED.memberA);
  const admin = await session(browser, SEED.adminA);
  const title = unique('Grandma bread');
  await createRecipe(member, {
    title,
    servings: '4',
    prep: '15',
    cook: '40',
    ingredients: 'For the dough:\n2 1/2 cups flour, sifted\n1 tsp salt',
    steps: '1. Mix everything\n2. Bake',
    tags: 'Bread, Weekend',
    notes: 'Use the old pan',
  });
  for (const text of [
    'Serves 4 · Prep 15 min · Cook 40 min',
    'For the dough:',
    '2 1/2 cups flour, sifted',
    '1 tsp salt',
    'Mix everything',
    'Bake',
    'bread',
    'weekend',
    'Use the old pan',
  ]) {
    await expect(member.getByText(text, { exact: true })).toBeVisible();
  }

  // The other session reads synced JSON ingredients and the text[] tags.
  await (await findRecipe(admin, title)).click({ timeout: NFR5_MS });
  await expect(admin.getByText('2 1/2 cups flour, sifted', { exact: true })).toBeVisible();
  await expect(admin.getByText('weekend', { exact: true })).toBeVisible();
});

test('editing ingredients and steps reaches the other session', async ({ browser }) => {
  const member = await session(browser, SEED.memberA);
  const admin = await session(browser, SEED.adminA);
  const title = unique('Edited stew');
  await createRecipe(member, { title, ingredients: '1 onion', steps: 'Chop' });
  await member.getByRole('button', { name: 'Edit' }).click();
  await fillEditor(member, { title, ingredients: '2 onions\n1 carrot', steps: 'Chop\nSimmer' });
  await member.getByRole('button', { name: 'Save' }).click();
  await expect(member.getByText('1 carrot', { exact: true })).toBeVisible();

  await (await findRecipe(admin, title)).click({ timeout: NFR5_MS });
  await expect(admin.getByText('Simmer', { exact: true })).toBeVisible({ timeout: NFR5_MS });
  await expect(admin.getByText('1 onion', { exact: true })).toHaveCount(0);
});

test('an empty title or 0 servings shows messages and saves nothing', async ({ page }) => {
  await signIn(page, freshEmail('invalid'));
  await page.getByRole('button', { name: 'New recipe' }).click();
  await fillEditor(page, { title: '   ', servings: '0' });
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Title is required')).toBeVisible();
  await expect(page.getByText('Servings must be 1 to 999')).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText('No recipes yet')).toBeVisible();
});

test('cancel with changes asks before discarding', async ({ page }) => {
  await signIn(page, freshEmail('cancel'));
  await page.getByRole('button', { name: 'New recipe' }).click();
  await fillEditor(page, { title: 'Half typed' });

  page.once('dialog', (dialog) => {
    expect(dialog.message()).toBe('Discard your changes?');
    void dialog.dismiss();
  });
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Half typed');

  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText('No recipes yet')).toBeVisible();
});

test('a double tap on Save creates one recipe', async ({ page }) => {
  await signIn(page, freshEmail('double'));
  await page.getByRole('button', { name: 'New recipe' }).click();
  await fillEditor(page, { title: 'Only once' });
  await page.getByRole('button', { name: 'Save' }).dblclick();
  await expect(page.getByRole('heading', { name: 'Only once', level: 1 })).toBeVisible();
  await page.getByRole('link', { name: 'All recipes' }).click();
  await expect(await findRecipe(page, 'Only once')).toHaveCount(1);
});

test('a recipe created and edited offline syncs once back online', async ({ browser }) => {
  const member = await session(browser, SEED.memberA);
  const admin = await session(browser, SEED.adminA);
  await expect(await findRecipe(member, 'Seed pancakes')).toBeVisible({ timeout: 30_000 });
  await member.context().setOffline(true);
  const title = unique('Offline casserole');
  await createRecipe(member, { title, ingredients: '1 can soup' });
  await member.getByRole('button', { name: 'Edit' }).click();
  await fillEditor(member, { title, ingredients: '2 cans soup' });
  await member.getByRole('button', { name: 'Save' }).click();
  await member.context().setOffline(false);

  await (await findRecipe(admin, title)).click({ timeout: 45_000 });
  await expect(admin.getByText('2 cans soup', { exact: true })).toBeVisible({ timeout: 45_000 });
});

test('tag chips offer tags the household already uses', async ({ page }) => {
  await signIn(page, freshEmail('tags'));
  await createRecipe(page, { title: 'First', tags: 'dinner' });
  await page.getByRole('link', { name: 'All recipes' }).click();
  await page.getByRole('button', { name: 'New recipe' }).click();
  await fillEditor(page, { title: 'Second' });
  await page.getByRole('button', { name: 'Add tag dinner' }).click();
  await expect(page.getByLabel('Tags', { exact: true })).toHaveValue('dinner');
});

test('a viewer sees recipes but no New recipe, Edit, Move to Trash, or Trash', async ({ page }) => {
  await signIn(page, SEED.viewerA);
  await expect(await findRecipe(page, 'Seed pancakes')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'New recipe' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Trash' })).toHaveCount(0);
  await (await findRecipe(page, 'Seed pancakes')).click();
  await expect(page.getByRole('heading', { name: 'Seed pancakes', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Move to Trash' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^(Star|Unstar)$/ })).toBeVisible();
});
