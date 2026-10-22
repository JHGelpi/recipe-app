import { expect, test, type Page } from './fixtures';
import { createRecipe, findRecipe, SEED, session, unique } from './helpers';

const PHOTOS = 'test-support/photos';
const NFR5_MS = 10_000;

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

async function choose(page: Page, button: string, files: string[]): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: button }).click();
  await (await chooser).setFiles(files.map((name) => `${PHOTOS}/${name}`));
}

const pad = (n: number) => String(n).padStart(2, '0');
const day = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

test('one tap logs a meal; notes, date and photos are added after; the household sees it (FR-37–FR-41)', async ({
  browser,
}) => {
  const member = await session(browser, SEED.memberA);
  member.on('dialog', (dialog) => void dialog.accept());
  const admin = await session(browser, SEED.adminA);
  const title = unique('Logged chili');
  await createRecipe(member, { title, steps: 'Simmer' });

  await member.getByRole('button', { name: 'I cooked this' }).click();
  await expect(member.getByText('Logged in your cook diary')).toBeVisible();
  await expect(member.getByText(/^Cooked once · last on /)).toBeVisible();

  await member.getByRole('button', { name: 'Add notes or photos' }).click();
  await expect(member.getByRole('heading', { name: title, level: 1 })).toBeVisible();
  await member.getByLabel('Notes', { exact: true }).fill('Used thighs, kids loved it');
  await member.getByRole('button', { name: 'Save notes' }).click();
  await expect(member.getByText('Saved', { exact: true })).toBeVisible();
  await member.getByRole('button', { name: 'Yesterday' }).click();
  await expect(member.getByLabel('Cooked on (YYYY-MM-DD)')).toHaveValue(
    day(new Date(Date.now() - 86_400_000)),
  );
  await member.getByLabel('Cooked on (YYYY-MM-DD)').fill('2999-01-01');
  await member.getByRole('button', { name: 'Save date' }).click();
  await expect(member.getByText('The date can’t be in the future')).toBeVisible();

  await choose(member, 'Add photos', ['dish.jpg', 'page-1.jpg']);
  await expect(member.getByRole('link', { name: 'Photo 2 of 2' })).toBeVisible();
  await member.getByRole('link', { name: 'Photo 1 of 2' }).click();
  await expect(member.getByText('1 of 2', { exact: true })).toBeVisible();
  await member.getByRole('button', { name: 'Next' }).click();
  await expect(member.getByText('2 of 2', { exact: true })).toBeVisible();
  await member.getByRole('button', { name: 'Back' }).click();

  // The diary, newest first, with the notes' start; and on another member's phone.
  await member.goto('/diary');
  await expect(member.getByText('Used thighs, kids loved it')).toBeVisible();
  await admin.goto('/diary');
  await expect(admin.getByRole('link', { name: title })).toBeVisible({ timeout: NFR5_MS });
  await admin.getByRole('link', { name: title }).click();
  await expect(admin.getByLabel('Notes', { exact: true })).toHaveValue(
    'Used thighs, kids loved it',
  );
});

test('a viewer reads the diary but cannot log or edit (rule 4)', async ({ browser }) => {
  const member = await session(browser, SEED.memberA);
  const viewer = await session(browser, SEED.viewerA);
  const title = unique('Viewer soup');
  await createRecipe(member, { title });
  await member.getByRole('button', { name: 'I cooked this' }).click();
  await expect(member.getByText('Logged in your cook diary')).toBeVisible();

  await (await findRecipe(viewer, title)).click({ timeout: NFR5_MS });
  await expect(viewer.getByText(/^Cooked once · last on /)).toBeVisible({ timeout: NFR5_MS });
  await expect(viewer.getByRole('button', { name: 'I cooked this' })).toHaveCount(0);
  await viewer.getByText(/^Cooked once · last on /).click();
  await viewer.getByRole('link', { name: title }).click();
  await expect(viewer.getByRole('heading', { name: title, level: 1 })).toBeVisible();
  await expect(viewer.getByRole('button', { name: 'Move to Trash' })).toHaveCount(0);
  await expect(viewer.getByRole('button', { name: 'Add photos' })).toHaveCount(0);
  await expect(viewer.getByLabel('Notes', { exact: true })).toHaveCount(0);
});

test('a trashed entry leaves the diary and is restored from the Trash; trashing the recipe keeps it (FR-18)', async ({
  browser,
}) => {
  const member = await session(browser, SEED.memberA);
  member.on('dialog', (dialog) => void dialog.accept());
  const title = unique('Trashed stew');
  await createRecipe(member, { title });
  await member.getByRole('button', { name: 'I cooked this' }).click();
  await member.getByRole('button', { name: 'Add notes or photos' }).click();
  await member.getByRole('button', { name: 'Move to Trash' }).click();
  await expect(member.getByRole('heading', { name: 'Cook diary' })).toBeVisible();
  await expect(member.getByRole('link', { name: title })).toHaveCount(0);

  await member.goto('/trash');
  const restore = member.getByRole('button', { name: `Restore diary entry ${title}` });
  await restore.click();
  await expect(restore).toHaveCount(0);
  await member.goto('/diary');
  await expect(member.getByRole('link', { name: title })).toBeVisible();

  // Trashing the recipe leaves its diary entry where it is.
  await member.goto('/');
  await (await findRecipe(member, title)).click();
  await member.getByRole('button', { name: 'More' }).click();
  await member.getByRole('button', { name: 'Move to Trash' }).click();
  await expect(member.getByRole('heading', { name: 'Recipes' })).toBeVisible();
  await member.goto('/diary');
  await expect(member.getByRole('link', { name: title })).toBeVisible();
});

test('the last step of cook mode offers I cooked this (FR-37)', async ({ browser }) => {
  const member = await session(browser, SEED.memberA);
  const title = unique('Cook mode pie');
  await createRecipe(member, { title, steps: 'Mix\nBake' });
  await member.getByRole('button', { name: 'Cook', exact: true }).click();
  await expect(member.getByRole('button', { name: 'I cooked this' })).toHaveCount(0);
  await member.getByRole('button', { name: 'Next' }).click();
  await member.getByRole('button', { name: 'I cooked this' }).click();
  await expect(member.getByText('Logged in your cook diary')).toBeVisible();
  await member.getByRole('button', { name: 'Done' }).click();
  await expect(member.getByText(/^Cooked once · last on /)).toBeVisible();
});

test('a meal logged offline, with notes, reaches the household once back online (FR-28)', async ({
  browser,
}) => {
  const member = await session(browser, SEED.memberA);
  const admin = await session(browser, SEED.adminA);
  const title = unique('Offline curry');
  await createRecipe(member, { title });
  await member.context().setOffline(true);
  await member.getByRole('button', { name: 'I cooked this' }).click();
  await member.getByRole('button', { name: 'Add notes or photos' }).click();
  await member.getByLabel('Notes', { exact: true }).fill('Made in the cabin');
  await member.getByRole('button', { name: 'Save notes' }).click();
  await expect(member.getByText('Saved', { exact: true })).toBeVisible();
  await member.context().setOffline(false);

  await admin.goto('/diary');
  await expect(admin.getByText('Made in the cabin')).toBeVisible({ timeout: NFR5_MS });
});
