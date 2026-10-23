import { expect, test, type Page } from './fixtures';
import { createRecipe, fillEditor, freshEmail, openAdd, signIn, unique } from './helpers';

/** Answers the next browser dialog, and returns what it asked. */
function answerNext(page: Page, accept: boolean): Promise<string> {
  return new Promise((resolve) => {
    page.once('dialog', (dialog) => {
      resolve(dialog.message());
      void (accept ? dialog.accept() : dialog.dismiss());
    });
  });
}

test('adding a recipe by hand with a name the household has asks first; Cancel keeps the form (FR-14)', async ({
  page,
}) => {
  await signIn(page, freshEmail('duplicate-hand'));
  const title = unique("Mom's banana bread");
  await createRecipe(page, { title, servings: '8' });

  await openAdd(page);
  await page.getByRole('button', { name: 'New recipe' }).click();
  // Case and punctuation don't make it a different recipe.
  const again = `${title.toUpperCase().replace("'", '')}!`;
  await fillEditor(page, { title: again, notes: 'A second try' });
  const asked = answerNext(page, false);
  await page.getByRole('button', { name: 'Save' }).click();
  expect(await asked).toBe(`You already have “${title}” (same name). Add another?`);
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue(again);
  await expect(page.getByLabel('Notes', { exact: true })).toHaveValue('A second try');

  const accepted = answerNext(page, true);
  await page.getByRole('button', { name: 'Save' }).click();
  await accepted;
  await expect(page.getByRole('heading', { name: again, level: 1 })).toBeVisible();

  // Editing something other than the name doesn't ask again.
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Servings', { exact: true }).fill('10');
  const asks: string[] = [];
  page.on('dialog', (dialog) => {
    asks.push(dialog.message());
    void dialog.accept();
  });
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: again, level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();
  expect(asks).toEqual([]);
});

test('saving a shared recipe the household already has warns first, and can go ahead (FR-14)', async ({
  page,
  browser,
}) => {
  page.on('dialog', (dialog) => void dialog.accept());
  await signIn(page, freshEmail('duplicate-share-owner'));
  const title = unique('Lemon bars');
  const ingredients = '1 cup flour\n½ cup butter\n1 cup sugar\n2 eggs';
  await createRecipe(page, { title, ingredients });
  await page.getByRole('button', { name: 'Share' }).click();
  await page.getByRole('button', { name: 'Link' }).click();
  const url = (await page.getByLabel('Share link').textContent())!.trim();

  // Another household already wrote the same recipe down under its own name.
  const saver = await (await browser.newContext()).newPage();
  await signIn(saver, freshEmail('duplicate-share-saver'));
  const theirs = unique('Grandma squares');
  await createRecipe(saver, {
    title: theirs,
    ingredients: ingredients.split('\n').reverse().join('\n'),
  });

  await saver.goto(url);
  await saver.getByRole('button', { name: 'Save to my recipes' }).click();
  const warning = saver.getByRole('alert').filter({ hasText: 'You already have' });
  await expect(warning).toHaveText(
    new RegExp(`You already have “${theirs}” \\(same ingredients\\)\\.`),
  );

  // Cancel saves nothing; Open it goes to the household's own recipe.
  await warning.getByRole('button', { name: 'Cancel' }).click();
  await expect(warning).toHaveCount(0);
  await saver.getByRole('button', { name: 'Save to my recipes' }).click();
  await warning.getByRole('button', { name: 'Open it' }).click();
  await expect(saver.getByRole('heading', { name: theirs, level: 1 })).toBeVisible();

  await saver.goto(url);
  await saver.getByRole('button', { name: 'Save to my recipes' }).click();
  await warning.getByRole('button', { name: 'Save anyway' }).click();
  await expect(saver.getByText('Saved to your recipes')).toBeVisible({ timeout: 30_000 });
  await expect(saver.getByRole('heading', { name: title, level: 1 })).toBeVisible();
  await saver.context().close();
});
