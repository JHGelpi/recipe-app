import { expect, test, type Page } from './fixtures';

const LIGHT_BG = 'rgb(246, 247, 249)';
const DARK_BG = 'rgb(14, 18, 26)';

/** The page's theme as the browser sees it. */
async function look(page: Page) {
  return page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    background: getComputedStyle(document.body).backgroundColor,
    themeColor: document.querySelector('meta[name="theme-color"]')?.getAttribute('content'),
  }));
}

const LIGHT = { theme: 'light', background: LIGHT_BG, themeColor: '#F6F7F9' };
const DARK = { theme: 'dark', background: DARK_BG, themeColor: '#0E121A' };

test.describe('under a light system setting', () => {
  test.use({ colorScheme: 'light' });

  test('with nothing chosen, the page loads light (NFR-11)', async ({ page }) => {
    await page.goto('/');
    expect(await look(page)).toEqual(LIGHT);
  });
});

test.describe('under a dark system setting', () => {
  test.use({ colorScheme: 'dark' });

  test('with nothing chosen, the page loads dark (NFR-11)', async ({ page }) => {
    await page.goto('/');
    expect(await look(page)).toEqual(DARK);
  });

  test('a saved Light is painted before the app’s code runs', async ({ page, context }) => {
    await context.addInitScript(() => localStorage.setItem('dishkept.appearance', 'light'));
    // With the bundle blocked, only index.html's own script can set the theme.
    await page.route('**/_expo/static/js/**', (route) => route.abort());
    await page.goto('/');
    expect(await look(page)).toEqual(LIGHT);
  });

  test('an unknown saved value is treated as System (Review Focus 2)', async ({
    page,
    context,
  }) => {
    await context.addInitScript(() => localStorage.setItem('dishkept.appearance', 'Light'));
    await page.route('**/_expo/static/js/**', (route) => route.abort());
    await page.goto('/');
    expect(await look(page)).toEqual(DARK);
  });
});
