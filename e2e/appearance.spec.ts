import { expect, test, type Page } from './fixtures';
import { createRecipe, freshEmail, settingSaved, settled, signIn, unique } from './helpers';

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

  test('with storage blocked, the page still follows the system (final review 2)', async ({
    page,
    context,
  }) => {
    await context.addInitScript(() =>
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new DOMException('Blocked', 'SecurityError');
        },
      }),
    );
    await page.route('**/_expo/static/js/**', (route) => route.abort());
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

  // A saved session and the person's cached settings, as the app leaves them (ADR-0031).
  const signedInAs = (cached: { owner: string; appearance: string }) => {
    localStorage.setItem('supabase.auth.token', JSON.stringify({ user: { id: 'ann' } }));
    localStorage.setItem(
      'dishkept.personSettings',
      JSON.stringify({ userId: cached.owner, units: 'as_written', appearance: cached.appearance }),
    );
  };

  test('the person’s cached Light is painted before the app’s code runs', async ({
    page,
    context,
  }) => {
    await context.addInitScript(signedInAs, { owner: 'ann', appearance: 'light' });
    // With the bundle blocked, only index.html's own script can set the theme.
    await page.route('**/_expo/static/js/**', (route) => route.abort());
    await page.goto('/');
    expect(await look(page)).toEqual(LIGHT);
  });

  test('someone else’s cached choice, an unknown value, or the old device setting is System (Review Focus 2)', async ({
    page,
    context,
  }) => {
    await page.route('**/_expo/static/js/**', (route) => route.abort());
    await context.addInitScript(signedInAs, { owner: 'bob', appearance: 'light' });
    await page.goto('/');
    expect(await look(page)).toEqual(DARK);
    await context.addInitScript(signedInAs, { owner: 'ann', appearance: 'Light' });
    await page.reload();
    expect(await look(page)).toEqual(DARK);
    await context.addInitScript(() => {
      localStorage.removeItem('dishkept.personSettings');
      localStorage.setItem('dishkept.appearance', 'light');
    });
    await page.reload();
    expect(await look(page)).toEqual(DARK);
  });
});

/** The app's own colors resolve through the installed variables. */
async function cssBg(page: Page) {
  return page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
  );
}

async function openAppearance(page: Page) {
  await page.getByRole('link', { name: 'Household' }).click();
  await expect(page.getByText('Appearance')).toBeVisible();
  await settled(page);
}

test.describe('the Appearance setting', () => {
  test.use({ colorScheme: 'light' });

  test('Dark follows the person: kept after a reload, System when signed out, back on sign-in and on another device (NFR-11, ADR-0031)', async ({
    page,
    browser,
  }) => {
    const email = freshEmail('appearance');
    // A device setting from before is not carried over.
    await page.addInitScript(() => localStorage.setItem('dishkept.appearance', 'dark'));
    await signIn(page, email);
    await openAppearance(page);
    await expect(page.getByRole('tab', { name: 'System' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(await cssBg(page)).toBe('#F6F7F9');

    await page.getByRole('tab', { name: 'Dark' }).click();
    await expect.poll(() => look(page)).toEqual(DARK);
    expect(await cssBg(page)).toBe('#0E121A');
    await settingSaved(page, 'appearance', 'dark');

    await page.reload();
    await expect(page.getByRole('tab', { name: 'Dark' })).toHaveAttribute('aria-selected', 'true');
    expect(await look(page)).toEqual(DARK);

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect.poll(() => look(page)).toEqual(LIGHT);

    await signIn(page, email);
    await expect.poll(() => look(page)).toEqual(DARK);

    const device = await browser.newContext({ colorScheme: 'light' });
    const other = await device.newPage();
    await signIn(other, email);
    await expect.poll(() => look(other)).toEqual(DARK);
    await openAppearance(other);
    await expect(other.getByRole('tab', { name: 'Dark' })).toHaveAttribute('aria-selected', 'true');
    await device.close();
  });

  test('a choice reaches every open tab, and System follows the device live (Review Focus 3)', async ({
    page,
    context,
  }) => {
    await signIn(page, freshEmail('appearance-tabs'));
    const other = await context.newPage();
    await other.goto('/');
    // The inline script alone makes it light; wait for the app, whose listener follows choices.
    await expect(other.getByRole('link', { name: 'Household' })).toBeVisible();
    await expect.poll(() => look(other)).toEqual(LIGHT);

    await openAppearance(page);
    await page.getByRole('tab', { name: 'Dark' }).click();
    await expect.poll(() => look(other)).toEqual(DARK);

    await page.getByRole('tab', { name: 'System' }).click();
    await expect.poll(() => look(other)).toEqual(LIGHT);
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect.poll(() => look(page)).toEqual(DARK);
    await other.close();
  });

  test('in light, the chosen option is filled and an unticked ingredient box shows (WCAG 1.4.11)', async ({
    page,
  }) => {
    await signIn(page, freshEmail('appearance-controls'));
    await openAppearance(page);
    await expect(page.getByRole('tab', { name: 'System' })).toHaveCSS(
      'background-color',
      'rgb(0, 117, 106)',
    );
    await expect(page.getByRole('tab', { name: 'Dark' })).toHaveCSS(
      'background-color',
      'rgba(0, 0, 0, 0)',
    );

    await createRecipe(page, {
      title: unique('Box cake'),
      ingredients: '2 cups flour',
      steps: 'Mix.\nBake.',
    });
    await page.getByRole('button', { name: 'Cook', exact: true }).click();
    const box = page
      .getByRole('checkbox', { name: '2 cups flour' })
      .locator('[aria-hidden="true"]');
    await expect(box.first()).toHaveCSS('border-top-color', 'rgb(125, 134, 150)');
    // The step not being shown is a control-colored dot.
    await expect(
      page.getByRole('button', { name: 'Go to step 2' }).locator('div').first(),
    ).toHaveCSS('background-color', 'rgb(125, 134, 150)');
  });
});
