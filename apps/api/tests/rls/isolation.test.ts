import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SEED, signInAs, signInFresh, type Actor } from '../../../../test-support/auth';
import { adminSql, as, refusalCode } from '../helpers/db';
import { TENANT_COLUMN, TENANT_TABLES } from './registry';

// insufficient_privilege: raised for an RLS with-check failure and for a
// statement the role has no grant for (delete, anything on memberships).
const REFUSED = '42501';

async function insertRecipe(actor: Actor, title: string): Promise<string> {
  const id = randomUUID();
  await as(
    actor,
    (tx) =>
      tx`insert into public.recipes (id, household_id, title) values (${id}, ${actor.householdId}, ${title})`,
  );
  return id;
}

async function titleOf(actor: Actor, id: string): Promise<string | undefined> {
  const rows = await as(
    actor,
    (tx) => tx<{ title: string }[]>`select title from public.recipes where id = ${id}`,
  );
  return rows[0]?.title;
}

describe('cross-household isolation', () => {
  it('seeded users carry the expected claims', async () => {
    const adminA = await signInAs(SEED.adminA);
    const memberA = await signInAs(SEED.memberA);
    const viewerA = await signInAs(SEED.viewerA);
    const adminB = await signInAs(SEED.adminB);
    expect([adminA.role, memberA.role, viewerA.role, adminB.role]).toEqual([
      'admin',
      'member',
      'viewer',
      'admin',
    ]);
    expect(memberA.householdId).toBe(adminA.householdId);
    expect(viewerA.householdId).toBe(adminA.householdId);
    expect(adminB.householdId).not.toBe(adminA.householdId);
  });

  it.each(TENANT_TABLES)('household B reads none of household A rows in %s', async (table) => {
    const a = await signInAs(SEED.adminA);
    const b = await signInAs(SEED.adminB);
    const column = TENANT_COLUMN[table];

    const targeted = await as(
      b,
      (tx) => tx`select * from public.${tx(table)} where ${tx(column)} = ${a.householdId}`,
    );
    expect(targeted).toHaveLength(0);

    const everything = await as(
      b,
      (tx) => tx<{ tenant: string }[]>`select ${tx(column)} as tenant from public.${tx(table)}`,
    );
    expect([...new Set(everything.map((row) => row.tenant))]).toEqual([b.householdId]);
  });

  it('household B cannot insert a recipe into household A', async () => {
    const a = await signInAs(SEED.adminA);
    const b = await signInAs(SEED.adminB);
    const code = await refusalCode(
      as(
        b,
        (tx) =>
          tx`insert into public.recipes (id, household_id, title) values (${randomUUID()}, ${a.householdId}, 'Intruder')`,
      ),
    );
    expect(code).toBe(REFUSED);
  });

  it('household B cannot update a recipe in household A', async () => {
    const a = await signInAs(SEED.memberA);
    const b = await signInAs(SEED.adminB);
    const id = await insertRecipe(a, 'Original');
    const changed = await as(
      b,
      (tx) => tx`update public.recipes set title = 'Hacked' where id = ${id} returning id`,
    );
    expect(changed).toHaveLength(0);
    expect(await titleOf(a, id)).toBe('Original');
  });

  it('a recipe cannot be moved into another household', async () => {
    const a = await signInAs(SEED.adminA);
    const b = await signInAs(SEED.adminB);
    const id = await insertRecipe(b, 'Mine');
    const code = await refusalCode(
      as(b, (tx) => tx`update public.recipes set household_id = ${a.householdId} where id = ${id}`),
    );
    expect(code).toBe(REFUSED);
  });
});

describe('roles', () => {
  it('a viewer can read recipes', async () => {
    const viewer = await signInAs(SEED.viewerA);
    const rows = await as(
      viewer,
      (tx) => tx<{ title: string }[]>`select title from public.recipes`,
    );
    expect(rows.map((row) => row.title)).toContain('Seed pancakes');
  });

  it('a viewer cannot insert', async () => {
    const viewer = await signInAs(SEED.viewerA);
    const code = await refusalCode(
      as(
        viewer,
        (tx) =>
          tx`insert into public.recipes (id, household_id, title) values (${randomUUID()}, ${viewer.householdId}, 'Nope')`,
      ),
    );
    expect(code).toBe(REFUSED);
  });

  it('a viewer cannot update', async () => {
    const member = await signInAs(SEED.memberA);
    const viewer = await signInAs(SEED.viewerA);
    const id = await insertRecipe(member, 'Untouched');
    const changed = await as(
      viewer,
      (tx) => tx`update public.recipes set title = 'Changed' where id = ${id} returning id`,
    );
    expect(changed).toHaveLength(0);
    expect(await titleOf(member, id)).toBe('Untouched');
  });

  it('a member can insert, read, and update', async () => {
    const member = await signInAs(SEED.memberA);
    const id = await insertRecipe(member, 'Draft');
    await as(member, (tx) => tx`update public.recipes set title = 'Final' where id = ${id}`);
    expect(await titleOf(member, id)).toBe('Final');
  });

  it('only an admin can rename the household', async () => {
    const admin = await signInAs(SEED.adminA);
    const member = await signInAs(SEED.memberA);
    const asMember = await as(
      member,
      (tx) =>
        tx`update public.households set name = 'Member was here' where id = ${member.householdId} returning id`,
    );
    expect(asMember).toHaveLength(0);
    const asAdmin = await as(
      admin,
      (tx) =>
        tx`update public.households set name = 'Household A' where id = ${admin.householdId} returning id`,
    );
    expect(asAdmin).toHaveLength(1);
  });
});

describe('no hard deletes', () => {
  it.each([SEED.adminA, SEED.memberA, SEED.viewerA])('%s cannot delete a recipe', async (email) => {
    const member = await signInAs(SEED.memberA);
    const actor = await signInAs(email);
    const id = await insertRecipe(member, 'Keep me');
    const code = await refusalCode(
      as(actor, (tx) => tx`delete from public.recipes where id = ${id}`),
    );
    expect(code).toBe(REFUSED);
    expect(await titleOf(member, id)).toBe('Keep me');
  });

  it('an admin cannot delete the household or a membership', async () => {
    const admin = await signInAs(SEED.adminA);
    expect(
      await refusalCode(
        as(admin, (tx) => tx`delete from public.households where id = ${admin.householdId}`),
      ),
    ).toBe(REFUSED);
    expect(
      await refusalCode(
        as(
          admin,
          (tx) => tx`delete from public.memberships where household_id = ${admin.householdId}`,
        ),
      ),
    ).toBe(REFUSED);
    const remaining = await as(admin, (tx) => tx`select id from public.memberships`);
    expect(remaining).toHaveLength(3);
  });
});

describe('server-owned fields', () => {
  it('ignores client values for created_at, updated_at, and updated_by', async () => {
    const admin = await signInAs(SEED.adminA);
    const member = await signInAs(SEED.memberA);
    const id = randomUUID();
    const spoofed = '2000-01-01T00:00:00+00:00';
    type Stamps = { created_at: Date; updated_at: Date; updated_by: string };

    const [inserted] = await as(
      member,
      (tx) => tx<Stamps[]>`
        insert into public.recipes (id, household_id, title, created_at, updated_at, updated_by)
        values (${id}, ${member.householdId}, 'Clock test', ${spoofed}, ${spoofed}, ${admin.userId})
        returning created_at, updated_at, updated_by`,
    );
    const oneMinuteAgo = Date.now() - 60_000;
    expect(inserted!.created_at.getTime()).toBeGreaterThan(oneMinuteAgo);
    expect(inserted!.updated_at.getTime()).toBeGreaterThan(oneMinuteAgo);
    expect(inserted!.updated_by).toBe(member.userId);

    const [updated] = await as(
      admin,
      (tx) => tx<Stamps[]>`
        update public.recipes
        set title = 'Clock test 2', created_at = ${spoofed}, updated_by = ${member.userId}
        where id = ${id}
        returning created_at, updated_at, updated_by`,
    );
    expect(updated!.created_at.getTime()).toBe(inserted!.created_at.getTime());
    expect(updated!.updated_by).toBe(admin.userId);
  });
});

describe('memberships are read-only for clients', () => {
  it('rejects insert and update', async () => {
    const admin = await signInAs(SEED.adminA);
    const viewer = await signInAs(SEED.viewerA);
    expect(
      await refusalCode(
        as(
          admin,
          (tx) =>
            tx`insert into public.memberships (household_id, user_id, role) values (${admin.householdId}, ${admin.userId}, 'member')`,
        ),
      ),
    ).toBe(REFUSED);
    expect(
      await refusalCode(
        as(
          viewer,
          (tx) => tx`update public.memberships set role = 'admin' where user_id = ${viewer.userId}`,
        ),
      ),
    ).toBe(REFUSED);
    const own = await as(
      viewer,
      (tx) =>
        tx<
          { role: string }[]
        >`select role from public.memberships where user_id = ${viewer.userId}`,
    );
    expect(own[0]?.role).toBe('viewer');
  });
});

describe('no household claim', () => {
  it('a user without an active membership reads nothing and cannot write', async () => {
    const email = `orphan-${randomUUID()}@example.test`;
    const first = await signInFresh(email);
    expect(first.householdId).not.toBeNull();

    // Arranged as the superuser: no client can soft-delete a membership.
    await adminSql`update public.memberships set deleted_at = now() where user_id = ${first.userId}`;

    await new Promise((resolve) => setTimeout(resolve, 1100)); // AUTH_EMAIL_MAX_FREQUENCY
    const orphan = await signInFresh(email);
    expect(orphan.householdId).toBeNull();
    expect(orphan.role).toBeNull();

    for (const table of TENANT_TABLES) {
      expect(await as(orphan, (tx) => tx`select * from public.${tx(table)}`)).toHaveLength(0);
    }
    const code = await refusalCode(
      as(
        orphan,
        (tx) =>
          tx`insert into public.recipes (id, household_id, title) values (${randomUUID()}, ${first.householdId}, 'Orphan write')`,
      ),
    );
    expect(code).toBe(REFUSED);
  });
});
