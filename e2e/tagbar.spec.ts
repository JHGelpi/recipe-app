// e2e/tagbar.spec.ts
import { expect, test } from './fixtures';
import { createRecipe, freshEmail, signIn, unique } from './helpers';

const many = Array.from({ length: 14 }, (_, i) => `tagnumber${i}`).join(', ');
const scroller = (page: import('@playwright/test').Page) =>
  page.getByRole('group', { name: 'Tags' }).locator('div').first();

test.use({ viewport: { width: 390, height: 800 } });

test('the tag bar scrolls with › and ‹ to the last tag @firefox', async ({ page }) => {
  await signIn(page, freshEmail('tagbar'));
  await createRecipe(page, { title: unique('Tag bar'), tags: many });
  await page.goto('/');
  const last = page.getByRole('button', { name: 'Tag tagnumber9', exact: true });
  await expect(page.getByRole('button', { name: 'Scroll tags left' })).toHaveCount(0);
  await expect(last).not.toBeInViewport();
  const right = page.getByRole('button', { name: 'Scroll tags right' });
  // The buttons appear once the bar has measured itself.
  await expect(right).toBeVisible();
  // Press › until the end is reached and the button goes away.
  for (let i = 0; i < 8 && (await right.count()) > 0; i++) {
    await right.click();
    await page.waitForTimeout(300);
  }
  await expect(right).toHaveCount(0);
  // Tags sort as text, so tagnumber9 is the last chip.
  await expect(last).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Scroll tags left' })).toBeVisible();
});

test('a mouse wheel over the tag bar scrolls it sideways @firefox', async ({ page }) => {
  await signIn(page, freshEmail('tagwheel'));
  await createRecipe(page, { title: unique('Tag wheel'), tags: many });
  await page.goto('/');
  const first = page.getByRole('button', { name: 'Tag tagnumber0', exact: true });
  const box = (await first.boundingBox())!;
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.wheel(0, 400);
  await expect
    .poll(() => scroller(page).evaluate((node) => node.scrollLeft))
    .toBeGreaterThan(100);
});

test('few tags: no scroll buttons', async ({ page }) => {
  await signIn(page, freshEmail('tagfew'));
  await createRecipe(page, { title: unique('Two tags'), tags: 'quick, dinner' });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Tag quick', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Scroll tags/ })).toHaveCount(0);
});

test('selecting a tag keeps the buttons right', async ({ page }) => {
  await signIn(page, freshEmail('tagselect'));
  await createRecipe(page, { title: unique('Tag select'), tags: many });
  await page.goto('/');
  await page.getByRole('button', { name: 'Scroll tags right' }).click();
  await page.getByRole('button', { name: 'Tag tagnumber3', exact: true }).click();
  // The selected chip moves first; the bar may jump back to the start.
  await expect(page.getByRole('button', { name: 'Scroll tags right' })).toBeVisible();
});
