import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { env } from '../../../../test-support/env';
import { SEED, signInAs, signInFresh, type Actor } from '../../../../test-support/auth';
import { syntheticJpeg } from '../../../../test-support/jpeg';
import { adminSql } from '../helpers/db';

const fresh = () =>
  signInFresh(`share-api-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`);

function call(
  actor: Actor | null,
  method: string,
  path: string,
  body?: unknown,
  raw?: Uint8Array<ArrayBuffer>,
) {
  return fetch(`${env.apiUrl}${path}`, {
    method,
    headers: {
      ...(actor ? { Authorization: `Bearer ${actor.accessToken}` } : {}),
      'Content-Type': raw ? 'image/jpeg' : 'application/json',
    },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
}

/** A recipe with an uploaded dish photo; returns its id. */
async function recipeWithPhoto(actor: Actor, title: string): Promise<string> {
  const recipe = randomUUID();
  const photo = randomUUID();
  await call(actor, 'POST', '/upload', {
    ops: [
      { op: 'put', table: 'recipes', id: recipe, data: { household_id: actor.householdId, title } },
      {
        op: 'put',
        table: 'photos',
        id: photo,
        data: {
          household_id: actor.householdId,
          kind: 'dish',
          recipe_id: recipe,
          media_type: 'image/jpeg',
          bytes: 40,
          width: 4,
          height: 4,
        },
      },
      { op: 'patch', table: 'recipes', id: recipe, data: { photo_id: photo } },
    ],
  });
  expect(
    (await call(actor, 'PUT', `/photos/${photo}`, undefined, syntheticJpeg(4, 4))).status,
  ).toBe(204);
  return recipe;
}

async function shareLink(actor: Actor, recipeId: string): Promise<string> {
  const response = await call(actor, 'POST', '/shares', { recipe_id: recipeId });
  expect(response.status).toBe(201);
  return ((await response.json()) as { code: string }).code;
}

async function stop(actor: Actor, recipeId: string): Promise<void> {
  expect((await call(actor, 'POST', '/shares/stop', { recipe_id: recipeId })).status).toBe(200);
}

describe('sharing endpoints', () => {
  it('Link twice gives the same code; after Stop sharing, a new one', async () => {
    const cook = await fresh();
    const recipeId = await recipeWithPhoto(cook, 'Twice soup');
    const first = await shareLink(cook, recipeId);
    const second = await shareLink(cook, recipeId);
    expect(second).toBe(first);
    await stop(cook, recipeId);
    expect(await shareLink(cook, recipeId)).not.toBe(first);
  });

  it('shares a snapshot anyone can read, with its photo, until stopped or trashed', async () => {
    const cook = await fresh();
    const recipe = await recipeWithPhoto(cook, 'Shared stew');
    const created = await call(cook, 'POST', '/shares', { recipe_id: recipe });
    expect(created.status).toBe(201);
    const { code } = (await created.json()) as { code: string };

    const read = await call(null, 'GET', `/shares/${code}`);
    expect(read.status).toBe(200);
    expect(read.headers.get('cache-control')).toBe('no-store');
    expect(await read.json()).toMatchObject({
      snapshot: { title: 'Shared stew' },
      has_photo: true,
    });
    expect((await call(null, 'GET', `/shares/${code}/photo`)).status).toBe(200);

    await adminSql`update public.recipes set deleted_at = now() where id = ${recipe}`;
    expect(await (await call(null, 'GET', `/shares/${code}`)).json()).toEqual({
      status: 'trashed',
    });
    await adminSql`update public.recipes set deleted_at = null where id = ${recipe}`;
    expect((await call(null, 'GET', `/shares/${code}`)).status).toBe(200);

    expect(await (await call(cook, 'POST', '/shares/stop', { recipe_id: recipe })).json()).toEqual({
      stopped: 1,
    });
    expect(await (await call(null, 'GET', `/shares/${code}`)).json()).toEqual({
      status: 'stopped',
    });
  });

  it('saves a copy with its photo into another household; a viewer may not', async () => {
    const owner = await fresh();
    const saver = await fresh();
    const { code } = (await (
      await call(owner, 'POST', '/shares', {
        recipe_id: await recipeWithPhoto(owner, 'Pie to keep'),
      })
    ).json()) as { code: string };
    const saved = await call(saver, 'POST', `/shares/${code}/save`);
    expect(saved.status).toBe(201);
    const { recipe_id } = (await saved.json()) as { recipe_id: string };
    const [row] = await adminSql<
      { photo_id: string; household_id: string }[]
    >`select photo_id, household_id from public.recipes where id = ${recipe_id}`;
    expect(row?.household_id).toBe(saver.householdId);
    expect((await call(saver, 'GET', `/photos/${row!.photo_id}`)).status).toBe(200);
    const viewer = await signInAs(SEED.viewerA);
    expect((await call(viewer, 'POST', `/shares/${code}/save`)).status).toBe(403);
    expect((await call(owner, 'POST', `/shares/${code}/save`)).status).toBe(409);
  });

  it('saves without a photo when the shared photo file is missing (Review Focus 4)', async () => {
    const owner = await fresh();
    const saver = await fresh();
    const recipe = randomUUID();
    await call(owner, 'POST', '/upload', {
      ops: [
        {
          op: 'put',
          table: 'recipes',
          id: recipe,
          data: { household_id: owner.householdId, title: 'Lost photo' },
        },
      ],
    });
    const { code } = (await (
      await call(owner, 'POST', '/shares', { recipe_id: recipe })
    ).json()) as {
      code: string;
    };
    // The snapshot says there is a photo, but its file is gone.
    await adminSql`update public.shares set snapshot = jsonb_set(snapshot, '{photo}', '{"bytes": 10, "width": 1, "height": 1}')
      where recipe_id = ${recipe}`;
    const saved = await call(saver, 'POST', `/shares/${code}/save`);
    expect(saved.status).toBe(201);
    const { recipe_id } = (await saved.json()) as { recipe_id: string };
    const [row] = await adminSql<
      { photo_id: string | null }[]
    >`select photo_id from public.recipes where id = ${recipe_id}`;
    expect(row?.photo_id).toBeNull();
    const live =
      await adminSql`select id from public.photos where recipe_id = ${recipe_id} and deleted_at is null`;
    expect(live).toHaveLength(0);
  });

  it('tells a signed-in reader from the sharing household that it is already theirs (Review Focus 5)', async () => {
    const owner = await fresh();
    const other = await fresh();
    const recipe = await recipeWithPhoto(owner, 'Ours already');
    const { code } = (await (
      await call(owner, 'POST', '/shares', { recipe_id: recipe })
    ).json()) as {
      code: string;
    };
    expect(await (await call(owner, 'GET', `/shares/${code}`)).json()).toMatchObject({ own: true });
    expect(await (await call(other, 'GET', `/shares/${code}`)).json()).toMatchObject({
      own: false,
    });
    expect(await (await call(null, 'GET', `/shares/${code}`)).json()).toMatchObject({ own: false });
    const bad = await fetch(`${env.apiUrl}/shares/${code}`, {
      headers: { Authorization: 'Bearer nope' },
    });
    expect(await bad.json()).toMatchObject({ own: false });
  });
});
