import { expect, test } from '@playwright/test';
import { createRecipe, freshEmail, signIn, unique } from './helpers';

test.use({ viewport: { width: 390, height: 600 } });

test('a long title wraps and the star stays on screen (Review Focus 1)', async ({ page }) => {
  await signIn(page, freshEmail('look-long'));
  const title = unique('A very long recipe title '.repeat(5));
  await createRecipe(page, { title, tags: 'a-really-long-tag-name-that-goes-on-on' });
  await page.getByRole('link', { name: 'Recipes', exact: true }).click();
  const star = page.getByRole('button', { name: 'Star', exact: true }).first();
  const box = (await star.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(390);
});

test('the end of the list scrolls clear of the tab bar (Review Focus 2)', async ({ page }) => {
  await signIn(page, freshEmail('look-end'));
  for (let i = 0; i < 6; i++) await createRecipe(page, { title: unique(`End soup ${i}`) });
  await page.getByRole('link', { name: 'Recipes', exact: true }).click();
  const footer = page.getByLabel('Build');
  await footer.scrollIntoViewIfNeeded();
  const end = (await footer.boundingBox())!;
  const bar = (await page.getByRole('navigation', { name: 'Main' }).boundingBox())!;
  expect(end.y + end.height).toBeLessThanOrEqual(bar.y + 1);
});

test('a recipe with no photo shows the quiet placeholder, announced as nothing (Review Focus 5)', async ({
  page,
}) => {
  await signIn(page, freshEmail('look-thumb'));
  const title = unique('Plain soup');
  await createRecipe(page, { title });
  await page.getByRole('link', { name: 'Recipes', exact: true }).click();
  await expect(page.getByTestId('thumb-placeholder').first()).toBeVisible();
  await expect(page.getByRole('img', { name: `Photo of ${title}` })).toHaveCount(0);
});
