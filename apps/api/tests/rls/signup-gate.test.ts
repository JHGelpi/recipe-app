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
  it('any member, viewers included, can make one; only admins and members can list them', async () => {
    const viewer = await signInAs(SEED.viewerA);
    const member = await signInAs(SEED.memberA);
    expect(await friendCode(viewer)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await as(viewer, (tx) => tx`select id from public.friend_links`)).toHaveLength(0);
    const rows = await as(
      member,
      (tx) => tx<{ household_id: string }[]>`
      select household_id from public.friend_links`,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.household_id === member.householdId)).toBe(true);
  });
});
