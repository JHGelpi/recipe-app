import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { env } from '../../../../test-support/env';
import { SEED, signInAs, signInFresh, type Actor } from '../../../../test-support/auth';
import { adminSql, as } from '../helpers/db';

const URL = `${env.apiUrl}/trash/purge`;

async function trashedRecipe(actor: Actor, daysAgo: number): Promise<string> {
  const id = randomUUID();
  await as(
    actor,
    (tx) =>
      tx`insert into public.recipes (id, household_id, title) values (${id}, ${actor.householdId}, 'Old stew')`,
  );
  await adminSql`update public.recipes set deleted_at = now() - make_interval(days => ${daysAgo}) where id = ${id}`;
  return id;
}

async function exists(id: string): Promise<boolean> {
  return (await adminSql`select 1 from public.recipes where id = ${id}`).length === 1;
}

function purge(token: string | null): Promise<Response> {
  return fetch(URL, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

describe('POST /api/trash/purge', () => {
  it('deletes only expired trash in the caller household', async () => {
    const memberA = await signInAs(SEED.memberA);
    const adminB = await signInAs(SEED.adminB);
    const expired = await trashedRecipe(memberA, 31);
    const recent = await trashedRecipe(memberA, 5);
    const otherHousehold = await trashedRecipe(adminB, 31);

    const response = await purge(memberA.accessToken);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { purged: number };
    expect(body.purged).toBeGreaterThanOrEqual(1);
    expect(await exists(expired)).toBe(false);
    expect(await exists(recent)).toBe(true);
    expect(await exists(otherHousehold)).toBe(true);
  });

  it('a viewer purges nothing (in a household of its own, so no parallel purge can interfere)', async () => {
    const tag = () => `purge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
    const admin = await signInFresh(tag());
    const invited = await fetch(`${env.apiUrl}/invites`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${admin.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'viewer' }),
    });
    const { code } = (await invited.json()) as { code: string };
    const joiner = await signInFresh(tag());
    const joined = await fetch(`${env.apiUrl}/invites/accept`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${joiner.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token: code }),
    });
    expect(joined.status).toBe(200);
    const viewer = await signInFresh(joiner.email);
    expect(viewer.role).toBe('viewer');
    const expired = await trashedRecipe(admin, 31);
    const response = await purge(viewer.accessToken);
    expect(await response.json()).toEqual({ purged: 0 });
    expect(await exists(expired)).toBe(true);
  });

  it('refuses a request without a token', async () => {
    expect((await purge(null)).status).toBe(401);
  });
});
