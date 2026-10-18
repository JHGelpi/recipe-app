import { defineConfig, devices } from '@playwright/test';
import { env } from './test-support/env';

// No webServer: the app under test is the one built into the proxy image.
// `pnpm test:e2e` rebuilds and starts the stack first.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  retries: 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? env.publicUrl,
    // Tracing every test held enough memory over a full run to exhaust this
    // 8 GB machine; failures still write error-context.md with a page snapshot.
    // E2E_TRACE=1 keeps traces of failures when they are needed.
    trace: process.env.E2E_TRACE ? 'retain-on-failure' : 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
