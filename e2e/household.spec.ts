import { expect, test, type Page } from './fixtures';
import { addRecipe, findRecipe, freshEmail, session, signIn, unique } from './helpers';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

async function inviteLink(admin: Page, role: 'Member' | 'Viewer' = 'Member'): Promise<string> {
  await admin.getByRole('link', { name: 'Household' }).click();
  await admin.getByRole('button', { name: role, exact: true }).click();
  await admin.getByRole('button', { name: 'Share invite' }).click();
  return (await admin.getByLabel('Invite link').textContent())!.trim();
}

test('an invited person joins, is made a Viewer, and is removed (FR-3, FR-4, FR-5)', async ({
  page,
  browser,
}) => {
  const adminEmail = freshEmail('hh-admin');
  await signIn(page, adminEmail);
  const title = unique('Family soup');
  await addRecipe(page, title);
  const link = await inviteLink(page);

  const joinerEmail = freshEmail('hh-joiner');
  const joiner = await session(browser, joinerEmail);
  await joiner.goto(link);
  await expect(joiner.getByText(/^Join the .+ as a Member$/)).toBeVisible();
  await joiner.getByRole('button', { name: 'Join' }).click();
  await expect(joiner.getByText(/^You've joined the /)).toBeVisible({ timeout: 30_000 });
  await expect(await findRecipe(joiner, title)).toBeVisible({ timeout: 30_000 });

  await page.reload();
  await expect(page.getByText(joinerEmail)).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: `Viewer role for ${joinerEmail}` }).click();
  await (await findRecipe(joiner, title)).click();
  await expect(joiner.getByRole('button', { name: 'Edit' })).toHaveCount(0, { timeout: 60_000 });

  await page.getByRole('button', { name: `Remove ${joinerEmail}` }).click();
  await expect(joiner.getByText(/^You were moved to the /)).toBeVisible({ timeout: 60_000 });
  await expect(joiner.getByText('No recipes yet')).toBeVisible();
  await joiner.context().close();
});

test('a person with recipes brings them, then leaves (FR-3, FR-5)', async ({ page, browser }) => {
  await signIn(page, freshEmail('hh-host'));
  const link = await inviteLink(page);
  const joiner = await session(browser, freshEmail('hh-bringer'));
  // Leave asks to confirm on this second device too.
  joiner.on('dialog', (dialog) => void dialog.accept());
  const mine = unique('Brought pie');
  await addRecipe(joiner, mine);
  await joiner.goto(link);
  await expect(joiner.getByText('Your 1 recipe will move to the', { exact: false })).toBeVisible();
  await joiner.getByRole('button', { name: 'Join' }).click();
  await expect(joiner.getByText(/^You've joined the /)).toBeVisible({ timeout: 30_000 });
  await page.getByRole('link', { name: 'All recipes' }).click();
  await expect(await findRecipe(page, mine)).toBeVisible({ timeout: 30_000 });

  await joiner.getByRole('link', { name: 'Household' }).click();
  await joiner.getByRole('button', { name: 'Leave household' }).click();
  await expect(joiner.getByText(/^You were moved to the /)).toBeVisible({ timeout: 60_000 });
  await expect(joiner.getByText('No recipes yet')).toBeVisible();
  await joiner.context().close();
});

test('a used link says so (FR-3)', async ({ page, browser }) => {
  await signIn(page, freshEmail('hh-once'));
  const link = await inviteLink(page);
  const first = await session(browser, freshEmail('hh-first'));
  await first.goto(link);
  await first.getByRole('button', { name: 'Join' }).click();
  await expect(first.getByText(/^You've joined the /)).toBeVisible({ timeout: 30_000 });
  const second = await session(browser, freshEmail('hh-second'));
  await second.goto(link);
  await expect(second.getByText('This invite has already been used')).toBeVisible();
  await expect(second.getByRole('button', { name: 'Join' })).toHaveCount(0);
  await first.context().close();
  await second.context().close();
});

test('the Household screen offline shows members and disables changes', async ({
  page,
  context,
}) => {
  const email = freshEmail('hh-offline');
  await signIn(page, email);
  await page.getByRole('link', { name: 'Household' }).click();
  await expect(page.getByText(email)).toBeVisible({ timeout: 30_000 });
  await context.setOffline(true);
  await expect(page.getByText('Changing the household needs a connection')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Share invite' })).toHaveCount(0);
});
