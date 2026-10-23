import { expect, test, type Page } from './fixtures';
import { createRecipe, findRecipe, SEED, session, unique } from './helpers';

const badge = (page: Page) => page.getByRole('button', { name: /^Rating:/ });
const star = (page: Page, n: number) =>
  page.getByRole('button', { name: n === 1 ? 'Rate 1 star' : `Rate ${n} stars`, exact: true });

test('each person rates; everyone sees only the average and count (FR-44)', async ({ browser }) => {
  const member = await session(browser, SEED.memberA);
  const viewer = await session(browser, SEED.viewerA);
  const title = unique('Rated chili');
  await createRecipe(member, { title });

  await expect(badge(member)).toHaveAccessibleName('Rating: Not rated yet. Rate this recipe');
  await badge(member).click();
  await expect(member.getByText('Not rated yet.')).toBeVisible();
  await star(member, 5).click();
  await expect(star(member, 5)).toHaveAttribute('aria-pressed', 'true');
  await expect(member.getByRole('group', { name: 'Your rating: 5 of 5 stars' })).toBeVisible();
  // The average is the server's count, so it arrives after the upload.
  await expect(member.getByText('5.0 · 1 rating', { exact: false })).toBeVisible({
    timeout: 15_000,
  });

  // A Viewer rates too, and sees no one else's stars, only the average.
  await (await findRecipe(viewer, title)).click({ timeout: 30_000 });
  await expect(badge(viewer)).toContainText('5.0', { timeout: 15_000 });
  await badge(viewer).click();
  await expect(viewer.getByRole('group', { name: 'Your rating: none' })).toBeVisible();
  await star(viewer, 4).click();
  await expect(viewer.getByText('4.5 · 2 ratings', { exact: false })).toBeVisible({
    timeout: 15_000,
  });
  await expect(badge(member)).toContainText('4.5', { timeout: 15_000 });

  // Tapping your current rating clears it.
  await star(viewer, 4).click();
  await expect(viewer.getByRole('group', { name: 'Your rating: none' })).toBeVisible();
  await expect(viewer.getByText('5.0 · 1 rating', { exact: false })).toBeVisible({
    timeout: 15_000,
  });
});

test('the heart is the favorite, and a recipe in the Trash shows its rating read-only', async ({
  browser,
}) => {
  const member = await session(browser, SEED.memberA);
  const title = unique('Trashed rated tart');
  await createRecipe(member, { title });
  const path = new URL(member.url()).pathname;
  await expect(member.getByRole('button', { name: 'Favorite', exact: true })).toBeVisible();

  await badge(member).click();
  await star(member, 3).click();
  await expect(badge(member)).toContainText('3.0', { timeout: 15_000 });

  member.once('dialog', (dialog) => void dialog.accept());
  await member.getByRole('button', { name: 'More', exact: true }).click();
  await member.getByRole('button', { name: 'Move to Trash' }).click();
  await expect(member.getByRole('heading', { name: 'Recipes', level: 1 })).toBeVisible();
  await member.goto(path);
  await expect(member.getByText('This recipe is in the Trash')).toBeVisible();
  await expect(
    member.getByRole('img', { name: 'Rating: Average 3.0 from 1 rating' }),
  ).toBeVisible();
  await expect(badge(member)).toHaveCount(0);
  await expect(star(member, 1)).toHaveCount(0);
});
