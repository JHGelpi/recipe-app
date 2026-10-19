import { expect, test, type Page } from './fixtures';
import {
  openAdd,
  addRecipe,
  findRecipe,
  freshEmail,
  reloadOffline,
  SEED,
  session,
  signIn,
  unique,
  waitForServiceWorker,
} from './helpers';

const PHOTOS = 'test-support/photos';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

async function choose(page: Page, button: string, files: string[]): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: button }).click();
  await (await chooser).setFiles(files.map((name) => `${PHOTOS}/${name}`));
}

async function photoTab(page: Page): Promise<void> {
  await openAdd(page);
  await page.getByRole('button', { name: /^Import/ }).click();
  await page.getByRole('tab', { name: 'Photo' }).click();
}

const ready = (page: Page) =>
  expect(page.getByText('Ready to review')).toBeVisible({ timeout: 30_000 });

/** A photo actually shown, not its grey placeholder. */
const shown = (page: Page, name: string) =>
  page.getByTestId('photo-shown').and(page.getByRole('img', { name, exact: true }));

test('photographed pages become a recipe with its originals and a dish photo (FR-7, FR-12, FR-15)', async ({
  page,
}) => {
  await signIn(page, freshEmail('photo-import'));
  await photoTab(page);
  await choose(page, 'Add page', ['page-2.jpg', 'page-1.jpg']);
  await expect(page.getByRole('img', { name: /^Page \d$/ })).toHaveCount(2);
  await page.getByRole('button', { name: 'Move page 2 left' }).click();
  await page.getByRole('button', { name: 'Import recipe' }).click();
  await expect(page.getByText('Photo · 2 pages')).toBeVisible();
  await ready(page);
  await page.getByRole('button', { name: 'Review' }).click();

  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Photo Fixture Bread');
  await page.getByRole('checkbox', { name: 'Use page 1 as the dish photo' }).click();
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByRole('heading', { name: 'Photo Fixture Bread', level: 1 })).toBeVisible();
  await expect(shown(page, 'Dish photo')).toBeVisible();
  await expect(page.getByText('From photos · 2 pages')).toBeVisible();
  await page.getByRole('link', { name: 'Page 2' }).click();
  await expect(shown(page, 'Photo')).toBeVisible();
  await page.goBack();
  await page.getByRole('link', { name: 'All recipes' }).click();
  await expect(await findRecipe(page, 'Photo Fixture Bread')).toBeVisible();
  await expect(shown(page, 'Photo of Photo Fixture Bread')).toBeVisible();
});

test('a full-size photo is resized on the phone and read (Review Focus 1)', async ({ page }) => {
  await signIn(page, freshEmail('photo-big'));
  await photoTab(page);
  await choose(page, 'Add page', ['big-page.jpg']);
  // Resizing a full-size photo takes a moment; Import needs the page added.
  await expect(page.getByRole('img', { name: 'Page 1' })).toBeVisible();
  await page.getByRole('button', { name: 'Import recipe' }).click();
  await ready(page);
  await page.getByRole('button', { name: 'Review' }).click();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Big Card Soup');
});

test('pages added offline upload and are read once online (FR-29)', async ({ page, context }) => {
  await signIn(page, freshEmail('photo-offline'));
  await photoTab(page);
  await context.setOffline(true);
  await choose(page, 'Add page', ['page-1.jpg']);
  await expect(page.getByRole('img', { name: 'Page 1' })).toBeVisible();
  await page.getByRole('button', { name: 'Import recipe' }).click();
  await expect(page.getByText("Saved. It'll be read when you're back online.")).toBeVisible();
  await expect(page.getByText('Waiting to go online')).toBeVisible();
  await context.setOffline(false);
  await ready(page);
});

test('a dish photo can be added, changed and removed, and shows offline on another device (FR-15)', async ({
  page,
  browser,
}) => {
  const email = freshEmail('photo-dish');
  await signIn(page, email);
  const title = unique('Dish soup');
  await addRecipe(page, title);
  await (await findRecipe(page, title)).click();
  await choose(page, 'Add photo', ['dish.jpg']);
  await expect(shown(page, 'Dish photo')).toBeVisible();
  await choose(page, 'Change photo', ['page-1.jpg']);
  await expect(shown(page, 'Dish photo')).toBeVisible();

  const other = await session(browser, email);
  await waitForServiceWorker(other);
  await (await findRecipe(other, title)).click();
  await expect(shown(other, 'Dish photo')).toBeVisible({ timeout: 30_000 });
  await other.context().setOffline(true);
  await reloadOffline(other);
  // Shown offline: the dish photo was downloaded to this device, not cached from a page view.
  await expect(shown(other, 'Dish photo')).toBeVisible();
  await other.context().close();

  await page.getByRole('button', { name: 'Remove photo' }).click();
  await expect(page.getByRole('img', { name: 'Dish photo' })).toHaveCount(0);
});

test('viewers have no photo controls (rule 4)', async ({ page }) => {
  await signIn(page, SEED.viewerA);
  await (await findRecipe(page, 'Seed pancakes')).click();
  await expect(page.getByRole('button', { name: 'Add photo' })).toHaveCount(0);
});

test('signing out leaves no photo in the browser (Review Focus 4)', async ({ page }) => {
  await signIn(page, freshEmail('photo-signout'));
  const title = unique('Private pie');
  await addRecipe(page, title);
  await (await findRecipe(page, title)).click();
  await choose(page, 'Add photo', ['dish.jpg']);
  await expect(shown(page, 'Dish photo')).toBeVisible();
  await page.getByRole('link', { name: 'All recipes' }).click();
  await page.getByRole('link', { name: 'Household' }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
  // The wipe runs just after the sign-in screen appears; wait for it.
  const left = () =>
    page.evaluate(async () => {
      const names = (await indexedDB.databases())
        .map((db) => db.name ?? '')
        .filter((name) => name.includes('recipe-photos'));
      let count = 0;
      for (const name of names) {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open(name);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        for (const store of db.objectStoreNames) {
          count += await new Promise<number>((resolve) => {
            const request = db.transaction(store).objectStore(store).count();
            request.onsuccess = () => resolve(request.result);
          });
        }
        db.close();
      }
      const cached = (await caches.keys()).includes('photo-pages');
      return { count, cached };
    });
  await expect.poll(left, { timeout: 15_000 }).toEqual({ count: 0, cached: false });
});

test('a shown dish photo stays shown while the network drops and returns (final review)', async ({
  page,
}) => {
  await signIn(page, freshEmail('photo-flip'));
  const title = unique('Flip soup');
  await addRecipe(page, title);
  await (await findRecipe(page, title)).click();
  await choose(page, 'Add photo', ['dish.jpg']);
  await expect(shown(page, 'Dish photo')).toBeVisible();
  // Record any moment the grey placeholder replaces the photo.
  await page.evaluate(() => {
    const flag = window as unknown as { blanked: boolean };
    flag.blanked = false;
    new MutationObserver(() => {
      if (document.querySelector('[data-testid="photo-placeholder"]')) flag.blanked = true;
    }).observe(document.body, { subtree: true, childList: true, attributes: true });
  });
  await page.context().setOffline(true);
  await page.waitForTimeout(1500);
  await page.context().setOffline(false);
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => (window as unknown as { blanked: boolean }).blanked)).toBe(
    false,
  );
  await expect(shown(page, 'Dish photo')).toBeVisible();
});
