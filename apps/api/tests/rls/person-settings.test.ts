import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SEED, signInAs, signInFresh, type Actor } from '../../../../test-support/auth';
import { adminSql, as, refusalCode } from '../helpers/db';

// ADR-0031: a person's Units and Appearance, their own row whatever their
// household or role (FR-23, NFR-11).
const fresh = () => signInFresh(`settings-${randomUUID()}@example.test`);
const save = (actor: Actor, units = 'metric', appearance = 'dark') =>
  as(
    actor,
    (tx) => tx`
    insert into public.person_settings (id, user_id, units, appearance)
    values (${actor.userId}, ${actor.userId}, ${units}, ${appearance})
    on conflict (id) do update set units = excluded.units, appearance = excluded.appearance`,
  );
const read = (actor: Actor) =>
  as(
    actor,
    (tx) =>
      tx<{ user_id: string; units: string }[]>`select user_id, units from public.person_settings`,
  );

describe('person settings (#60)', () => {
  it('each person reads and writes only their own row, even within one household', async () => {
    const admin = await signInAs(SEED.adminA);
    const member = await signInAs(SEED.memberA);
    await save(admin, 'us', 'light');
    await save(member, 'metric', 'dark');
    expect([...(await read(member))]).toEqual([{ user_id: member.userId, units: 'metric' }]);
    // Someone else's row: invisible, unchangeable, and not creatable for them.
    const changed = await as(
      member,
      (tx) =>
        tx`update public.person_settings set units = 'metric' where user_id = ${admin.userId} returning id`,
    );
    expect(changed).toHaveLength(0);
    const other = await fresh();
    expect(
      await refusalCode(
        as(
          member,
          (tx) =>
            tx`insert into public.person_settings (id, user_id) values (${other.userId}, ${other.userId})`,
        ),
      ),
    ).toBe('42501');
    const [stored] = await adminSql<{ units: string }[]>`
      select units from public.person_settings where user_id = ${admin.userId}`;
    expect(stored?.units).toBe('us');
  });

  it('a Viewer saves their own (rule 4’s exception)', async () => {
    const viewer = await signInAs(SEED.viewerA);
    await save(viewer, 'us', 'system');
    expect([...(await read(viewer))]).toEqual([{ user_id: viewer.userId, units: 'us' }]);
  });

  it('settings stay with the person through a household move', async () => {
    const host = await fresh();
    const mover = await fresh();
    await save(mover, 'metric', 'light');
    const [invite] = await as(
      host,
      (tx) => tx<{ token: string }[]>`select token from public.create_invite('member')`,
    );
    await as(mover, (tx) => tx`select * from public.accept_invite(${invite!.token})`);
    const moved = await signInFresh(mover.email);
    expect(moved.householdId).toBe(host.householdId);
    expect([...(await read(moved))]).toEqual([{ user_id: mover.userId, units: 'metric' }]);
    expect(await read(host)).toHaveLength(0);
  });

  it('only known values, and the id is the person’s', async () => {
    const person = await fresh();
    expect(await refusalCode(save(person, 'imperial'))).toBe('23514');
    expect(
      await refusalCode(
        as(
          person,
          (tx) =>
            tx`insert into public.person_settings (id, user_id) values (${randomUUID()}, ${person.userId})`,
        ),
      ),
    ).toBe('23514');
  });

  it('"authenticated" may select, insert and update, never delete', async () => {
    const grants = await adminSql<{ privilege_type: string }[]>`
      select privilege_type from information_schema.role_table_grants
      where grantee = 'authenticated' and table_schema = 'public' and table_name = 'person_settings'
      order by 1`;
    expect(grants.map((grant) => grant.privilege_type)).toEqual(['INSERT', 'SELECT', 'UPDATE']);
  });
});
