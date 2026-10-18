import { expect, test, type Page } from './fixtures';
import {
  createRecipe,
  freshEmail,
  reloadOffline,
  SEED,
  session,
  signIn,
  unique,
  waitForServiceWorker,
} from './helpers';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

async function cakeRecipe(page: Page, title: string): Promise<void> {
  await createRecipe(page, {
    title,
    servings: '4',
    ingredients: '2 cups flour\n1 cup buttermilk\n3 eggs',
    steps: 'Mix the dry ingredients.\nAdd the buttermilk and eggs.\nBake 30 minutes.',
  });
}

test('cook mode keeps its place through a reload, and Done starts fresh (FR-21)', async ({
  page,
}) => {
  await signIn(page, freshEmail('cook-mode'));
  const title = unique('Cook cake');
  await cakeRecipe(page, title);
  await page.getByRole('button', { name: 'Cook' }).click();
  await expect(page.getByText('Step 1 of 3')).toBeVisible();
  await page.getByRole('checkbox', { name: '2 cups flour' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('Add the buttermilk and eggs.')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Step 2 of 3')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: '2 cups flour' })).toBeChecked();
  await page.getByRole('button', { name: 'Previous' }).click();
  await expect(page.getByText('Step 1 of 3')).toBeVisible();
  await page.getByRole('button', { name: 'Go to step 3' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Cook' }).click();
  await expect(page.getByText('Step 1 of 3')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: '2 cups flour' })).not.toBeChecked();
});

test('servings scale and units convert on the recipe and in cook mode (FR-22, FR-23)', async ({
  page,
}) => {
  await signIn(page, freshEmail('cook-scale'));
  await cakeRecipe(page, unique('Scaled cake'));
  await page.getByRole('button', { name: 'More servings' }).click();
  await page.getByRole('button', { name: 'More servings' }).click();
  await expect(page.getByText('Serves 6', { exact: true })).toBeVisible();
  await expect(page.getByText('3 cups flour')).toBeVisible();
  await expect(page.getByText('1½ cups buttermilk')).toBeVisible();
  await page.getByRole('button', { name: 'Metric' }).click();
  await expect(page.getByText('710 ml flour')).toBeVisible();
  await page.getByRole('button', { name: 'Cook' }).click();
  await expect(page.getByRole('checkbox', { name: '710 ml flour' })).toBeVisible();
  await expect(page.getByText('Amounts in steps are for the original 4 servings')).toBeVisible();
});

test('a substitute is asked online, added to notes, and remembered offline (FR-24, FR-25)', async ({
  page,
  context,
}) => {
  await signIn(page, freshEmail('cook-subs'));
  await cakeRecipe(page, unique('Sub cake'));
  await waitForServiceWorker(page);
  await page.getByRole('button', { name: 'Substitute for 1 cup buttermilk' }).click();
  await page.getByRole('button', { name: 'Ask for substitutes' }).click();
  await expect(page.getByText('Fake yogurt', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Add to notes' }).first().click();
  await expect(
    page.getByText('Instead of 1 cup buttermilk: 1 cup fake yogurt — Fake effect.'),
  ).toBeVisible();

  await context.setOffline(true);
  await reloadOffline(page);
  await page.getByRole('button', { name: 'Substitute for 1 cup buttermilk' }).click();
  await expect(page.getByText('Fake yogurt', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ask again' })).toHaveCount(0);
});

test('viewers see remembered substitutes but cannot ask or add (rule 4)', async ({
  page,
  browser,
}) => {
  await signIn(page, SEED.memberA);
  const title = unique('Shared sub cake');
  await cakeRecipe(page, title);
  await page.getByRole('button', { name: 'Substitute for 1 cup buttermilk' }).click();
  await page.getByRole('button', { name: 'Ask for substitutes' }).click();
  await expect(page.getByText('Fake yogurt', { exact: true })).toBeVisible({ timeout: 30_000 });

  const viewer = await session(browser, SEED.viewerA);
  await viewer.getByLabel('Search recipes').fill(title);
  await viewer.getByText(title, { exact: true }).click();
  await viewer.getByRole('button', { name: 'Substitute for 1 cup buttermilk' }).click();
  await expect(viewer.getByText('Fake yogurt', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(viewer.getByRole('button', { name: 'Ask again' })).toHaveCount(0);
  await expect(viewer.getByRole('button', { name: 'Add to notes' })).toHaveCount(0);
  await viewer.context().close();
});
