import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SEED, signInAs } from '../../../../test-support/auth';
import { adminSql, as, refusalCode } from '../helpers/db';

const item = (householdId: string | null) => ({
  id: randomUUID(),
  household_id: householdId,
  item: 'onions',
  item_key: 'onion',
  aisle: 'produce',
});

describe('shopping list tables', () => {
  it('members add and tick; viewers read but cannot write', async () => {
    const member = await signInAs(SEED.memberA);
    const viewer = await signInAs(SEED.viewerA);
    const row = item(member.householdId);
    await as(member, (tx) => tx`insert into public.shopping_items ${tx(row)}`);
    await as(
      member,
      (tx) => tx`update public.shopping_items set checked_at = now() where id = ${row.id}`,
    );
    expect(
      await as(viewer, (tx) => tx`select id from public.shopping_items where id = ${row.id}`),
    ).toHaveLength(1);
    expect(
      await refusalCode(
        as(viewer, (tx) => tx`insert into public.shopping_items ${tx(item(viewer.householdId))}`),
      ),
    ).toBe('42501');
    const updated = await as(
      viewer,
      (tx) =>
        tx`update public.shopping_items set checked_at = null where id = ${row.id} returning id`,
    );
    expect(updated).toHaveLength(0);
  });

  it('viewers cannot insert or update aisle choices', async () => {
    const member = await signInAs(SEED.memberA);
    const viewer = await signInAs(SEED.viewerA);
    const choice = {
      id: randomUUID(),
      household_id: member.householdId,
      item_key: `viewer-test-${randomUUID()}`,
      aisle: 'pantry',
    };
    await as(member, (tx) => tx`insert into public.aisle_choices ${tx(choice)}`);
    expect(
      await refusalCode(
        as(viewer, (tx) =>
          tx`insert into public.aisle_choices ${tx({ ...choice, id: randomUUID(), item_key: `v-${randomUUID()}` })}`,
        ),
      ),
    ).toBe('42501');
    const updated = await as(
      viewer,
      (tx) => tx`update public.aisle_choices set aisle = 'other' where id = ${choice.id} returning id`,
    );
    expect(updated).toHaveLength(0);
  });

  it('another household cannot read or write the rows', async () => {
    const member = await signInAs(SEED.memberA);
    const other = await signInAs(SEED.adminB);
    const row = item(member.householdId);
    await as(member, (tx) => tx`insert into public.shopping_items ${tx(row)}`);
    expect(
      await as(other, (tx) => tx`select id from public.shopping_items where id = ${row.id}`),
    ).toHaveLength(0);
    expect(
      await refusalCode(
        as(other, (tx) => tx`insert into public.shopping_items ${tx(item(member.householdId))}`),
      ),
    ).toBe('42501');
  });

  it('an aisle outside the list and a second choice for the same item are refused by the database', async () => {
    const member = await signInAs(SEED.memberA);
    expect(
      await refusalCode(
        as(
          member,
          (tx) =>
            tx`insert into public.shopping_items ${tx({ ...item(member.householdId), aisle: 'garden' })}`,
        ),
      ),
    ).toBe('23514');
    const key = `k-${randomUUID()}`;
    await as(
      member,
      (tx) =>
        tx`insert into public.aisle_choices ${tx({ id: randomUUID(), household_id: member.householdId, item_key: key, aisle: 'frozen' })}`,
    );
    expect(
      await refusalCode(
        as(
          member,
          (tx) =>
            tx`insert into public.aisle_choices ${tx({ id: randomUUID(), household_id: member.householdId, item_key: key, aisle: 'dairy' })}`,
        ),
      ),
    ).toBe('23505');
  });

  it('only rows deleted over 30 days ago can be hard-deleted', async () => {
    const member = await signInAs(SEED.memberA);
    const fresh = item(member.householdId);
    const old = item(member.householdId);
    await adminSql`insert into public.shopping_items ${adminSql({ ...fresh, deleted_at: new Date() })}`;
    await adminSql`insert into public.shopping_items ${adminSql(old)}`;
    await adminSql`update public.shopping_items set deleted_at = now() - interval '31 days' where id = ${old.id}`;
    const gone = await as(
      member,
      (tx) =>
        tx<
          { id: string }[]
        >`delete from public.shopping_items where id in (${fresh.id}, ${old.id}) returning id`,
    );
    expect(gone.map((r) => r.id)).toEqual([old.id]);
  });
});
