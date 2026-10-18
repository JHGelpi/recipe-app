import { test } from './fixtures';
import { createRecipe, freshEmail, openAdd, signIn, unique } from './helpers';

// Run on request: SCREENSHOTS=1 npx playwright test e2e/screens.spec.ts
// Saves phone-size pictures of the main screens to test-results/screens/.
test.skip(!process.env.SCREENSHOTS, 'screenshots only on request');
test.use({ viewport: { width: 390, height: 844 } });

test('main screens', async ({ page }) => {
  const shot = async (name: string) => {
    // Images (the mark, photos) load a moment after the page draws.
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `test-results/screens/${name}.png` });
  };
  await page.goto('/sign-in');
  await shot('01-sign-in');
  await signIn(page, freshEmail('shots'));
  for (const [title, tags] of [
    ['Lemon bars', 'dessert'],
    ['Weeknight chili', 'dinner'],
    ['Green curry', 'dinner'],
  ] as const) {
    await createRecipe(page, {
      title: unique(title),
      servings: '4',
      prep: '15',
      cook: '30',
      tags,
      ingredients: '2 cups flour\n⅓ cup lemon juice\n1 tsp salt',
      steps: 'Mix everything.\nBake until golden.\nCool and slice.',
      notes: 'Best the next day.',
    });
  }
  await page.getByRole('link', { name: 'Recipes', exact: true }).click();
  await shot('02-recipes');
  await openAdd(page);
  await shot('03-add-sheet');
  await page.keyboard.press('Escape');
  await page.getByRole('link', { name: /Weeknight chili/ }).click();
  await shot('04-recipe');
  await page.getByRole('button', { name: 'Cook' }).click();
  await shot('05-cook');
  await page.goto('/household');
  await shot('06-household');
  await page.goto('/import');
  await shot('07-import');
});
