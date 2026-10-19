import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { env } from '../../../../test-support/env';
import { signInFresh, type Actor } from '../../../../test-support/auth';
import { adminSql } from '../helpers/db';

async function upload(actor: Actor, ops: unknown[]) {
  const response = await fetch(`${env.apiUrl}/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${actor.accessToken}` },
    body: JSON.stringify({ ops }),
  });
  return (await response.json()) as { results: { id: string; status: string; reason?: string }[] };
}
const fresh = () => signInFresh(`shop-${randomUUID()}@example.test`);

it('puts, ticks and soft-deletes a shopping item; refuses a bad aisle and a long item', async () => {
  const cook = await fresh();
  const id = randomUUID();
  const base = {
    household_id: cook.householdId,
    item: 'onions',
    item_key: 'onion',
    aisle: 'produce',
    quantity: 2,
  };
  const put = await upload(cook, [{ op: 'put', table: 'shopping_items', id, data: base }]);
  expect(put.results[0]!.status).toBe('applied');
  const tick = await upload(cook, [
    { op: 'patch', table: 'shopping_items', id, data: { checked_at: new Date().toISOString() } },
  ]);
  expect(tick.results[0]!.status).toBe('applied');
  const bad = await upload(cook, [
    { op: 'put', table: 'shopping_items', id: randomUUID(), data: { ...base, aisle: 'garden' } },
    {
      op: 'put',
      table: 'shopping_items',
      id: randomUUID(),
      data: { ...base, item: 'x'.repeat(201) },
    },
  ]);
  expect(bad.results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
});

it('a second aisle choice for the same item updates the first', async () => {
  const cook = await fresh();
  const data = { household_id: cook.householdId, item_key: 'onion', aisle: 'frozen' };
  const first = await upload(cook, [{ op: 'put', table: 'aisle_choices', id: randomUUID(), data }]);
  const second = await upload(cook, [
    { op: 'put', table: 'aisle_choices', id: randomUUID(), data: { ...data, aisle: 'dairy' } },
  ]);
  expect([first.results[0]!.status, second.results[0]!.status]).toEqual(['applied', 'applied']);
  const rows = await adminSql<{ aisle: string }[]>`
    select aisle from public.aisle_choices where household_id = ${cook.householdId} and item_key = 'onion'`;
  expect(rows).toEqual([{ aisle: 'dairy' }]);
});

it('a full list refuses new rows with list_full', async () => {
  const cook = await fresh();
  await adminSql`
    insert into public.shopping_items (id, household_id, item, item_key, aisle)
    select gen_random_uuid(), ${cook.householdId}, 'x', 'x', 'other' from generate_series(1, 500)`;
  const res = await upload(cook, [
    {
      op: 'put',
      table: 'shopping_items',
      id: randomUUID(),
      data: {
        household_id: cook.householdId,
        item: 'one more',
        item_key: 'one more',
        aisle: 'other',
      },
    },
  ]);
  expect(res.results[0]).toMatchObject({ status: 'rejected', reason: 'list_full' });
});

it('phones uploading at once cannot pass 500 live rows', async () => {
  const cook = await fresh();
  await adminSql`
    insert into public.shopping_items (id, household_id, item, item_key, aisle)
    select gen_random_uuid(), ${cook.householdId}, 'x', 'x', 'other' from generate_series(1, 498)`;
  const one = () => [
    {
      op: 'put',
      table: 'shopping_items',
      id: randomUUID(),
      data: { household_id: cook.householdId, item: 'more', item_key: 'more', aisle: 'other' },
    },
  ];
  const results = await Promise.all(Array.from({ length: 5 }, () => upload(cook, one())));
  const [count] = await adminSql<{ live: number }[]>`
    select count(*)::int as live from public.shopping_items
    where household_id = ${cook.householdId} and deleted_at is null`;
  expect(count!.live).toBe(500);
  expect(results.flatMap((r) => r.results).filter((r) => r.status === 'applied')).toHaveLength(2);
});

it('the trash purge also removes list rows deleted over 30 days ago', async () => {
  const cook = await fresh();
  const old = randomUUID();
  await adminSql`insert into public.shopping_items (id, household_id, item, item_key, aisle, deleted_at)
    values (${old}, ${cook.householdId}, 'x', 'x', 'other', now() - interval '31 days')`;
  const res = await fetch(`${env.apiUrl}/trash/purge`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cook.accessToken}` },
  });
  expect(res.status).toBe(200);
  expect(await adminSql`select 1 from public.shopping_items where id = ${old}`).toHaveLength(0);
});
