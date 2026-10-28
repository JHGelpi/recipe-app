import { randomUUID } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { signInFresh, type Actor } from '../../../../test-support/auth';
import { adminSql, as } from '../helpers/db';
import { openSyncStream, type SyncStream } from '../helpers/sync';

// Issue #65: sync scopes by live membership, as RLS does (ADR-0027), not by
// the household in the token. A removed person's still-valid token must not
// keep receiving the household's changes.
const fresh = () => signInFresh(`sync-${randomUUID()}@example.test`);
const streams: SyncStream[] = [];
afterEach(() => streams.splice(0).forEach((stream) => stream.close()));

const open = async (actor: Actor) => {
  const stream = openSyncStream(actor.accessToken);
  streams.push(stream);
  await stream.ready;
  return stream;
};

async function addRecipe(admin: Actor, title: string): Promise<string> {
  const id = randomUUID();
  await as(
    admin,
    (tx) =>
      tx`insert into public.recipes (id, household_id, title) values (${id}, ${admin.householdId}, ${title})`,
  );
  return id;
}

it('a removed member stops receiving the household within seconds, though the token is still valid', async () => {
  const admin = await fresh();
  const joiner = await fresh();
  const [invite] = await as(
    admin,
    (tx) => tx<{ token: string }[]>`select token from public.create_invite('member')`,
  );
  await as(joiner, (tx) => tx`select * from public.accept_invite(${invite!.token})`);
  // Signed in again, so the token names the household, as the phone's would.
  const member = await signInFresh(joiner.email);
  expect(member.householdId).toBe(admin.householdId);

  const adminStream = await open(admin);
  const memberStream = await open(member);
  const before = await addRecipe(admin, 'Before removal');
  expect(await memberStream.receives(before, 10_000)).toBe(true);

  await as(admin, (tx) => tx`select public.remove_member(${member.userId})`);
  const after = await addRecipe(admin, 'After removal');
  // Once the household's own stream has it, sync has processed the change.
  expect(await adminStream.receives(after, 10_000)).toBe(true);
  expect(await memberStream.receives(after, 3_000)).toBe(false);
  const [row] = await adminSql<{ household_id: string }[]>`
    select household_id from public.memberships where user_id = ${member.userId} and deleted_at is null`;
  expect(row?.household_id).not.toBe(admin.householdId);
});
