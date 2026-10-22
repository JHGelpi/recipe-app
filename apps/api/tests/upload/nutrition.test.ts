import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { env } from '../../../../test-support/env';
import { signInFresh, type Actor } from '../../../../test-support/auth';
import { adminSql } from '../helpers/db';

const fresh = () => signInFresh(`nutrition-${randomUUID()}@example.test`);

function call(actor: Actor | null, method: string, path: string, body?: unknown) {
  return fetch(`${env.apiUrl}${path}`, {
    method,
    headers: {
      ...(actor ? { Authorization: `Bearer ${actor.accessToken}` } : {}),
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function upload(actor: Actor, ops: unknown[]) {
  const response = await call(actor, 'POST', '/upload', { ops });
  return (await response.json()) as { results: { status: string; reason?: string }[] };
}
async function nutritionOf(id: string): Promise<unknown> {
  const [row] = await adminSql<{ nutrition: unknown }[]>`
    select nutrition from public.recipes where id = ${id}`;
  return row?.nutrition;
}

it('stores nutrition per serving, clears it, and refuses values outside the schema (FR-43)', async () => {
  const cook = await fresh();
  const id = randomUUID();
  const recipe = { household_id: cook.householdId, title: 'Oats' };
  const put = await upload(cook, [
    {
      op: 'put',
      table: 'recipes',
      id,
      data: { ...recipe, nutrition: { calories: 310, fat_g: 7 } },
    },
  ]);
  expect(put.results[0]!.status).toBe('applied');
  expect(await nutritionOf(id)).toEqual({ calories: 310, fat_g: 7 });

  const bad = await upload(cook, [
    { op: 'patch', table: 'recipes', id, data: { nutrition: { calories: -5 } } },
    { op: 'patch', table: 'recipes', id, data: { nutrition: { fiber_g: 3 } } },
    { op: 'patch', table: 'recipes', id, data: { nutrition: {} } },
    { op: 'patch', table: 'recipes', id, data: { nutrition: '310 kcal' } },
  ]);
  expect(bad.results.map((r) => r.reason)).toEqual(['invalid', 'invalid', 'invalid', 'invalid']);
  expect(await nutritionOf(id)).toEqual({ calories: 310, fat_g: 7 });

  const cleared = await upload(cook, [
    { op: 'patch', table: 'recipes', id, data: { nutrition: null } },
  ]);
  expect(cleared.results[0]!.status).toBe('applied');
  expect(await nutritionOf(id)).toBeNull();
});

it('the database refuses malformed nutrition even past the API', async () => {
  const cook = await fresh();
  for (const nutrition of [{ calories: 10001 }, { protein_g: 'x' }, { sodium_mg: 4 }, {}, []]) {
    const failed = await adminSql`
      insert into public.recipes (id, household_id, title, nutrition)
      values (${randomUUID()}, ${cook.householdId}, 'Bad', ${adminSql.json(nutrition)})`.then(
      () => 'ok',
      (error: { code?: string }) => error.code,
    );
    expect([nutrition, failed]).toEqual([nutrition, '23514']);
  }
});

it('a share carries nutrition, and the saved copy keeps it; an older snapshot saves without (FR-43)', async () => {
  const owner = await fresh();
  const saver = await fresh();
  const id = randomUUID();
  await upload(owner, [
    {
      op: 'put',
      table: 'recipes',
      id,
      data: { household_id: owner.householdId, title: 'Shared oats', nutrition: { protein_g: 9 } },
    },
  ]);
  const made = await call(owner, 'POST', '/shares', { recipe_id: id });
  const { code } = (await made.json()) as { code: string };
  const read = (await (await call(null, 'GET', `/shares/${code}`)).json()) as {
    snapshot: { nutrition: unknown };
  };
  expect(read.snapshot.nutrition).toEqual({ protein_g: 9 });
  const saved = (await (await call(saver, 'POST', `/shares/${code}/save`)).json()) as {
    recipe_id: string;
  };
  expect(await nutritionOf(saved.recipe_id)).toEqual({ protein_g: 9 });

  // A snapshot made before FR-43 has no nutrition key.
  await adminSql`update public.shares set snapshot = snapshot - 'nutrition'
    where recipe_id = ${id} and deleted_at is null`;
  const other = await fresh();
  const older = (await (await call(other, 'POST', `/shares/${code}/save`)).json()) as {
    recipe_id: string;
  };
  expect(await nutritionOf(older.recipe_id)).toBeNull();
});
