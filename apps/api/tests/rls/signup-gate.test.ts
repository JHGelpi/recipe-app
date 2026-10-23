import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { SEED, signInAs, signInFresh, type Actor } from '../../../../test-support/auth';
import { adminSql, as, refusalCode } from '../helpers/db';
import { asAnonymous } from '../helpers/anonymous';
import { allow, clearGateRows, setGate } from '../helpers/gate';

const address = (tag: string) => `${tag}-${randomUUID()}@example.test`;
const used: string[] = [];
afterEach(async () => {
  await setGate(false);
  await clearGateRows(used.splice(0));
});

async function hook(email: string): Promise<unknown> {
  const [row] = await adminSql<{ out: unknown }[]>`
    select public.before_user_created_hook(${adminSql.json({ user: { email } })}) as out`;
  return row!.out;
}
const REFUSED = { error: { http_code: 403, message: 'invite_only' } };

async function grant(kind: string, code: string, email: string): Promise<boolean> {
  const [row] = await asAnonymous(
    (tx) =>
      tx<{ ok: boolean }[]>`select public.grant_signup_pass(${kind}, ${code}, ${email}) as ok`,
  );
  return row!.ok;
}

async function inviteCode(admin: Actor): Promise<string> {
  const [row] = await as(
    admin,
    (tx) => tx<{ token: string }[]>`select token from public.create_invite('member')`,
  );
  return row!.token;
}

async function friendCode(actor: Actor): Promise<string> {
  const [row] = await as(
    actor,
    (tx) => tx<{ token: string }[]>`select token from public.create_friend_link()`,
  );
  return row!.token;
}

async function outcome(run: Promise<unknown>): Promise<string> {
  try {
    await run;
    return 'ok';
  } catch (error) {
    return (error as { message?: string }).message ?? 'error';
  }
}

async function linkStatus(code: string): Promise<string> {
  const [row] = await asAnonymous(
    (tx) => tx<{ status: string }[]>`select public.friend_link_status(${code}) as status`,
  );
  return row!.status;
}

async function linkId(code: string): Promise<string> {
  const [row] = await adminSql<{ id: string }[]>`
    select id from public.friend_links where token_hash = sha256(convert_to(${code}, 'UTF8'))`;
  return row!.id;
}

describe('the sign-up gate hook', () => {
  it('lets everyone through while the gate is off', async () => {
    expect(await hook(address('open'))).toEqual({});
  });

  it('with the gate on, allows listed emails and live passes, ignoring case and spaces', async () => {
    const listed = address('listed');
    const passed = address('passed');
    used.push(listed, passed);
    await setGate(true);
    await allow(listed);
    await adminSql`insert into public.signup_passes (email, expires_at)
      values (${passed}, now() + interval '1 hour')`;
    expect(await hook(`  ${listed.toUpperCase()} `)).toEqual({});
    expect(await hook(passed)).toEqual({});
    expect(await hook(address('stranger'))).toEqual(REFUSED);
  });

  it('refuses an expired pass', async () => {
    const late = address('late');
    used.push(late);
    await setGate(true);
    await adminSql`insert into public.signup_passes (email, expires_at)
      values (${late}, now() - interval '1 minute')`;
    expect(await hook(late)).toEqual(REFUSED);
  });
});

describe('passes from links', () => {
  it('a live invite, share or friend code grants a 24-hour pass to the lowercased email', async () => {
    const admin = await signInFresh(address('pass-admin'));
    const email = address('Invited');
    used.push(email);
    expect(await grant('invite', await inviteCode(admin), ` ${email.toUpperCase()}`)).toBe(true);
    const [row] = await adminSql<{ email: string; hours: number }[]>`
      select email, extract(epoch from expires_at - now()) / 3600 as hours
      from public.signup_passes where email = ${email.toLowerCase()}`;
    expect(row?.email).toBe(email.toLowerCase());
    expect(Number(row!.hours)).toBeGreaterThan(23.9);

    const recipe = randomUUID();
    await as(
      admin,
      (tx) => tx`insert into public.recipes (id, household_id, title)
      values (${recipe}, ${admin.householdId}, 'Pass soup')`,
    );
    const [share] = await as(
      admin,
      (tx) => tx<{ token: string }[]>`
      select token from public.create_share(${randomUUID()}, ${recipe}, ${tx.json({ title: 'Pass soup' })})`,
    );
    expect(await grant('share', share!.token, email)).toBe(true);
    expect(await grant('friend', await friendCode(admin), email)).toBe(true);
  });

  it('dead codes, wrong kinds and bad emails grant nothing', async () => {
    const admin = await signInFresh(address('dead-admin'));
    const email = address('nobody');
    used.push(email);
    const invite = await inviteCode(admin);
    await adminSql`update public.invites set deleted_at = now()
      where token_hash = sha256(convert_to(${invite}, 'UTF8'))`;
    expect(await grant('invite', invite, email)).toBe(false);
    const friend = await friendCode(admin);
    await adminSql`update public.friend_links set expires_at = now() - interval '1 second'
      where token_hash = sha256(convert_to(${friend}, 'UTF8'))`;
    expect(await grant('friend', friend, email)).toBe(false);
    expect(await grant('share', 'x'.repeat(43), email)).toBe(false);
    expect(await grant('household', await friendCode(admin), email)).toBe(false);
    expect(await grant('friend', await friendCode(admin), 'not-an-email')).toBe(false);
    expect(await adminSql`select 1 from public.signup_passes where email = ${email}`).toHaveLength(
      0,
    );
  });

  it('expired passes are cleared whenever a pass is granted', async () => {
    const stale = address('stale');
    used.push(stale);
    await adminSql`insert into public.signup_passes (email, expires_at)
      values (${stale}, now() - interval '1 hour')`;
    await grant('share', 'x'.repeat(43), address('any'));
    expect(await adminSql`select 1 from public.signup_passes where email = ${stale}`).toHaveLength(
      0,
    );
  });
});

describe('who can reach the gate tables', () => {
  it('nobody signed in, and no anonymous caller, can read or write them', async () => {
    const admin = await signInAs(SEED.adminA);
    for (const table of ['signup_settings', 'signup_allowed', 'signup_passes']) {
      expect(await refusalCode(as(admin, (tx) => tx`select * from public.${tx(table)}`))).toBe(
        '42501',
      );
      expect(await refusalCode(asAnonymous((tx) => tx`select * from public.${tx(table)}`))).toBe(
        '42501',
      );
    }
    expect(
      await refusalCode(
        as(admin, (tx) => tx`insert into public.signup_allowed (email) values ('x@y.z')`),
      ),
    ).toBe('42501');
  });
});

describe('friend links', () => {
  it('any member, viewers included, can make, list and revoke one; another household cannot revoke it', async () => {
    const viewer = await signInAs(SEED.viewerA);
    const adminB = await signInAs(SEED.adminB);
    const code = await friendCode(viewer);
    const id = await linkId(code);
    const listed = await as(
      viewer,
      (tx) => tx<{ id: string; household_id: string }[]>`
      select id, household_id from public.friend_links`,
    );
    expect(listed.some((row) => row.id === id)).toBe(true);
    expect(listed.every((row) => row.household_id === viewer.householdId)).toBe(true);
    const revoke = (actor: Actor) =>
      outcome(as(actor, (tx) => tx`select public.revoke_friend_link(${id}::uuid)`));

    expect(await revoke(adminB)).toBe('link_unknown');
    expect(await linkStatus(code)).toBe('live');
    expect(await revoke(viewer)).toBe('ok');
    expect(await linkStatus(code)).toBe('ended');
    const late = address('late-friend');
    used.push(late);
    expect(await grant('friend', code, late)).toBe(false);
    expect(await revoke(viewer)).toBe('link_unknown');
  });

  it('works once: the first address holds it, and its new account uses it up (FR-42)', async () => {
    const admin = await signInFresh(address('single-admin'));
    const code = await friendCode(admin);
    const first = address('first-friend');
    const second = address('second-friend');
    used.push(first, second);
    expect(await grant('friend', code, first)).toBe(true);
    expect(await grant('friend', code, second)).toBe(false);
    // Asking again (a second code email) keeps the hold.
    expect(await grant('friend', code, first)).toBe(true);
    expect(await linkStatus(code)).toBe('live');

    const friend = await signInFresh(first);
    const [link] = await adminSql<
      { accepted_by: string; accepted_email: string; accepted: boolean }[]
    >`select accepted_by, accepted_email, accepted_at is not null as accepted
      from public.friend_links where token_hash = sha256(convert_to(${code}, 'UTF8'))`;
    expect(link).toEqual({ accepted_by: friend.userId, accepted_email: first, accepted: true });
    expect(await linkStatus(code)).toBe('used');
    expect(await grant('friend', code, second)).toBe(false);
    expect(await grant('friend', code, first)).toBe(false);
    const id = await linkId(code);
    expect(
      await outcome(as(admin, (tx) => tx`select public.revoke_friend_link(${id}::uuid)`)),
    ).toBe('link_unknown');
  });

  it('two addresses asking at once: exactly one gets the pass', async () => {
    const admin = await signInFresh(address('race-admin'));
    const code = await friendCode(admin);
    const a = address('race-a');
    const b = address('race-b');
    used.push(a, b);
    const results = await Promise.all([grant('friend', code, a), grant('friend', code, b)]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('a hold lapses with its pass, so an address that never signed up does not use the link', async () => {
    const admin = await signInFresh(address('lapse-admin'));
    const code = await friendCode(admin);
    const typo = address('typo-friend');
    const real = address('real-friend');
    used.push(typo, real);
    expect(await grant('friend', code, typo)).toBe(true);
    await adminSql`update public.signup_passes set expires_at = now() - interval '1 second'
      where email = ${typo}`;
    expect(await grant('friend', code, real)).toBe(true);
  });

  it('someone who already has an account signs in through it without holding it', async () => {
    const admin = await signInFresh(address('existing-admin'));
    const code = await friendCode(admin);
    const fresh = address('fresh-friend');
    used.push(SEED.memberA, fresh);
    expect(await grant('friend', code, SEED.memberA)).toBe(true);
    expect(await grant('friend', code, fresh)).toBe(true);
  });

  it('Admins see and revoke every link; Members and Viewers only their own (#33)', async () => {
    const admin = await signInFresh(address('vis-admin'));
    const joinAs = async (role: string) => {
      const [row] = await as(
        admin,
        (tx) =>
          tx<
            { token: string }[]
          >`select token from public.create_invite(${role}::public.household_role)`,
      );
      const person = await signInFresh(address(`vis-${role}`));
      await as(person, (tx) => tx`select * from public.accept_invite(${row!.token})`);
      return signInAs(person.email);
    };
    const member = await joinAs('member');
    const viewer = await joinAs('viewer');
    const ids = {
      admin: await linkId(await friendCode(admin)),
      member: await linkId(await friendCode(member)),
      viewer: await linkId(await friendCode(viewer)),
    };
    const seen = async (actor: Actor) =>
      (await as(actor, (tx) => tx<{ id: string }[]>`select id from public.friend_links`))
        .map((row) => row.id)
        .sort();
    const revoke = (actor: Actor, id: string) =>
      outcome(as(actor, (tx) => tx`select public.revoke_friend_link(${id}::uuid)`));

    expect(await seen(admin)).toEqual(Object.values(ids).sort());
    expect(await seen(member)).toEqual([ids.member]);
    expect(await seen(viewer)).toEqual([ids.viewer]);
    expect(await revoke(member, ids.viewer)).toBe('link_unknown');
    expect(await revoke(viewer, ids.admin)).toBe('link_unknown');
    expect(await revoke(viewer, ids.viewer)).toBe('ok');
    expect(await revoke(admin, ids.member)).toBe('ok');

    // Live roles (ADR-0015): demoted, the old Admin sees only their own at once.
    await adminSql`update public.memberships set role = 'member' where user_id = ${admin.userId}`;
    expect(await seen(admin)).toEqual([ids.admin]);
    expect(await revoke(admin, ids.viewer)).toBe('link_unknown');
  });

  it('records who made a link', async () => {
    const maker = await signInFresh(address('maker'));
    const id = await linkId(await friendCode(maker));
    const [row] = await adminSql<{ created_by: string }[]>`
      select created_by from public.friend_links where id = ${id}`;
    expect(row?.created_by).toBe(maker.userId);
  });

  it('signed out, a link reads as live, ended once expired, or unknown', async () => {
    const admin = await signInFresh(address('status-admin'));
    const code = await friendCode(admin);
    expect(await linkStatus(code)).toBe('live');
    await adminSql`update public.friend_links set expires_at = now() - interval '1 second'
      where token_hash = sha256(convert_to(${code}, 'UTF8'))`;
    expect(await linkStatus(code)).toBe('ended');
    expect(await linkStatus('z'.repeat(43))).toBe('unknown');
  });
});
