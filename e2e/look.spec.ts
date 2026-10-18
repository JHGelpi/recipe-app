import { expect, test } from './fixtures';
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

test('a long tag and a total time stay clear of the star (Final 3)', async ({ page }) => {
  await signIn(page, freshEmail('look-meta'));
  await createRecipe(page, {
    title: unique('Meta soup'),
    prep: '35',
    cook: '60',
    tags: 'a-really-long-tag-name-that-goes-on-on',
  });
  await page.getByRole('link', { name: 'Recipes', exact: true }).click();
  const time = page.getByText('1 h 35 min');
  const star = page.getByRole('button', { name: 'Star', exact: true }).first();
  const [t, s] = [(await time.boundingBox())!, (await star.boundingBox())!];
  expect(t.x + t.width).toBeLessThanOrEqual(s.x);
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

test('if the fonts never load, text uses the system font (Review Focus 3)', async ({ page }) => {
  await page.route('**/*.ttf', (route) => route.abort());
  await page.goto('/sign-in');
  const heading = page.getByRole('heading', { name: 'Dishkept' });
  await expect(heading).toBeVisible();
  const family = await heading.evaluate((element) => getComputedStyle(element).fontFamily);
  expect(family).toContain('system-ui');
});
