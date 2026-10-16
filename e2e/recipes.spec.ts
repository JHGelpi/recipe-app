import { expect, test } from '@playwright/test';
import { addRecipe, freshEmail, SEED, signIn } from './helpers';

test('an added recipe appears in the list and survives a reload', async ({ page }) => {
  await signIn(page, freshEmail('cook'));
  await addRecipe(page, 'Tomato soup');
  await expect(page.getByText('No recipes yet')).toHaveCount(0);
  await expect(page.getByLabel('Recipe title')).toHaveValue('');
  await page.reload();
  await expect(page.getByText('Tomato soup', { exact: true })).toBeVisible();
});

test('rejects a blank title with a message and saves nothing', async ({ page }) => {
  await signIn(page, freshEmail('blank'));
  await page.getByLabel('Recipe title').fill('   ');
  await page.getByRole('button', { name: 'Add recipe' }).click();
  await expect(page.getByText('Title is required')).toBeVisible();
  await expect(page.getByText('No recipes yet')).toBeVisible();
});

test('rejects a title over 200 characters', async ({ page }) => {
  await signIn(page, freshEmail('long'));
  await page.getByLabel('Recipe title').fill('a'.repeat(201));
  await page.getByRole('button', { name: 'Add recipe' }).click();
  await expect(page.getByText('Title must be 200 characters or fewer')).toBeVisible();
  await expect(page.getByText('No recipes yet')).toBeVisible();
});

test('a viewer sees the list but no add form', async ({ page }) => {
  await signIn(page, SEED.viewerA);
  await expect(page.getByLabel('Recipe title')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add recipe' })).toHaveCount(0);
});
