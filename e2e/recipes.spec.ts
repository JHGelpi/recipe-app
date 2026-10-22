import { expect, test } from './fixtures';
import {
  openAdd,
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
  await openAdd(page);
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
  await openAdd(page);
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
  await openAdd(page);
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
  await openAdd(page);
  await page.getByRole('button', { name: 'New recipe' }).click();
  await fillEditor(page, { title: 'Second' });
  await page.getByRole('button', { name: 'Add tag dinner' }).click();
  await expect(page.getByLabel('Tags', { exact: true })).toHaveValue('dinner');
});

test('a viewer sees recipes but no New recipe, Edit, Move to Trash, or Trash', async ({ page }) => {
  await signIn(page, SEED.viewerA);
  await expect(await findRecipe(page, 'Seed pancakes')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'New recipe' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Add a recipe/ })).toHaveCount(0);
  await page.getByRole('link', { name: 'Household' }).click();
  await expect(page.getByRole('link', { name: 'Trash' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Recipes', exact: true }).click();
  await (await findRecipe(page, 'Seed pancakes')).click();
  await expect(page.getByRole('heading', { name: 'Seed pancakes', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Move to Trash' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'More', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^(Star|Unstar)$/ })).toBeVisible();
});

test('links in notes open in a new tab; other schemes and the editor stay plain text (FR-36)', async ({
  browser,
}) => {
  const member = await session(browser, SEED.memberA);
  const title = unique('Linked notes');
  const notes = 'From www.example.com/pasta. Not javascript:alert(1)';
  await createRecipe(member, { title, notes });

  const link = member.getByRole('link', { name: 'www.example.com/pasta', exact: true });
  await expect(link).toHaveAttribute('href', 'https://www.example.com/pasta');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', /noopener/);
  await expect(member.getByRole('link', { name: /javascript/ })).toHaveCount(0);
  await expect(member.getByText(/Not javascript:alert\(1\)/)).toBeVisible();

  // Editing shows the note as stored, period and all.
  await member.getByRole('button', { name: 'Edit' }).click();
  await expect(member.getByLabel('Notes', { exact: true })).toHaveValue(notes);
});

test('nutrition per serving is optional, shown when set, and kept when servings scale (FR-43)', async ({
  browser,
}) => {
  const member = await session(browser, SEED.memberA);
  const viewer = await session(browser, SEED.viewerA);
  const plain = unique('No nutrition');
  await createRecipe(member, { title: plain, servings: '2', ingredients: '1 cup oats' });
  await expect(member.getByRole('heading', { name: 'Nutrition', exact: true })).toHaveCount(0);

  const title = unique('Macro bowl');
  await createRecipe(member, { title, servings: '2', ingredients: '1 cup rice' });
  await member.getByRole('button', { name: 'Edit' }).click();
  await member.getByLabel('Calories (kcal)').fill('-3');
  await member.getByRole('button', { name: 'Save' }).click();
  await expect(member.getByText('Calories must be a number from 0 to 10000')).toBeVisible();
  await member.getByLabel('Calories (kcal)').fill('480');
  await member.getByLabel('Protein (g)').fill('25.5');
  await member.getByRole('button', { name: 'Save' }).click();
  await expect(member.getByText('Per serving', { exact: true })).toBeVisible();
  await expect(member.getByText('480 kcal', { exact: true })).toBeVisible();
  await expect(member.getByText('25.5 g protein', { exact: true })).toBeVisible();
  await expect(member.getByText('g carbs')).toHaveCount(0);

  // Scaling servings leaves the per-serving values alone.
  await member.getByRole('button', { name: 'More servings' }).click();
  await expect(member.getByText('480 kcal', { exact: true })).toBeVisible();

  await (await findRecipe(viewer, title)).click({ timeout: NFR5_MS });
  await expect(viewer.getByText('480 kcal', { exact: true })).toBeVisible({ timeout: NFR5_MS });
  await expect(viewer.getByRole('button', { name: 'Edit' })).toHaveCount(0);

  // Clearing every value removes the section.
  await member.getByRole('button', { name: 'Edit' }).click();
  await member.getByLabel('Calories (kcal)').fill('');
  await member.getByLabel('Protein (g)').fill('');
  await member.getByRole('button', { name: 'Save' }).click();
  await expect(member.getByRole('heading', { name: title, level: 1 })).toBeVisible();
  await expect(member.getByRole('heading', { name: 'Nutrition', exact: true })).toHaveCount(0);
});
