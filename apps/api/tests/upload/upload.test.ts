import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { env } from '../../../../test-support/env';
import { SEED, signInAs, type Actor } from '../../../../test-support/auth';
import { signTestToken } from '../../../../test-support/tokens';
import { as } from '../helpers/db';

type Result = { id: string; status: 'applied' | 'rejected'; reason?: string };
type Row = { title: string; household_id: string; deleted_at: Date | null; updated_by: string };

const URL = `${env.apiUrl}/upload`;

function post(token: string | null, body: unknown): Promise<Response> {
  return fetch(URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function upload(actor: Actor, ops: unknown[]): Promise<Result[]> {
  const response = await post(actor.accessToken, { ops });
  expect(response.status).toBe(200);
  return ((await response.json()) as { results: Result[] }).results;
}

async function readRecipe(actor: Actor, id: string): Promise<Row | undefined> {
  const rows = await as(
    actor,
    (tx) => tx<Row[]>`
      select title, household_id, deleted_at, updated_by from public.recipes where id = ${id}`,
  );
  return rows[0];
}

function put(actor: Actor, id: string, title: string) {
  return { op: 'put', table: 'recipes', id, data: { household_id: actor.householdId, title } };
}

describe('GET /api/health', () => {
  it('answers through the proxy', async () => {
    const response = await fetch(`${env.apiUrl}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});

describe('POST /api/upload', () => {
  it('applies a put then a patch in order', async () => {
    const member = await signInAs(SEED.memberA);
    const id = randomUUID();
    const results = await upload(member, [
      put(member, id, '  Soup  '),
      { op: 'patch', table: 'recipes', id, data: { title: 'Better soup' } },
    ]);
    expect(results).toEqual([
      { id, status: 'applied' },
      { id, status: 'applied' },
    ]);
    const row = await readRecipe(member, id);
    expect(row?.title).toBe('Better soup');
    expect(row?.updated_by).toBe(member.userId);
  });

  it('is idempotent for a repeated put', async () => {
    const member = await signInAs(SEED.memberA);
    const id = randomUUID();
    await upload(member, [put(member, id, 'Once')]);
    const again = await upload(member, [put(member, id, 'Once')]);
    expect(again).toEqual([{ id, status: 'applied' }]);
    const rows = await as(member, (tx) => tx`select id from public.recipes where id = ${id}`);
    expect(rows).toHaveLength(1);
  });

  it('soft-deletes through a patch to deleted_at', async () => {
    const member = await signInAs(SEED.memberA);
    const id = randomUUID();
    await upload(member, [put(member, id, 'To trash')]);
    const results = await upload(member, [
      { op: 'patch', table: 'recipes', id, data: { deleted_at: new Date().toISOString() } },
    ]);
    expect(results[0]?.status).toBe('applied');
    expect((await readRecipe(member, id))?.deleted_at).not.toBeNull();
  });

  it('rejects an invalid change and still applies its neighbours', async () => {
    const member = await signInAs(SEED.memberA);
    const bad = randomUUID();
    const good = randomUUID();
    const results = await upload(member, [put(member, bad, '   '), put(member, good, 'Fine')]);
    expect(results).toEqual([
      { id: bad, status: 'rejected', reason: 'invalid' },
      { id: good, status: 'applied' },
    ]);
    expect(await readRecipe(member, bad)).toBeUndefined();
    expect((await readRecipe(member, good))?.title).toBe('Fine');
  });

  it('a database refusal in the middle of a batch does not undo its neighbours', async () => {
    const a = await signInAs(SEED.memberA);
    const b = await signInAs(SEED.adminB);
    const before = randomUUID();
    const planted = randomUUID();
    const after = randomUUID();
    const results = await upload(b, [
      put(b, before, 'Before'),
      {
        op: 'put',
        table: 'recipes',
        id: planted,
        data: { household_id: a.householdId, title: 'Planted' },
      },
      put(b, after, 'After'),
    ]);
    expect(results).toEqual([
      { id: before, status: 'applied' },
      { id: planted, status: 'rejected', reason: 'forbidden' },
      { id: after, status: 'applied' },
    ]);
    expect((await readRecipe(b, before))?.title).toBe('Before');
    expect((await readRecipe(b, after))?.title).toBe('After');
    expect(await readRecipe(a, planted)).toBeUndefined();
  });

  it('rejects unknown fields, including server-owned ones', async () => {
    const member = await signInAs(SEED.memberA);
    const id = randomUUID();
    const results = await upload(member, [
      {
        op: 'put',
        table: 'recipes',
        id,
        data: { household_id: member.householdId, title: 'x', updated_by: member.userId },
      },
    ]);
    expect(results).toEqual([{ id, status: 'rejected', reason: 'invalid' }]);
  });

  it('rejects a table that is not on the allow-list', async () => {
    const admin = await signInAs(SEED.adminA);
    const id = randomUUID();
    const results = await upload(admin, [
      { op: 'put', table: 'memberships', id, data: { role: 'admin' } },
    ]);
    expect(results).toEqual([{ id, status: 'rejected', reason: 'table_not_allowed' }]);
  });

  it('rejects a hard delete', async () => {
    const member = await signInAs(SEED.memberA);
    const id = randomUUID();
    await upload(member, [put(member, id, 'Stay')]);
    const results = await upload(member, [{ op: 'delete', table: 'recipes', id }]);
    expect(results).toEqual([{ id, status: 'rejected', reason: 'delete_not_allowed' }]);
    expect((await readRecipe(member, id))?.title).toBe('Stay');
  });

  it('rejects viewer writes', async () => {
    const member = await signInAs(SEED.memberA);
    const viewer = await signInAs(SEED.viewerA);
    const existing = randomUUID();
    await upload(member, [put(member, existing, 'Read only')]);
    const fresh = randomUUID();
    const results = await upload(viewer, [
      put(viewer, fresh, 'Viewer put'),
      { op: 'patch', table: 'recipes', id: existing, data: { title: 'Viewer patch' } },
    ]);
    expect(results).toEqual([
      { id: fresh, status: 'rejected', reason: 'forbidden' },
      { id: existing, status: 'rejected', reason: 'not_found_or_forbidden' },
    ]);
    expect((await readRecipe(member, existing))?.title).toBe('Read only');
  });

  it('rejects an id collision with another household and leaves that row unchanged', async () => {
    const a = await signInAs(SEED.memberA);
    const b = await signInAs(SEED.adminB);
    const id = randomUUID();
    await upload(a, [put(a, id, 'Belongs to A')]);
    const results = await upload(b, [put(b, id, 'Overwritten by B')]);
    expect(results).toEqual([{ id, status: 'rejected', reason: 'forbidden' }]);
    const row = await readRecipe(a, id);
    expect(row?.title).toBe('Belongs to A');
    expect(row?.household_id).toBe(a.householdId);
  });

  it('a patch cannot move a recipe into another household', async () => {
    const a = await signInAs(SEED.adminA);
    const b = await signInAs(SEED.adminB);
    const id = randomUUID();
    await upload(b, [put(b, id, 'Mine')]);
    const results = await upload(b, [
      { op: 'patch', table: 'recipes', id, data: { household_id: a.householdId } },
    ]);
    expect(results).toEqual([{ id, status: 'rejected', reason: 'forbidden' }]);
    expect((await readRecipe(b, id))?.household_id).toBe(b.householdId);
  });

  it('a user with no household claims has every write rejected', async () => {
    const admin = await signInAs(SEED.adminA);
    const token = await signTestToken({ sub: randomUUID() });
    const id = randomUUID();
    const response = await post(token, {
      ops: [
        { op: 'put', table: 'recipes', id, data: { household_id: admin.householdId, title: 'x' } },
      ],
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      results: [{ id, status: 'rejected', reason: 'forbidden' }],
    });
  });

  it('returns 401 without a token, with a bad token, and with an expired token', async () => {
    expect((await post(null, { ops: [] })).status).toBe(401);
    expect((await post('not-a-jwt', { ops: [] })).status).toBe(401);
    const expired = await signTestToken({ sub: randomUUID() }, { expiresInSeconds: -60 });
    expect((await post(expired, { ops: [] })).status).toBe(401);
  });

  it('returns 400 for a malformed body', async () => {
    const member = await signInAs(SEED.memberA);
    expect((await post(member.accessToken, '{not json')).status).toBe(400);
    expect((await post(member.accessToken, {})).status).toBe(400);
    expect((await post(member.accessToken, { ops: 'nope' })).status).toBe(400);
    expect((await post(member.accessToken, { ops: [{ op: 'put' }] })).status).toBe(400);
  });

  it('returns 400 for more than 500 ops and applies none', async () => {
    const member = await signInAs(SEED.memberA);
    const ops = Array.from({ length: 501 }, () => put(member, randomUUID(), 'Bulk'));
    const firstId = (ops[0] as { id: string }).id;
    expect((await post(member.accessToken, { ops })).status).toBe(400);
    expect(await readRecipe(member, firstId)).toBeUndefined();
  });
});

describe('cross-origin access', () => {
  it('answers the preflight from the dev origin', async () => {
    const response = await fetch(URL, {
      method: 'OPTIONS',
      headers: {
        Origin: env.corsDevOrigin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type',
      },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe(env.corsDevOrigin);
    expect(response.headers.get('access-control-allow-headers')).toContain('authorization');
  });

  it('gives no allow-origin header to any other origin', async () => {
    const response = await fetch(`${env.apiUrl}/health`, {
      headers: { Origin: 'https://evil.example' },
    });
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });
});
