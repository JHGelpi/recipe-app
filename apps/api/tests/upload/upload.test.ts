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

describe('POST /api/upload, recipe details and favorites', () => {
  const ingredient = () => ({
    id: randomUUID(),
    raw: '2 cups flour',
    quantity: 2,
    quantity_max: null,
    unit: 'cup',
    item: 'flour',
    note: null,
    heading: false,
  });

  function fullPut(actor: Actor, id: string) {
    return {
      op: 'put',
      table: 'recipes',
      id,
      data: {
        household_id: actor.householdId,
        title: 'Bread',
        servings: 4,
        prep_minutes: 15,
        cook_minutes: 40,
        ingredients: [ingredient()],
        steps: [{ id: randomUUID(), text: 'Knead' }],
        tags: ['bread'],
        notes: 'From Grandma',
      },
    };
  }

  it('stores a full recipe and a patch of its ingredients', async () => {
    const member = await signInAs(SEED.memberA);
    const id = randomUUID();
    const next = [ingredient(), ingredient()];
    const results = await upload(member, [
      fullPut(member, id),
      { op: 'patch', table: 'recipes', id, data: { ingredients: next, tags: ['bread', 'quick'] } },
    ]);
    expect(results.map((result) => result.status)).toEqual(['applied', 'applied']);
    const [row] = await as(
      member,
      (tx) => tx<{ servings: number; ingredients: unknown[]; tags: string[]; notes: string }[]>`
        select servings, ingredients, tags, notes from public.recipes where id = ${id}`,
    );
    expect(row).toMatchObject({ servings: 4, tags: ['bread', 'quick'], notes: 'From Grandma' });
    expect(row?.ingredients).toHaveLength(2);
  });

  it('rejects an invalid ingredient shape and too many ingredients', async () => {
    const member = await signInAs(SEED.memberA);
    const bad = { ...fullPut(member, randomUUID()) };
    bad.data = { ...bad.data, ingredients: [{ raw: 'no id' }] as never };
    const many = fullPut(member, randomUUID());
    many.data = { ...many.data, ingredients: Array.from({ length: 201 }, ingredient) };
    const results = await upload(member, [bad, many]);
    expect(results.map((result) => result.reason)).toEqual(['invalid', 'invalid']);
  });

  it('stars, un-stars, and re-stars a recipe', async () => {
    const viewer = await signInAs(SEED.viewerA);
    const member = await signInAs(SEED.memberA);
    const recipeId = randomUUID();
    await upload(member, [fullPut(member, recipeId)]);
    const favoriteId = randomUUID();
    const data = { household_id: viewer.householdId, user_id: viewer.userId, recipe_id: recipeId };
    const results = await upload(viewer, [
      { op: 'put', table: 'favorites', id: favoriteId, data },
      {
        op: 'patch',
        table: 'favorites',
        id: favoriteId,
        data: { deleted_at: new Date().toISOString() },
      },
      { op: 'patch', table: 'favorites', id: favoriteId, data: { deleted_at: null } },
    ]);
    expect(results.map((result) => result.status)).toEqual(['applied', 'applied', 'applied']);
    const rows = await as(
      viewer,
      (tx) =>
        tx<
          { deleted_at: Date | null }[]
        >`select deleted_at from public.favorites where id = ${favoriteId}`,
    );
    expect(rows[0]?.deleted_at).toBeNull();
  });

  it('rejects a favorite of another household recipe', async () => {
    const memberA = await signInAs(SEED.memberA);
    const adminB = await signInAs(SEED.adminB);
    const recipeId = randomUUID();
    await upload(memberA, [fullPut(memberA, recipeId)]);
    const [result] = await upload(adminB, [
      {
        op: 'put',
        table: 'favorites',
        id: randomUUID(),
        data: { household_id: adminB.householdId, user_id: adminB.userId, recipe_id: recipeId },
      },
    ]);
    expect(result?.status).toBe('rejected');
  });
});

describe('POST /api/upload, recipe ratings (FR-44)', () => {
  async function newRecipe(actor: Actor): Promise<string> {
    const id = randomUUID();
    await upload(actor, [put(actor, id, 'Rated stew')]);
    return id;
  }

  function rate(actor: Actor, id: string, recipeId: string, stars: unknown) {
    return {
      op: 'put',
      table: 'recipe_ratings',
      id,
      data: { household_id: actor.householdId, user_id: actor.userId, recipe_id: recipeId, stars },
    };
  }

  async function totalsOf(actor: Actor, recipeId: string) {
    const rows = await as(
      actor,
      (tx) => tx<{ stars_total: number; ratings_count: number }[]>`
        select stars_total, ratings_count from public.recipe_rating_totals where id = ${recipeId}`,
    );
    return rows[0];
  }

  it('a viewer rates, changes, clears and rates again; the household sees the totals', async () => {
    const viewer = await signInAs(SEED.viewerA);
    const member = await signInAs(SEED.memberA);
    const recipeId = await newRecipe(member);
    const ratingId = randomUUID();
    const results = await upload(viewer, [
      rate(viewer, ratingId, recipeId, 3),
      { op: 'patch', table: 'recipe_ratings', id: ratingId, data: { stars: 5 } },
    ]);
    expect(results.map((result) => result.status)).toEqual(['applied', 'applied']);
    await upload(member, [rate(member, randomUUID(), recipeId, 2)]);
    expect(await totalsOf(member, recipeId)).toEqual({ stars_total: 7, ratings_count: 2 });

    await upload(viewer, [
      {
        op: 'patch',
        table: 'recipe_ratings',
        id: ratingId,
        data: { deleted_at: new Date().toISOString() },
      },
    ]);
    expect(await totalsOf(viewer, recipeId)).toEqual({ stars_total: 2, ratings_count: 1 });

    await upload(viewer, [
      { op: 'patch', table: 'recipe_ratings', id: ratingId, data: { deleted_at: null, stars: 4 } },
    ]);
    expect(await totalsOf(viewer, recipeId)).toEqual({ stars_total: 6, ratings_count: 2 });
  });

  it('rejects half and out-of-range stars, server-owned fields, and moving a rating', async () => {
    const member = await signInAs(SEED.memberA);
    const recipeId = await newRecipe(member);
    const ratingId = randomUUID();
    await upload(member, [rate(member, ratingId, recipeId, 4)]);
    const results = await upload(member, [
      rate(member, randomUUID(), recipeId, 0),
      rate(member, randomUUID(), recipeId, 6),
      rate(member, randomUUID(), recipeId, 3.5),
      { op: 'patch', table: 'recipe_ratings', id: ratingId, data: { updated_by: member.userId } },
      { op: 'patch', table: 'recipe_ratings', id: ratingId, data: { recipe_id: randomUUID() } },
    ]);
    expect(results.map((result) => result.reason)).toEqual([
      'invalid',
      'invalid',
      'invalid',
      'invalid',
      'invalid',
    ]);
  });

  it("rejects a rating in someone else's name, a second row, and another household's recipe", async () => {
    const member = await signInAs(SEED.memberA);
    const admin = await signInAs(SEED.adminA);
    const adminB = await signInAs(SEED.adminB);
    const recipeId = await newRecipe(member);
    const ratingId = randomUUID();
    await upload(member, [rate(member, ratingId, recipeId, 4)]);
    const results = await upload(admin, [
      {
        op: 'put',
        table: 'recipe_ratings',
        id: randomUUID(),
        data: {
          household_id: admin.householdId,
          user_id: member.userId,
          recipe_id: recipeId,
          stars: 1,
        },
      },
      { op: 'patch', table: 'recipe_ratings', id: ratingId, data: { stars: 1 } },
    ]);
    expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected']);
    const [second] = await upload(member, [rate(member, randomUUID(), recipeId, 2)]);
    expect(second?.status).toBe('rejected');
    const [other] = await upload(adminB, [rate(adminB, randomUUID(), recipeId, 5)]);
    expect(other?.status).toBe('rejected');
    expect(await totalsOf(member, recipeId)).toEqual({ stars_total: 4, ratings_count: 1 });
  });
});
