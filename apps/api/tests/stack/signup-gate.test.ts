import { randomUUID } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { SEED, signInFresh, authClient } from '../../../../test-support/auth';
import { adminSql } from '../helpers/db';
import { clearGateRows, setGate } from '../helpers/gate';

const used: string[] = [];
afterEach(async () => {
  await setGate(false);
  await clearGateRows(used.splice(0));
});

const client = authClient;

it('with the gate on, GoTrue refuses an unknown email with invite_only and creates no account', async () => {
  const email = `stranger-${randomUUID()}@example.test`;
  used.push(email);
  await setGate(true);
  const { error } = await client().signInWithOtp({ email });
  expect(error?.status).toBe(403);
  expect(error?.message).toContain('invite_only');
  expect(await adminSql`select 1 from auth.users where email = ${email}`).toHaveLength(0);
});

it('the same email signs up once it holds a pass; existing accounts always sign in', async () => {
  const email = `passed-${randomUUID()}@example.test`;
  used.push(email);
  await setGate(true);
  await adminSql`insert into public.signup_passes (email, expires_at) values (${email}, now() + interval '1 hour')`;
  expect((await signInFresh(email)).householdId).toMatch(/^[0-9a-f-]{36}$/);
  expect((await signInFresh(SEED.memberA)).userId).toMatch(/^[0-9a-f-]{36}$/);
});
