import { expect, test } from './fixtures';
import { createRecipe, freshEmail, openAdd, SEED, signIn, unique } from './helpers';

const tabBar = (page: import('@playwright/test').Page) =>
  page.getByRole('navigation', { name: 'Main' });

test('the tab bar moves between Recipes, Favorites and Household; + offers New recipe and Import', async ({
  page,
}) => {
  await signIn(page, freshEmail('nav'));
  await expect(tabBar(page)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Recipes', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await page.getByRole('link', { name: 'Favorites', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Favorites', level: 1 })).toBeVisible();
  await expect(page).toHaveURL(/\/favorites$/);
  await page.getByRole('link', { name: 'Household' }).click();
  await expect(page.getByRole('link', { name: 'Trash' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await openAdd(page);
  await expect(page.getByRole('button', { name: 'New recipe' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import' })).toBeVisible();
  await page.getByRole('button', { name: 'Import' }).click();
  await expect(page.getByRole('heading', { name: 'Import a recipe' })).toBeVisible();
});

test('Escape and a tap outside close the + sheet (Review Focus 4)', async ({ page }) => {
  await signIn(page, freshEmail('nav-sheet'));
  await openAdd(page);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'New recipe' })).toHaveCount(0);
  await openAdd(page);
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('button', { name: 'New recipe' })).toHaveCount(0);
});

test('a viewer has no + and no Trash (rule 4, Review Focus 4)', async ({ page }) => {
  await signIn(page, SEED.viewerA);
  await expect(tabBar(page)).toBeVisible();
  await expect(page.getByRole('button', { name: /^Add a recipe/ })).toHaveCount(0);
  await page.getByRole('link', { name: 'Household' }).click();
  await expect(page.getByRole('link', { name: 'Trash' })).toHaveCount(0);
});

test('cook mode, sign-in and a signed-out shared page have no tab bar', async ({
  page,
  browser,
}) => {
  await signIn(page, freshEmail('nav-cook'));
  await createRecipe(page, { title: unique('Nav soup'), steps: 'Stir.' });
  await page.getByRole('button', { name: 'Cook' }).click();
  await expect(page.getByRole('button', { name: 'Done' })).toBeVisible();
  await expect(tabBar(page)).toHaveCount(0);

  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto('/s/' + 'x'.repeat(43));
  await expect(visitor.getByText('This recipe is no longer shared')).toBeVisible();
  await expect(tabBar(visitor)).toHaveCount(0);
  await visitor.goto('/sign-in');
  await expect(visitor.getByRole('button', { name: 'Send code' })).toBeVisible();
  await expect(tabBar(visitor)).toHaveCount(0);
  await visitor.context().close();
});
