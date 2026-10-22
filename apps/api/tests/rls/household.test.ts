import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signInFresh, type Actor } from '../../../../test-support/auth';
import { adminSql, as } from '../helpers/db';

const fresh = () =>
  signInFresh(`hh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`);

/** The refusal key a household function raised, or 'ok'. */
async function outcome(run: Promise<unknown>): Promise<string> {
  try {
    await run;
    return 'ok';
  } catch (error) {
    return (error as { message?: string }).message ?? 'error';
  }
}

async function invite(admin: Actor, role = 'member'): Promise<string> {
  const [row] = await as(
    admin,
    (tx) => tx<{ token: string }[]>`
    select token from public.create_invite(${role}::public.household_role)`,
  );
  return row!.token;
}
const accept = (actor: Actor, token: string) =>
  as(actor, (tx) => tx`select * from public.accept_invite(${token})`);
const preview = async (actor: Actor, token: string) =>
  (
    await as(
      actor,
      (tx) => tx<Record<string, unknown>[]>`select * from public.preview_invite(${token})`,
    )
  )[0]!;
const membership = async (actor: Actor) =>
  (
    await adminSql<{ household_id: string; role: string }[]>`
    select household_id, role from public.memberships where user_id = ${actor.userId}`
  )[0]!;

describe('invites', () => {
  it('only an Admin creates one; the code is 43 characters and only its hash is stored', async () => {
    const admin = await fresh();
    const token = await invite(admin);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const stored = await adminSql<{ hit: boolean }[]>`
      select exists (select 1 from public.invites where token_hash = convert_to(${token}, 'UTF8')) as hit`;
    expect(stored[0]?.hit).toBe(false);
    const joiner = await fresh();
    await accept(joiner, await invite(admin, 'viewer'));
    expect(await outcome(invite(joiner))).toBe('forbidden');
  });

  it('works once, and says so after; expired and cancelled invites are refused', async () => {
    const admin = await fresh();
    const token = await invite(admin);
    const first = await fresh();
    const second = await fresh();
    expect(await outcome(accept(first, token))).toBe('ok');
    expect((await preview(second, token)).status).toBe('used');
    expect(await outcome(accept(second, token))).toBe('invite_used');

    const old = await invite(admin);
    await adminSql`update public.invites set expires_at = now() - interval '1 minute' where token_hash = sha256(convert_to(${old}, 'UTF8'))`;
    expect(await outcome(accept(second, old))).toBe('invite_expired');

    const cancelled = await invite(admin);
    const [row] = await adminSql<
      { id: string }[]
    >`select id from public.invites where token_hash = sha256(convert_to(${cancelled}, 'UTF8'))`;
    await as(admin, (tx) => tx`select public.cancel_invite(${row!.id})`);
    expect(await outcome(accept(second, cancelled))).toBe('invite_cancelled');
    expect(await outcome(accept(second, 'x'.repeat(43)))).toBe('invite_unknown');
  });

  it('only that household’s Admins can read its invites', async () => {
    const admin = await fresh();
    const other = await fresh();
    await invite(admin);
    expect(await as(admin, (tx) => tx`select id from public.invites`)).toHaveLength(1);
    expect(await as(other, (tx) => tx`select id from public.invites`)).toHaveLength(0);
  });

  it('refuses the creator or a member opening their own household’s link (Review Focus 3)', async () => {
    const admin = await fresh();
    const token = await invite(admin);
    expect((await preview(admin, token)).status).toBe('already_member');
    expect(await outcome(accept(admin, token))).toBe('already_member');
  });
});

describe('joining', () => {
  it('a person alone brings recipes, photos, imports, substitutions, favorites and cook logs, and their old household closes', async () => {
    const admin = await fresh();
    const joiner = await fresh();
    const recipe = randomUUID();
    const importId = randomUUID();
    const cookLog = randomUUID();
    await as(joiner, async (tx) => {
      await tx`insert into public.recipes (id, household_id, title) values (${recipe}, ${joiner.householdId}, 'My soup')`;
      await tx`insert into public.imports (id, household_id, source_type) values (${importId}, ${joiner.householdId}, 'photo')`;
      await tx`insert into public.photos (id, household_id, kind, import_id, position, recipe_id, media_type, bytes, width, height)
        values (${randomUUID()}, ${joiner.householdId}, 'page', ${importId}, 1, ${recipe}, 'image/jpeg', 10, 1, 1)`;
      await tx`insert into public.substitutions (id, household_id, recipe_id, ingredient_id, ingredient_raw, options)
        values (${randomUUID()}, ${joiner.householdId}, ${recipe}, ${randomUUID()}, '1 egg', ${tx.json([])})`;
      await tx`insert into public.favorites (id, household_id, user_id, recipe_id) values (${randomUUID()}, ${joiner.householdId}, ${joiner.userId}, ${recipe})`;
      await tx`insert into public.cook_logs (id, household_id, recipe_id, recipe_title, cooked_on)
        values (${cookLog}, ${joiner.householdId}, ${recipe}, 'My soup', '2026-10-20')`;
      await tx`insert into public.photos (id, household_id, kind, cook_log_id, position, media_type, bytes, width, height)
        values (${randomUUID()}, ${joiner.householdId}, 'cook', ${cookLog}, 1, 'image/jpeg', 10, 1, 1)`;
    });
    const token = await invite(admin);
    expect(await preview(joiner, token)).toMatchObject({
      status: 'ok',
      moving_recipes: 1,
      blocker: null,
    });
    const [result] = await as(
      joiner,
      (tx) => tx<{ moved_recipes: number; moved_photos: string[] }[]>`
      select * from public.accept_invite(${token})`,
    );
    expect(result?.moved_recipes).toBe(1);
    expect(result?.moved_photos).toHaveLength(2);
    const expected = {
      recipes: 1,
      imports: 1,
      photos: 2,
      substitutions: 1,
      favorites: 1,
      cook_logs: 1,
    };
    for (const [table, n] of Object.entries(expected)) {
      const rows = await adminSql<{ n: number }[]>`
        select count(*)::int as n from public.${adminSql(table)} where household_id = ${admin.householdId}`;
      expect([table, rows[0]?.n]).toEqual([table, n]);
    }
    const [old] = await adminSql<
      { deleted_at: Date | null }[]
    >`select deleted_at from public.households where id = ${joiner.householdId}`;
    expect(old?.deleted_at).not.toBeNull();
    expect(await membership(joiner)).toEqual({ household_id: admin.householdId, role: 'member' });
    // The admin can now see the moved recipe; the joiner's old token reads the new household live.
    expect(
      await as(admin, (tx) => tx`select id from public.recipes where id = ${recipe}`),
    ).toHaveLength(1);
  });

  it('a person from a shared household moves nothing; its only Admin is refused', async () => {
    const admin = await fresh();
    const host = await fresh();
    const guest = await fresh();
    await accept(guest, await invite(host));
    await as(
      host,
      (tx) =>
        tx`insert into public.recipes (id, household_id, title) values (${randomUUID()}, ${host.householdId}, 'Shared')`,
    );
    const token = await invite(admin);
    expect(await preview(host, token)).toMatchObject({ status: 'ok', blocker: 'only_admin' });
    expect(await outcome(accept(host, token))).toBe('only_admin');
    expect(await preview(guest, token)).toMatchObject({
      status: 'ok',
      moving_recipes: 0,
      blocker: null,
    });
    expect(await outcome(accept(guest, token))).toBe('ok');
    const left =
      await adminSql`select id from public.recipes where household_id = ${host.householdId}`;
    expect(left).toHaveLength(1);
  });
});

describe('roles, removing and leaving', () => {
  it('keeps at least one Admin', async () => {
    const admin = await fresh();
    expect(
      await outcome(
        as(admin, (tx) => tx`select public.set_member_role(${admin.userId}, 'member')`),
      ),
    ).toBe('last_admin');
    expect(await outcome(as(admin, (tx) => tx`select public.leave_household()`))).toBe('alone');
  });

  it('an Admin changes a role and removes a member, who gets a household of their own', async () => {
    const admin = await fresh();
    const member = await fresh();
    await accept(member, await invite(admin));
    await as(admin, (tx) => tx`select public.set_member_role(${member.userId}, 'viewer')`);
    expect((await membership(member)).role).toBe('viewer');
    await as(admin, (tx) => tx`select public.remove_member(${member.userId})`);
    const after = await membership(member);
    expect(after.household_id).not.toBe(admin.householdId);
    expect(after.role).toBe('admin');
  });

  it('only Admins act, only on their own household, and never on themselves by removal', async () => {
    const admin = await fresh();
    const member = await fresh();
    const stranger = await fresh();
    await accept(member, await invite(admin));
    expect(
      await outcome(as(member, (tx) => tx`select public.remove_member(${admin.userId})`)),
    ).toBe('forbidden');
    expect(
      await outcome(
        as(member, (tx) => tx`select public.set_member_role(${admin.userId}, 'viewer')`),
      ),
    ).toBe('forbidden');
    expect(
      await outcome(as(stranger, (tx) => tx`select public.remove_member(${member.userId})`)),
    ).toBe('not_member');
    expect(await outcome(as(admin, (tx) => tx`select public.remove_member(${admin.userId})`))).toBe(
      'forbidden',
    );
  });

  it('a member leaves to a household of their own; the only Admin of a shared household cannot', async () => {
    const admin = await fresh();
    const member = await fresh();
    await accept(member, await invite(admin));
    expect(await outcome(as(admin, (tx) => tx`select public.leave_household()`))).toBe(
      'only_admin',
    );
    expect(await outcome(as(member, (tx) => tx`select public.leave_household()`))).toBe('ok');
    expect((await membership(member)).household_id).not.toBe(admin.householdId);
  });

  it('two Admins demoting each other at once leave one Admin (Review Focus 2)', async () => {
    const one = await fresh();
    const two = await fresh();
    await accept(two, await invite(one, 'admin'));
    const results = await Promise.all([
      outcome(as(one, (tx) => tx`select public.set_member_role(${two.userId}, 'member')`)),
      outcome(as(two, (tx) => tx`select public.set_member_role(${one.userId}, 'member')`)),
    ]);
    expect(results.sort()).toEqual(['forbidden', 'ok'].sort());
    const admins = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.memberships where household_id = ${one.householdId} and role = 'admin'`;
    expect(admins[0]?.n).toBe(1);
  });
});

describe('review fixes', () => {
  it('a removal waiting on the lock re-checks that its caller is still in the household (Critical 1)', async () => {
    const a = await fresh();
    const b = await fresh();
    const c = await fresh();
    await accept(b, await invite(a, 'admin'));
    await accept(c, await invite(a, 'member'));
    let blocked: Promise<string> | null = null;
    await adminSql.begin(async (sql) => {
      // Hold the household's rows, as a removal of B in progress would.
      await sql`select 1 from public.memberships where household_id = ${a.householdId} for update`;
      blocked = outcome(as(b, (tx) => tx`select public.remove_member(${a.userId})`));
      await new Promise((resolve) => setTimeout(resolve, 500));
      // That removal of B completes: B now has a household of their own, as Admin.
      const [home] = await sql<
        { id: string }[]
      >`insert into public.households (name) values ('B alone') returning id`;
      await sql`update public.memberships set household_id = ${home!.id}, role = 'admin' where user_id = ${b.userId}`;
    });
    expect(await blocked!).toBe('not_member');
    const admins = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.memberships where household_id = ${a.householdId} and role = 'admin'`;
    expect(admins[0]?.n).toBe(1);
  });

  it('a closed household’s invites stop working (Important 2)', async () => {
    const host = await fresh();
    const loner = await fresh();
    const other = await fresh();
    const lonersInvite = await invite(loner);
    await accept(loner, await invite(host));
    expect((await preview(other, lonersInvite)).status).toBe('cancelled');
    expect(await outcome(accept(other, lonersInvite))).toBe('invite_cancelled');
  });

  it('joining from a shared household clears favorites of recipes left behind (Important 4)', async () => {
    const host = await fresh();
    const guest = await fresh();
    const target = await fresh();
    await accept(guest, await invite(host));
    const recipe = randomUUID();
    await as(
      host,
      (tx) =>
        tx`insert into public.recipes (id, household_id, title) values (${recipe}, ${host.householdId}, 'Theirs')`,
    );
    await as(
      guest,
      (tx) =>
        tx`insert into public.favorites (id, household_id, user_id, recipe_id) values (${randomUUID()}, ${host.householdId}, ${guest.userId}, ${recipe})`,
    );
    await accept(guest, await invite(target));
    const live =
      await adminSql`select id from public.favorites where user_id = ${guest.userId} and deleted_at is null`;
    expect(live).toHaveLength(0);
  });
});

describe('removed memberships do not count (bug batch §4)', () => {
  // A person who joined and whose membership was then soft-deleted.
  async function ghost(admin: Actor, role = 'admin'): Promise<Actor> {
    const person = await fresh();
    await accept(person, await invite(admin, role));
    await adminSql`update public.memberships set deleted_at = now() where user_id = ${person.userId}`;
    return person;
  }

  it('the last live Admin cannot step down', async () => {
    const admin = await fresh();
    await ghost(admin);
    expect(
      await outcome(
        as(admin, (tx) => tx`select public.set_member_role(${admin.userId}::uuid, 'member')`),
      ),
    ).toBe('last_admin');
  });

  it('alone with a removed member: leaving is refused, and joining brings the recipes', async () => {
    const admin = await fresh();
    await ghost(admin, 'member');
    expect(await outcome(as(admin, (tx) => tx`select public.leave_household()`))).toBe('alone');
    const id = randomUUID();
    await as(
      admin,
      (tx) =>
        tx`insert into public.recipes (id, household_id, title) values (${id}, ${admin.householdId}, 'Ghost soup')`,
    );
    const other = await fresh();
    const token = await invite(other);
    expect(await preview(admin, token)).toMatchObject({
      status: 'ok',
      moving_recipes: 1,
      blocker: null,
    });
    expect(await outcome(accept(admin, token))).toBe('ok');
    const [row] = await adminSql<{ household_id: string }[]>`
      select household_id from public.recipes where id = ${id}`;
    expect(row?.household_id).toBe(other.householdId);
  });
});
