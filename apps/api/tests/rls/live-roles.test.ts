import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { signInFresh, type Actor } from '../../../../test-support/auth';
import { adminSql, as, refusalCode } from '../helpers/db';

const REFUSED = '42501';
const fresh = () =>
  signInFresh(`live-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`);

const moved: { user: string; household: string }[] = [];
afterEach(async () => {
  // Put anyone a test moved by hand back where the token hook expects them.
  for (const { user, household } of moved.splice(0)) {
    await adminSql`update public.memberships set household_id = ${household}, role = 'admin' where user_id = ${user}`;
  }
});

async function addRecipe(actor: Actor) {
  return as(
    actor,
    (tx) => tx`insert into public.recipes (id, household_id, title)
    values (${randomUUID()}, ${actor.householdId}, 'Live test')`,
  );
}

describe('live role checks (spec §3)', () => {
  it('a demotion takes effect on the next statement, with the same token', async () => {
    const cook = await fresh();
    await addRecipe(cook);
    await adminSql`update public.memberships set role = 'viewer' where user_id = ${cook.userId}`;
    moved.push({ user: cook.userId, household: cook.householdId! });
    expect(await refusalCode(addRecipe(cook))).toBe(REFUSED);
  });

  it('a move to another household takes effect at once, whatever the token says', async () => {
    const a = await fresh();
    const b = await fresh();
    await addRecipe(a);
    await adminSql`update public.memberships set household_id = ${b.householdId}, role = 'member' where user_id = ${a.userId}`;
    moved.push({ user: a.userId, household: a.householdId! });
    const seen = await as(
      a,
      (tx) => tx<{ household_id: string }[]>`select household_id from public.recipes`,
    );
    expect(seen.every((row) => row.household_id === b.householdId)).toBe(true);
  });
});

describe('memberships', () => {
  it('records the email at sign-in, and a user can always read their own row', async () => {
    const cook = await fresh();
    const rows = await as(
      cook,
      (tx) => tx<{ email: string | null; user_id: string }[]>`
      select email, user_id from public.memberships where user_id = ${cook.userId}`,
    );
    expect(rows).toEqual([{ email: cook.email, user_id: cook.userId }]);
  });

  it('household members can read each other, and no one else', async () => {
    const a = await fresh();
    const b = await fresh();
    const seen = await as(
      a,
      (tx) => tx<{ user_id: string }[]>`select user_id from public.memberships`,
    );
    expect(seen.map((row) => row.user_id)).toEqual([a.userId]);
    expect(seen.map((row) => row.user_id)).not.toContain(b.userId);
  });
});

describe('tokens', () => {
  it('last 10 minutes', async () => {
    const cook = await fresh();
    const payload = JSON.parse(
      Buffer.from(cook.accessToken.split('.')[1]!, 'base64url').toString(),
    ) as {
      exp: number;
      iat: number;
    };
    expect(payload.exp - payload.iat).toBe(600);
  });
});
