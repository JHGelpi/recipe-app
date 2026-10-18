import { randomUUID } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { env } from '../../../../test-support/env';
import { signInFresh, type Actor } from '../../../../test-support/auth';
import { adminSql } from '../helpers/db';
import { clearGateRows } from '../helpers/gate';

const used: string[] = [];
afterEach(async () => clearGateRows(used.splice(0)));

const post = (path: string, body: unknown, actor?: Actor) =>
  fetch(`${env.apiUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(actor ? { Authorization: `Bearer ${actor.accessToken}` } : {}),
    },
    body: JSON.stringify(body),
  });

it('a friend link from POST /api/friend-links grants a pass signed out; a made-up code does not', async () => {
  const owner = await signInFresh(`friend-owner-${randomUUID()}@example.test`);
  const created = await post('/friend-links', {}, owner);
  expect(created.status).toBe(201);
  const { code } = (await created.json()) as { code: string };
  const email = `friend-${randomUUID()}@example.test`;
  used.push(email);
  expect((await post('/signup-pass', { kind: 'friend', code, email })).status).toBe(204);
  expect(await adminSql`select 1 from public.signup_passes where email = ${email}`).toHaveLength(1);

  const fake = await post('/signup-pass', { kind: 'friend', code: 'z'.repeat(43), email });
  expect(fake.status).toBe(404);
  expect(await fake.json()).toEqual({ error: 'link_expired' });
});

it('friend links need a token', async () => {
  expect((await post('/friend-links', {})).status).toBe(401);
});
