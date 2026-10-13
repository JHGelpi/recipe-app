import { expect, test } from '@playwright/test';

test('the app opens its local database in the browser', async ({ page }) => {
  await page.goto('/');
  // The count comes from a query against the local database, so this text
  // only appears once SQLite is running in the browser.
  await expect(page.getByText('Offline · 0 unsynced')).toBeVisible({ timeout: 30_000 });
});
