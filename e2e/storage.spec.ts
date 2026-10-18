import { expect, test } from './fixtures';
import { addRecipe, findRecipe, freshEmail, signIn } from './helpers';

const CANNOT_STORE =
  "This browser can't store recipes on this device. Private browsing isn't supported.";

test('the local database is stored in OPFS', async ({ page }) => {
  await signIn(page, freshEmail('opfs'));
  await addRecipe(page, 'Stored soup');
  const names = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const found: string[] = [];
    // keys() is an async iterator; the DOM typings in this project lack it.
    for await (const name of (root as unknown as { keys(): AsyncIterable<string> }).keys()) {
      found.push(name);
    }
    return found;
  });
  expect(names.some((name) => name.includes('recipes.db'))).toBe(true);
});

test('two tabs of the app share the database', async ({ context }) => {
  const first = await context.newPage();
  await signIn(first, freshEmail('tabs'));
  await addRecipe(first, 'First tab tart');

  const second = await context.newPage();
  await second.goto('/');
  await expect(await findRecipe(second, 'First tab tart')).toBeVisible({
    timeout: 30_000,
  });
  await addRecipe(second, 'Second tab tart');
  await expect(await findRecipe(first, 'Second tab tart')).toBeVisible({
    timeout: 30_000,
  });
});

test('a browser that cannot open the local database shows a message', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  // Serve the real worker with OPFS refused, as Safari private browsing does.
  // (A worker that fails to load is different: the SDK's calls to it hang.)
  const refuseOpfs =
    "Object.defineProperty(StorageManager.prototype, 'getDirectory', { value: () => " +
    "Promise.reject(new DOMException('The operation is insecure.', 'SecurityError')) });\n";
  await context.route('**/@powersync/worker.js', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: refuseOpfs + (await response.text()) });
  });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.getByText(CANNOT_STORE)).toBeVisible({ timeout: 30_000 });
  await context.close();
});
