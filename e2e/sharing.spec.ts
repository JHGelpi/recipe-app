import { expect, test } from './fixtures';
import {
  createRecipe,
  freshEmail,
  requestCode,
  SEED,
  signIn,
  unique,
  waitForServiceWorker,
} from './helpers';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

async function soup(page: import('@playwright/test').Page, title: string) {
  await createRecipe(page, {
    title,
    servings: '4',
    ingredients: '2 cups stock\n⅓ cup cream',
    steps: 'Simmer.\nServe.',
  });
}

test('share as text copies the recipe, and PDF downloads "<Title>.pdf" (FR-26)', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await signIn(page, freshEmail('share-text'));
  const title = unique('Share soup');
  await soup(page, title);
  await page.getByRole('button', { name: 'Share' }).click();
  await page.getByRole('button', { name: 'Text' }).click();
  await expect(page.getByText('Copied')).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain(`${title}\nServes 4`);
  expect(copied).toContain('• ⅓ cup cream');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PDF' }).click();
  expect((await download).suggestedFilename()).toBe(`${title}.pdf`);
});

test('a link shows the recipe signed out, and saves a copy after sign-in (FR-27)', async ({
  page,
  browser,
}) => {
  const owner = freshEmail('share-owner');
  await signIn(page, owner);
  const title = unique('Linked soup');
  await soup(page, title);
  await page.getByRole('button', { name: 'Share' }).click();
  await page.getByRole('button', { name: 'Link' }).click();
  const url = (await page.getByLabel('Share link').textContent())!.trim();

  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(url);
  await expect(visitor.getByRole('heading', { name: title })).toBeVisible();
  // Nothing on the public page comes from the sender's email (#66).
  await expect(visitor.getByText('Shared from another Dishkept household')).toBeVisible();
  await expect(visitor.getByText(owner.split('@')[0]!, { exact: false })).toHaveCount(0);
  await visitor.getByRole('button', { name: 'Save to my recipes' }).click();
  await expect(visitor.getByText(`Sign in or create an account to save ${title}`)).toBeVisible();
  // Not signIn(): after sign-in the visitor lands back on the shared page, not the list.
  await visitor.getByLabel('Code').fill(await requestCode(visitor, freshEmail('share-saver')));
  await visitor.getByRole('button', { name: 'Sign in' }).click();
  await expect(visitor.getByRole('heading', { name: title })).toBeVisible();
  await visitor.getByRole('button', { name: 'Save to my recipes' }).click();
  await expect(visitor.getByText('Saved to your recipes')).toBeVisible({ timeout: 30_000 });
  await expect(visitor.getByRole('heading', { name: title, level: 1 })).toBeVisible();
  // The copy keeps where it came from as its original text (FR-12).
  await visitor.getByRole('button', { name: 'Original text ▸' }).click();
  await expect(visitor.getByText('Shared by another Dishkept household')).toBeVisible();

  await page.getByRole('button', { name: 'Stop sharing' }).click();
  await visitor.goto(url);
  await expect(visitor.getByText('This recipe is no longer shared')).toBeVisible();
  await visitor.context().close();
});

test('a viewer can share a link but cannot save one (rule 4)', async ({ page, browser }) => {
  await signIn(page, freshEmail('share-for-viewer'));
  const title = unique('Viewer soup');
  await soup(page, title);
  await page.getByRole('button', { name: 'Share' }).click();
  await page.getByRole('button', { name: 'Link' }).click();
  const url = (await page.getByLabel('Share link').textContent())!.trim();

  const viewer = await (await browser.newContext()).newPage();
  await signIn(viewer, SEED.viewerA);
  await viewer.goto(url);
  await viewer.getByRole('button', { name: 'Save to my recipes' }).click();
  await expect(
    viewer.getByText("Viewers can't add recipes. Ask an admin of your household."),
  ).toBeVisible();
  await viewer.context().close();
});

test('a link to a trashed recipe is no longer shared', async ({ page, browser }) => {
  await signIn(page, freshEmail('share-trash'));
  const title = unique('Trashed soup');
  await soup(page, title);
  await page.getByRole('button', { name: 'Share' }).click();
  await page.getByRole('button', { name: 'Link' }).click();
  const url = (await page.getByLabel('Share link').textContent())!.trim();
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('button', { name: 'Move to Trash' }).click();
  // The trash is saved on the phone first; the link changes once it uploads.
  await expect(page.getByText('Online · 0 unsynced')).toBeVisible({ timeout: 30_000 });
  const visitor = await (await browser.newContext()).newPage();
  await expect(async () => {
    await visitor.goto(url);
    await expect(visitor.getByText('This recipe is no longer shared')).toBeVisible({
      timeout: 3_000,
    });
  }).toPass({ timeout: 30_000 });
  await visitor.context().close();
});

test('the sharing household sees "already in your household" and no Save (Review Focus 5)', async ({
  page,
}) => {
  await signIn(page, freshEmail('share-own'));
  const title = unique('Own soup');
  await soup(page, title);
  await page.getByRole('button', { name: 'Share' }).click();
  await page.getByRole('button', { name: 'Link' }).click();
  const url = (await page.getByLabel('Share link').textContent())!.trim();
  await page.goto(url);
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.getByText('This recipe is already in your household')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save to my recipes' })).toHaveCount(0);
});

test('offline, the shared page says so and loads when the connection returns (Final 7, 8)', async ({
  page,
  browser,
}) => {
  await signIn(page, freshEmail('share-net'));
  const title = unique('Net soup');
  await soup(page, title);
  await page.getByRole('button', { name: 'Share' }).click();
  await page.getByRole('button', { name: 'Link' }).click();
  const url = (await page.getByLabel('Share link').textContent())!.trim();

  const context = await browser.newContext();
  const visitor = await context.newPage();
  await signIn(visitor, freshEmail('share-net-visitor'));
  await visitor.goto(url);
  await expect(visitor.getByRole('heading', { name: title })).toBeVisible();
  // A save waiting from before sign-in, then the connection drops.
  const code = url.split('/s/')[1]!;
  await visitor.evaluate(
    ([c, t]) =>
      sessionStorage.setItem('recipes.pendingShare', JSON.stringify({ code: c, title: t })),
    [code, title],
  );
  await waitForServiceWorker(visitor);
  await context.setOffline(true);
  // Not reloadOffline(): its brief online blip would let the page take the entry itself.
  await visitor.reload();
  await expect(visitor.getByText('Opening a shared recipe needs a connection')).toBeVisible();
  // Taken even offline, so the list is not sent back here (Final 8).
  expect(await visitor.evaluate(() => sessionStorage.getItem('recipes.pendingShare'))).toBeNull();
  await context.setOffline(false);
  await expect(visitor.getByRole('heading', { name: title })).toBeVisible({ timeout: 15_000 });
  await context.close();
});

test('a link made right after adding a dish photo shows it signed out, and Link again gives the same link (FR-27)', async ({
  page,
  browser,
}) => {
  await signIn(page, freshEmail('share-photo'));
  const title = unique('Photo soup');
  await soup(page, title);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add photo' }).click();
  await (await chooser).setFiles('test-support/photos/dish.jpg');
  await page.getByRole('button', { name: 'Share' }).click();
  await page.getByRole('button', { name: 'Link' }).click();
  const link = page.getByLabel('Share link');
  await expect(link).toBeVisible({ timeout: 60_000 });
  const url = (await link.textContent())!.trim();
  await page.getByRole('button', { name: 'Link' }).click();
  await expect(page.getByText('Copied').or(link)).toBeVisible();
  expect((await link.textContent())!.trim()).toBe(url);

  const visitor = await (await browser.newContext()).newPage();
  const photo = visitor.waitForResponse(
    (response) => response.url().endsWith('/photo') && response.status() === 200,
  );
  await visitor.goto(url);
  await expect(visitor.getByRole('heading', { name: title, level: 1 })).toBeVisible();
  await photo;
  await visitor.context().close();
});
