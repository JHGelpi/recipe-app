import { test as base } from '@playwright/test';

export * from '@playwright/test';

/**
 * `test` for every spec. Contexts a test opens on the worker's shared browser
 * (session(), visitors) are closed when it ends; left open, each keeps syncing
 * until the run ends, and a full run runs out of memory. A fixture, not a hook
 * in helpers.ts: a hook there registers only for the first file that loads it.
 */
export const test = base.extend<{ closeExtraContexts: void }>({
  closeExtraContexts: [
    async ({ browser, context }, use) => {
      await use();
      await Promise.all(
        browser
          .contexts()
          .filter((other) => other !== context)
          .map((other) => other.close().catch(() => undefined)),
      );
    },
    { auto: true },
  ],
});
