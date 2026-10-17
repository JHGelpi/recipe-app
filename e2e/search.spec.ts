import { expect, test, type Page } from '@playwright/test';
import { createRecipe, freshEmail, signIn, type RecipeInput } from './helpers';

async function add(page: Page, input: RecipeInput): Promise<void> {
  await createRecipe(page, input);
  await page.getByRole('link', { name: 'All recipes' }).click();
}

/** Titles in the order the list shows them. */
async function shown(page: Page, titles: string[]): Promise<string[]> {
  const pattern = new RegExp(
    `^(${titles.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})$`,
  );
  return page.getByText(pattern).allTextContents();
}

async function kitchen(page: Page): Promise<void> {
  await signIn(page, freshEmail('search'));
  await add(page, {
    title: 'Chicken Tikka',
    ingredients: '1 lb chicken thighs\n1 cup yogurt',
    tags: 'dinner, spicy',
  });
  await add(page, {
    title: 'Fried rice',
    ingredients: '2 cups rice\n1 cup chicken stock',
    tags: 'dinner, quick',
  });
  await add(page, { title: 'Chicken and rice', ingredients: '1 onion', tags: 'quick' });
}

const TITLES = ['Chicken Tikka', 'Fried rice', 'Chicken and rice'];

test('part of a title or an ingredient finds recipes, title matches first', async ({ page }) => {
  await kitchen(page);
  await page.getByLabel('Search recipes').fill('chick');
  await expect(page.getByText('3 recipes')).toBeVisible();
  await expect
    .poll(() => shown(page, TITLES))
    .toEqual(['Chicken and rice', 'Chicken Tikka', 'Fried rice']);
  await page.getByLabel('Search recipes').fill('yog');
  await expect.poll(() => shown(page, TITLES)).toEqual(['Chicken Tikka']);
});

test('two words list only recipes containing both', async ({ page }) => {
  await kitchen(page);
  await page.getByLabel('Search recipes').fill('rice chick');
  await expect(page.getByText('2 recipes')).toBeVisible();
  await expect
    .poll(async () => (await shown(page, TITLES)).sort())
    .toEqual(['Chicken and rice', 'Fried rice']);
});

test('two tag chips narrow to recipes having both, and combine with a word', async ({ page }) => {
  await kitchen(page);
  await page.getByRole('button', { name: 'Tag dinner' }).click();
  await page.getByRole('button', { name: 'Tag quick' }).click();
  await expect(page.getByRole('button', { name: 'Tag dinner' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect.poll(() => shown(page, TITLES)).toEqual(['Fried rice']);
  await page.getByLabel('Search recipes').fill('tikka');
  await expect(page.getByText('No recipes match')).toBeVisible();
});

test('search works within Favorites, and a missing tag there says so', async ({ page }) => {
  await kitchen(page);
  await page.getByText('Fried rice', { exact: true }).click();
  await page.getByRole('button', { name: 'Star' }).click();
  await page.getByRole('link', { name: 'All recipes' }).click();
  await page.getByRole('tab', { name: 'Favorites' }).click();
  await page.getByLabel('Search recipes').fill('rice');
  await expect.poll(() => shown(page, TITLES)).toEqual(['Fried rice']);

  await page.getByRole('tab', { name: 'All' }).click();
  await page.getByRole('button', { name: 'Tag spicy' }).click();
  await page.getByLabel('Search recipes').fill('');
  await page.getByRole('tab', { name: 'Favorites' }).click();
  await expect(page.getByText('No recipes match')).toBeVisible();
});

test('no match says so, and Clear search brings the list back', async ({ page }) => {
  await kitchen(page);
  await page.getByLabel('Search recipes').fill('zzz');
  await expect(page.getByText('No recipes match')).toBeVisible();
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  await expect(page.getByLabel('Search recipes')).toHaveValue('');
  await expect.poll(async () => (await shown(page, TITLES)).sort()).toEqual([...TITLES].sort());
});

test('search works offline', async ({ page }) => {
  await kitchen(page);
  await page.context().setOffline(true);
  await page.getByLabel('Search recipes').fill('tikka');
  await expect.poll(() => shown(page, TITLES)).toEqual(['Chicken Tikka']);
});
