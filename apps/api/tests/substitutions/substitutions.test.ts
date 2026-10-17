import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { env } from '../../../../test-support/env';
import { SEED, signInAs, signInFresh, type Actor } from '../../../../test-support/auth';
import { adminSql, as } from '../helpers/db';

const fresh = () =>
  signInFresh(`subs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`);

async function upload(actor: Actor, ops: unknown[]) {
  const response = await fetch(`${env.apiUrl}/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${actor.accessToken}` },
    body: JSON.stringify({ ops }),
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { results: { status: string; reason?: string }[] }).results;
}

/** A recipe with one ingredient line and a heading; returns their ids. */
async function recipe(actor: Actor, title: string) {
  const id = randomUUID();
  const line = randomUUID();
  const heading = randomUUID();
  const ingredient = (lineId: string, raw: string, isHeading: boolean) => ({
    id: lineId,
    raw,
    quantity: isHeading ? null : 1,
    quantity_max: null,
    unit: isHeading ? null : 'cup',
    item: isHeading ? '' : 'buttermilk',
    note: null,
    heading: isHeading,
  });
  await upload(actor, [
    {
      op: 'put',
      table: 'recipes',
      id,
      data: {
        household_id: actor.householdId,
        title,
        servings: 8,
        ingredients: [
          ingredient(heading, 'For the cake:', true),
          ingredient(line, '1 cup buttermilk', false),
        ],
        steps: [{ id: randomUUID(), text: 'Bake.' }],
      },
    },
  ]);
  return { id, line, heading };
}

function ask(actor: Actor, body: object): Promise<Response> {
  return fetch(`${env.apiUrl}/substitutions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${actor.accessToken}` },
    body: JSON.stringify(body),
  });
}

describe('POST /api/substitutions', () => {
  it('answers with options and remembers them; asking again replaces the row', async () => {
    const cook = await fresh();
    const r = await recipe(cook, 'Buttermilk cake');
    const first = await ask(cook, { id: randomUUID(), recipe_id: r.id, ingredient_id: r.line });
    expect(first.status).toBe(200);
    const body = (await first.json()) as {
      options: { substitute: string }[];
      ingredient_raw: string;
    };
    expect(body.options[0]?.substitute).toBe('Fake yogurt');
    expect(body.ingredient_raw).toBe('1 cup buttermilk');
    await ask(cook, { id: randomUUID(), recipe_id: r.id, ingredient_id: r.line });
    const rows = await as(
      cook,
      (tx) =>
        tx`select id from public.substitutions where recipe_id = ${r.id} and deleted_at is null`,
    );
    expect(rows).toHaveLength(1);
    const [usage] = await adminSql<{ spent: string }[]>`
      select spent_microusd::text as spent from public.ai_usage where household_id = ${cook.householdId}`;
    expect(Number(usage?.spent)).toBeGreaterThan(0);
  });

  it('says when nothing works', async () => {
    const cook = await fresh();
    const r = await recipe(cook, 'Custard FAKE_NO_SUBSTITUTE');
    const response = await ask(cook, { id: randomUUID(), recipe_id: r.id, ingredient_id: r.line });
    expect(await response.json()).toMatchObject({ options: [], note: expect.any(String) });
  });

  it('refuses a viewer, another household’s recipe, and a heading', async () => {
    const viewer = await signInAs(SEED.viewerA);
    const adminB = await signInAs(SEED.adminB);
    const member = await signInAs(SEED.memberA);
    const r = await recipe(member, 'Shared cake');
    expect(
      (await ask(viewer, { id: randomUUID(), recipe_id: r.id, ingredient_id: r.line })).status,
    ).toBe(403);
    expect(
      (await ask(adminB, { id: randomUUID(), recipe_id: r.id, ingredient_id: r.line })).status,
    ).toBe(404);
    expect(
      (await ask(member, { id: randomUUID(), recipe_id: r.id, ingredient_id: r.heading })).status,
    ).toBe(404);
  });

  it('stops at the cap, and reports an unavailable AI and unusable output', async () => {
    const capped = await fresh();
    const r = await recipe(capped, 'Capped cake');
    await adminSql`insert into public.ai_usage (household_id, month, spent_microusd)
      values (${capped.householdId}, date_trunc('month', now() at time zone 'utc')::date, 2000000)
      on conflict (household_id, month) do update set spent_microusd = 2000000`;
    const quota = await ask(capped, { id: randomUUID(), recipe_id: r.id, ingredient_id: r.line });
    expect([quota.status, await quota.json()]).toEqual([402, { error: 'quota' }]);

    const cook = await fresh();
    const down = await recipe(cook, 'Cake FAKE_OVERLOADED');
    expect(
      (await ask(cook, { id: randomUUID(), recipe_id: down.id, ingredient_id: down.line })).status,
    ).toBe(503);
    const bad = await recipe(cook, 'Cake FAKE_INVALID');
    expect(
      (await ask(cook, { id: randomUUID(), recipe_id: bad.id, ingredient_id: bad.line })).status,
    ).toBe(422);
  });

  it('is never accepted from a phone upload', async () => {
    const member = await signInAs(SEED.memberA);
    const [result] = await upload(member, [
      {
        op: 'put',
        table: 'substitutions',
        id: randomUUID(),
        data: { household_id: member.householdId },
      },
    ]);
    expect(result).toMatchObject({ status: 'rejected', reason: 'table_not_allowed' });
  });
});
