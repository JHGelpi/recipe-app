import { expect, test } from './fixtures';

test('the manifest makes the app installable', async ({ request }) => {
  const response = await request.get('/manifest.webmanifest');
  expect(response.ok()).toBe(true);
  const manifest = (await response.json()) as {
    name: string;
    short_name: string;
    display: string;
    start_url: string;
    scope: string;
    theme_color: string;
    background_color: string;
    icons: { src: string; sizes: string; purpose?: string }[];
  };
  expect(manifest).toMatchObject({
    name: 'Dishkept',
    short_name: 'Dishkept',
    display: 'standalone',
    start_url: '/',
    scope: '/',
    theme_color: '#0E121A',
    background_color: '#0E121A',
  });
  expect(manifest.icons.map((icon) => icon.sizes)).toEqual(
    expect.arrayContaining(['192x192', '512x512']),
  );
  expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
  for (const icon of manifest.icons) {
    const image = await request.get(icon.src);
    expect(image.headers()['content-type'], icon.src).toBe('image/png');
  }
});

test('the page links the manifest and the iOS home-screen icon', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    'href',
    '/manifest.webmanifest',
  );
  const touchIcon = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
  expect(touchIcon).toBe('/icons/apple-touch-icon.png');
  expect((await request.get(touchIcon ?? '')).headers()['content-type']).toBe('image/png');
  await expect(page.locator('meta[name="theme-color"]')).toHaveCount(1);
  await expect(page).toHaveTitle('Dishkept');
});

test('the page is revalidated and hashed bundles are cached for good', async ({
  page,
  request,
}) => {
  expect((await request.get('/')).headers()['cache-control']).toBe('no-cache');
  expect((await request.get('/sign-in')).headers()['cache-control']).toBe('no-cache');
  await page.goto('/');
  const bundle = await page.locator('script[src^="/_expo/static/"]').first().getAttribute('src');
  expect((await request.get(bundle ?? '')).headers()['cache-control']).toBe(
    'public, max-age=31536000, immutable',
  );
});

test('the footer shows the build time and the storage status', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByLabel('Build')).toHaveText(
    /^Build \d{4}-\d{2}-\d{2} \d{2}:\d{2} · Storage: (persistent|best effort|unknown)$/,
  );
});

test('the icons are the Dishkept artwork at their stated sizes', async ({ request }) => {
  for (const [src, size] of [
    ['/icons/apple-touch-icon.png', 180],
    ['/icons/icon-192.png', 192],
    ['/icons/icon-512.png', 512],
    ['/icons/icon-maskable-512.png', 512],
  ] as const) {
    const body = await (await request.get(src)).body();
    // PNG width and height sit at bytes 16–23 of the IHDR chunk.
    expect([body.readUInt32BE(16), body.readUInt32BE(20)], src).toEqual([size, size]);
  }
});
