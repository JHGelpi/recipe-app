import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { env } from '../../../../test-support/env';
import { SEED, signInAs, signInFresh, type Actor } from '../../../../test-support/auth';
import { adminSql } from '../helpers/db';

async function upload(actor: Actor, ops: unknown[]) {
  const response = await fetch(`${env.apiUrl}/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${actor.accessToken}` },
    body: JSON.stringify({ ops }),
  });
  return (await response.json()) as { results: { id: string; status: string; reason?: string }[] };
}
const fresh = () => signInFresh(`cook-${randomUUID()}@example.test`);
const purge = (actor: Actor) =>
  fetch(`${env.apiUrl}/trash/purge`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${actor.accessToken}` },
  });

async function recipe(actor: Actor): Promise<string> {
  const id = randomUUID();
  await upload(actor, [
    { op: 'put', table: 'recipes', id, data: { household_id: actor.householdId, title: 'Soup' } },
  ]);
  return id;
}

it('logs a meal with a photo, edits it, and trashes it (FR-37–FR-40)', async () => {
  const cook = await fresh();
  const recipeId = await recipe(cook);
  const id = randomUUID();
  const photo = randomUUID();
  const put = await upload(cook, [
    {
      op: 'put',
      table: 'cook_logs',
      id,
      data: {
        household_id: cook.householdId,
        recipe_id: recipeId,
        recipe_title: 'Soup',
        cooked_on: '2026-10-22',
      },
    },
    {
      op: 'put',
      table: 'photos',
      id: photo,
      data: {
        household_id: cook.householdId,
        kind: 'cook',
        cook_log_id: id,
        position: 1,
        media_type: 'image/jpeg',
        bytes: 10,
        width: 1,
        height: 1,
      },
    },
  ]);
  expect(put.results.map((r) => r.status)).toEqual(['applied', 'applied']);
  const patch = await upload(cook, [
    {
      op: 'patch',
      table: 'cook_logs',
      id,
      data: { cooked_on: '2026-10-21', notes: 'Used thighs', deleted_at: new Date().toISOString() },
    },
  ]);
  expect(patch.results[0]!.status).toBe('applied');
  const [row] = await adminSql<
    { cooked_on: string; notes: string; cooked_by: string; trashed: boolean }[]
  >`select to_char(cooked_on, 'YYYY-MM-DD') as cooked_on, notes, cooked_by,
       deleted_at is not null as trashed from public.cook_logs where id = ${id}`;
  expect(row).toEqual({
    cooked_on: '2026-10-21',
    notes: 'Used thighs',
    cooked_by: cook.userId,
    trashed: true,
  });
});

it('refuses a cook, a recipe change, a bad date, and a viewer', async () => {
  const cook = await fresh();
  const viewer = await signInAs(SEED.viewerA);
  const id = randomUUID();
  const data = { household_id: cook.householdId, recipe_title: 'Soup', cooked_on: '2026-10-22' };
  const results = await upload(cook, [
    { op: 'put', table: 'cook_logs', id: randomUUID(), data: { ...data, cooked_by: cook.userId } },
    { op: 'put', table: 'cook_logs', id: randomUUID(), data: { ...data, cooked_on: '2026-02-30' } },
    { op: 'put', table: 'cook_logs', id, data },
    { op: 'patch', table: 'cook_logs', id, data: { recipe_id: randomUUID() } },
  ]);
  expect(results.results.map((r) => r.reason ?? r.status)).toEqual([
    'invalid',
    'invalid',
    'applied',
    'invalid',
  ]);
  const byViewer = await upload(viewer, [
    {
      op: 'put',
      table: 'cook_logs',
      id: randomUUID(),
      data: { ...data, household_id: viewer.householdId },
    },
  ]);
  expect(byViewer.results[0]!.status).toBe('rejected');
});

it('the trash purge removes entries trashed over 30 days ago with their photos, and keeps entries of a purged recipe', async () => {
  const cook = await fresh();
  const recipeId = await recipe(cook);
  const [old, kept, oldPhoto, keptPhoto] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  await adminSql`insert into public.cook_logs (id, household_id, recipe_id, recipe_title, cooked_on, deleted_at)
    values (${old}, ${cook.householdId}, null, 'Old', '2026-01-01', now() - interval '31 days'),
           (${kept}, ${cook.householdId}, ${recipeId}, 'Soup', '2026-01-02', null)`;
  await adminSql`insert into public.photos (id, household_id, kind, cook_log_id, position, media_type, bytes, width, height)
    values (${oldPhoto}, ${cook.householdId}, 'cook', ${old}, 1, 'image/jpeg', 10, 1, 1),
           (${keptPhoto}, ${cook.householdId}, 'cook', ${kept}, 1, 'image/jpeg', 10, 1, 1)`;
  await adminSql`update public.recipes set deleted_at = now() - interval '31 days' where id = ${recipeId}`;
  expect((await purge(cook)).status).toBe(200);
  expect(await adminSql`select id from public.cook_logs where id = ${old}`).toHaveLength(0);
  expect(await adminSql`select id from public.photos where id = ${oldPhoto}`).toHaveLength(0);
  expect(await adminSql`select id from public.recipes where id = ${recipeId}`).toHaveLength(0);
  const [entry] = await adminSql<{ recipe_id: string | null }[]>`
    select recipe_id from public.cook_logs where id = ${kept}`;
  expect(entry).toEqual({ recipe_id: null });
  expect(await adminSql`select id from public.photos where id = ${keptPhoto}`).toHaveLength(1);
});
