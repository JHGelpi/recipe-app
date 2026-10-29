import { expect, test } from './fixtures';
import {
  createRecipe,
  findRecipe,
  freshEmail,
  settingSaved,
  settled,
  signIn,
  unique,
} from './helpers';

async function openUnits(page: import('@playwright/test').Page) {
  await page.getByRole('link', { name: 'Household', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Units' })).toBeVisible();
  await settled(page);
}

async function openRecipe(page: import('@playwright/test').Page, title: string) {
  await page.getByRole('link', { name: 'Recipes', exact: true }).click();
  await (await findRecipe(page, title)).click();
  await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
}

test('recipes open in the units chosen on Household; a recipe’s own choice and the saved recipe stay (FR-23)', async ({
  page,
}) => {
  await signIn(page, freshEmail('units-pref'));
  const kept = unique('Kept US cake');
  const fresh = unique('Fresh metric cake');
  await createRecipe(page, { title: kept, servings: '4', ingredients: '2 cups flour' });
  // With nothing saved: As written, as before.
  await expect(page.getByText('2 cups flour', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'US' }).click();
  await createRecipe(page, { title: fresh, servings: '4', ingredients: '2 cups flour' });

  await openUnits(page);
  await expect(page.getByRole('tab', { name: 'As written' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.getByRole('tab', { name: 'Metric' }).click();
  await settingSaved(page, 'units', 'metric');
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Metric' })).toHaveAttribute('aria-selected', 'true');

  // A recipe opened afresh starts in Metric, and so does its cook mode.
  await openRecipe(page, fresh);
  await expect(page.getByText(/ml flour$/)).toBeVisible();
  await page.getByRole('button', { name: 'Cook', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: /ml flour$/ })).toBeVisible();
  // Done starts fresh at the preference.
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText(/ml flour$/)).toBeVisible();

  // A recipe whose place was already open keeps its own choice.
  await openRecipe(page, kept);
  await expect(page.getByRole('button', { name: 'US' })).toHaveAttribute('aria-pressed', 'true');

  // The saved recipe never changes: the editor still holds what was typed.
  await openRecipe(page, fresh);
  await page.getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByLabel('Ingredients', { exact: true })).toHaveValue('2 cups flour');
});

test('the units choice follows the person to another device (FR-23, ADR-0031)', async ({
  page,
  browser,
}) => {
  const email = freshEmail('units-device');
  await signIn(page, email);
  await openUnits(page);
  await page.getByRole('tab', { name: 'Metric' }).click();
  const device = await browser.newContext();
  const other = await device.newPage();
  await signIn(other, email);
  await openUnits(other);
  await expect(other.getByRole('tab', { name: 'Metric' })).toHaveAttribute(
    'aria-selected',
    'true',
    { timeout: 30_000 },
  );
  await device.close();
});

test('a units choice reaches the other open tabs (FR-23)', async ({ page, context }) => {
  await signIn(page, freshEmail('units-tabs'));
  const other = await context.newPage();
  await other.goto('/household');
  await expect(other.getByRole('tab', { name: 'As written' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await openUnits(page);
  await page.getByRole('tab', { name: 'US' }).click();
  await expect(other.getByRole('tab', { name: 'US' })).toHaveAttribute('aria-selected', 'true');
  await other.close();
});
