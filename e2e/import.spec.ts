import { expect, test, type Page } from './fixtures';
import { findRecipe, freshEmail, openAdd, SEED, signIn, unique } from './helpers';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

async function openImport(page: Page): Promise<void> {
  await openAdd(page);
  await page.getByRole('button', { name: /^Import/ }).click();
  await expect(page.getByRole('heading', { name: 'Import a recipe' })).toBeVisible();
}

async function pasteText(page: Page, text: string): Promise<void> {
  await page.getByRole('tab', { name: 'Paste text' }).click();
  await page.getByLabel('Recipe text').fill(text);
  await page.getByRole('button', { name: 'Import recipe' }).click();
}

async function pasteLink(page: Page, url: string): Promise<void> {
  await page.getByRole('tab', { name: 'Paste link' }).click();
  await page.getByLabel('Recipe link').fill(url);
  await page.getByRole('button', { name: 'Import recipe' }).click();
}

const ready = (page: Page) =>
  expect(page.getByText('Ready to review')).toBeVisible({ timeout: 30_000 });

test('pasted text becomes a reviewed recipe that keeps its original (FR-9, FR-11, FR-12)', async ({
  page,
}) => {
  await signIn(page, freshEmail('import-text'));
  const title = unique('Imported soup');
  await openImport(page);
  await pasteText(page, `${title}\n- 1 onion\n- 2 carrots\n1. Chop.\n2. Simmer.\nFAKE_SLOW`);
  await expect(page.getByText('Reading…')).toBeVisible();
  await ready(page);
  await expect(page.getByText(/AI this month: \$0\.01 of \$2\.00/)).toBeVisible();
  await page.getByRole('button', { name: 'Review' }).click();

  await expect(page.getByRole('heading', { name: 'Review import' })).toBeVisible();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue(title);
  await expect(page.getByText('Check this')).toHaveCount(1);
  await page.getByLabel('Servings').fill('6');
  await expect(page.getByText('Check this')).toHaveCount(0);
  await expect(page.getByLabel('Tags')).toHaveValue('fake-suggested');
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
  await expect(page.getByText('Serves 6', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Original text/ }).click();
  await expect(page.getByText('- 2 carrots', { exact: false })).toBeVisible();

  await page.getByRole('link', { name: 'All recipes' }).click();
  await expect(await findRecipe(page, title)).toBeVisible();
});

test('a link with recipe data becomes a recipe that shows its site and author (FR-8, NFR-13)', async ({
  page,
}) => {
  await signIn(page, freshEmail('import-link'));
  await openImport(page);
  await pasteLink(page, `http://fake-ai:4010/pages/jsonld.html?t=${Date.now()}`);
  await ready(page);
  await page.getByRole('button', { name: 'Review' }).click();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Fixture Lasagna');
  await expect(page.getByText('Check this')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'Fixture Lasagna', level: 1 })).toBeVisible();
  await expect(page.getByText('From fake-ai · by Fixture Cook')).toBeVisible();
});

test('an import made offline waits, then is read once online (FR-29)', async ({
  page,
  context,
}) => {
  await signIn(page, freshEmail('import-offline'));
  await openImport(page);
  await context.setOffline(true);
  await pasteText(page, `${unique('Offline stew')}\n- 1 potato`);
  await expect(page.getByText("Saved. It'll be read when you're back online.")).toBeVisible();
  await expect(page.getByText('Waiting to go online')).toBeVisible();
  await context.setOffline(false);
  await ready(page);
});

test('a failed import can be tried again (FR-29)', async ({ page }) => {
  await signIn(page, freshEmail('import-retry'));
  await openImport(page);
  await pasteText(page, `${unique('Flaky pie')}\n- 1 crust\nFAKE_FAIL_TWICE_${Date.now()}`);
  await expect(page.getByText("Couldn't reach the AI service")).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Try again' }).click();
  await ready(page);
});

test('a paste over 20,000 characters is explained, not sent', async ({ page }) => {
  await signIn(page, freshEmail('import-long'));
  await openImport(page);
  await pasteText(page, 'x'.repeat(20_001));
  await expect(page.getByText('At most 20,000 characters')).toBeVisible();
  await expect(page.getByText('Reading…')).toHaveCount(0);
});

test('dismissing an import removes it', async ({ page }) => {
  await signIn(page, freshEmail('import-dismiss'));
  await openImport(page);
  const title = unique('Unwanted');
  await pasteText(page, `${title}\nFAKE_NOT_RECIPE`);
  await expect(page.getByText("This doesn't look like a recipe")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.getByText(title)).toHaveCount(0);
});

test('viewers have no Import button (rule 4)', async ({ page }) => {
  await signIn(page, SEED.viewerA);
  await expect(page.getByRole('button', { name: /^Import/ })).toHaveCount(0);
});
