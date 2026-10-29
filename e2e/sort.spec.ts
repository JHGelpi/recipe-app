import { expect, test } from './fixtures';
import { createRecipe, SEED, session, unique } from './helpers';

// FR-49: one sort for both tabs, back to A–Z after a reload.
test('a sort picked on Recipes shows on Favorites and resets on reload', async ({ browser }) => {
  const member = await session(browser, SEED.memberA);
  // Two favorites, so the Favorites tab shows the button too.
  for (const title of [unique('Sorted soup'), unique('Sorted stew')]) {
    await createRecipe(member, { title });
    await member.getByRole('button', { name: 'Favorite', exact: true }).click();
    await expect(member.getByRole('button', { name: 'Unfavorite', exact: true })).toBeVisible();
    await member.getByRole('link', { name: 'All recipes' }).click();
  }

  await member.getByRole('button', { name: 'Sort: A–Z' }).click();
  const menu = member.getByRole('menu', { name: 'Sort recipes' });
  await expect(menu.getByRole('menuitemradio', { name: 'A–Z', checked: true })).toBeVisible();
  await menu.getByRole('menuitemradio', { name: 'Highest rated' }).click();
  await expect(menu).toBeHidden();
  await expect(member.getByRole('button', { name: 'Sort: Highest rated' })).toBeVisible();

  await member.getByLabel('Search recipes').fill('sorted');
  await expect(member.getByRole('button', { name: 'Sort: Best match' })).toBeDisabled();
  await member.getByRole('button', { name: 'Clear search text' }).click();
  await expect(member.getByRole('button', { name: 'Sort: Highest rated' })).toBeVisible();

  await member.getByRole('link', { name: 'Favorites', exact: true }).click();
  await expect(member.getByRole('button', { name: 'Sort: Highest rated' })).toBeVisible();

  await member.reload();
  await expect(member.getByRole('button', { name: 'Sort: A–Z' })).toBeVisible({
    timeout: 30_000,
  });
});
