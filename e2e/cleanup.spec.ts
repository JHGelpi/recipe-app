import { expect, test } from './fixtures';
import { freshEmail } from './helpers';

// Contexts a test opens on the shared browser must not outlive it: a full run
// otherwise runs out of memory (Final review 1). Runs after other spec files.
test.describe.configure({ mode: 'serial' });

test('a test may open extra contexts', async ({ browser, context }) => {
  expect(context).toBeTruthy();
  await browser.newContext();
  expect(freshEmail('cleanup')).toContain('cleanup');
  expect(browser.contexts().length).toBeGreaterThan(1);
});

test('the next test starts with only its own context', async ({ browser, context }) => {
  expect(browser.contexts()).toEqual([context]);
});
