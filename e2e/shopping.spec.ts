import { expect, test } from './fixtures';
import { createRecipe, freshEmail, openList, SEED, signIn, unique } from './helpers';

async function addFromRecipe(page: import('@playwright/test').Page, untick: string[] = []) {
  await page.getByRole('button', { name: 'Add to list' }).click();
  const sheet = page.getByRole('dialog', { name: 'Add to shopping list' });
  for (const line of untick) await sheet.getByRole('checkbox', { name: line }).click();
  await sheet.getByRole('button', { name: /^Add \d+ items?$/ }).click();
}

test('adding a recipe with lines unticked adds only the others, grouped by aisle (FR-32, FR-34)', async ({
  page,
}) => {
  await signIn(page, freshEmail('shop-add'));
  await createRecipe(page, {
    title: unique('List soup'),
    ingredients: '2 onions\n1 cup milk\n1 tsp salt\n2 tbsp olive oil',
  });
  await addFromRecipe(page, ['1 tsp salt', '2 tbsp olive oil']);
  await expect(page.getByText('Added 2 items to your list')).toBeVisible();
  await openList(page);
  await expect(page.getByRole('heading', { name: 'Produce', level: 2 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Dairy & Eggs', level: 2 })).toBeVisible();
  await expect(page.getByText('salt')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Shopping list, 2 to buy' })).toBeVisible();
});

test('a second recipe’s onions merge into one line that lists both recipes (FR-33)', async ({
  page,
}) => {
  await signIn(page, freshEmail('shop-merge'));
  const soup = unique('Merge soup');
  const stew = unique('Merge stew');
  await createRecipe(page, { title: soup, ingredients: '1 onion' });
  await addFromRecipe(page);
  await createRecipe(page, { title: stew, ingredients: '2 onions, diced' });
  await addFromRecipe(page);
  await openList(page);
  await expect(page.getByRole('button', { name: 'onion, 3' })).toBeVisible();
  await page.getByRole('button', { name: 'More for onion' }).click();
  const sheet = page.getByRole('dialog', { name: 'onion' });
  await expect(sheet.getByText(soup, { exact: true })).toBeVisible();
  await expect(sheet.getByText(stew, { exact: true })).toBeVisible();
});

test('ticking moves a line to Got it; Clear ticked removes it (FR-35)', async ({ page }) => {
  await signIn(page, freshEmail('shop-tick'));
  await openList(page);
  await page.getByLabel('Add an item').fill('2 lemons');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('button', { name: 'Got lemons' }).click();
  await expect(page.getByRole('heading', { name: 'Got it' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear ticked' }).click();
  await expect(page.getByText('Your list is empty.', { exact: false })).toBeVisible();
});

test('a typed item lands in its aisle, and a moved aisle is remembered (FR-34)', async ({
  page,
}) => {
  await signIn(page, freshEmail('shop-aisle'));
  await openList(page);
  await page.getByLabel('Add an item').fill('2 lemons');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Produce', level: 2 })).toBeVisible();
  await page.getByRole('button', { name: 'More for lemons' }).click();
  await page.getByRole('button', { name: 'Frozen' }).click();
  await expect(page.getByRole('heading', { name: 'Frozen', level: 2 })).toBeVisible();
  await page.getByRole('button', { name: 'More for lemons' }).click();
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await page.getByLabel('Add an item').fill('1 lemon');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Frozen', level: 2 })).toBeVisible();
});

test('a change made offline syncs, and another member sees it (FR-31)', async ({
  page,
  browser,
}) => {
  await signIn(page, SEED.memberA);
  await openList(page);
  await page.context().setOffline(true);
  const item = unique('Offline basil');
  await page.getByLabel('Add an item').fill(item);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.context().setOffline(false);
  await expect(page.getByText('Online · 0 unsynced')).toBeVisible({ timeout: 30_000 });
  const other = await (await browser.newContext()).newPage();
  await signIn(other, SEED.adminA);
  await openList(other);
  await expect(other.getByText(item)).toBeVisible({ timeout: 15_000 });
  await other.context().close();
});

test('a Viewer sees the list with no controls (rule 4)', async ({ page }) => {
  await signIn(page, SEED.viewerA);
  await openList(page);
  // Household A's seed row is on the list, so there are lines to check.
  await expect(page.getByRole('button', { name: 'More for Seed onions' })).toBeVisible();
  await expect(page.getByLabel('Add an item')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Got / })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Clear list' })).toHaveCount(0);
  await page.getByRole('button', { name: 'More for Seed onions' }).click();
  const sheet = page.getByRole('dialog', { name: 'Seed onions' });
  await expect(sheet.getByText('For')).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Remove', exact: true })).toHaveCount(0);
});

test('servings changed on the page are the servings added (FR-32, review C1)', async ({ page }) => {
  await signIn(page, freshEmail('shop-servings'));
  await createRecipe(page, {
    title: unique('Servings soup'),
    servings: '2',
    ingredients: '2 onions',
  });
  await page.getByRole('button', { name: 'More servings' }).click();
  await page.getByRole('button', { name: 'More servings' }).click();
  await page.getByRole('button', { name: 'Add to list' }).click();
  const sheet = page.getByRole('dialog', { name: 'Add to shopping list' });
  await expect(sheet.getByRole('checkbox', { name: /^4 onions/ })).toBeVisible();
  await sheet.getByRole('button', { name: 'Add 1 item' }).click();
  await openList(page);
  await expect(page.getByRole('button', { name: 'onions, 4' })).toBeVisible();
});
