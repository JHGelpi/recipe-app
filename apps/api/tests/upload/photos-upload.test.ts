import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { env } from '../../../../test-support/env';
import { SEED, signInAs, type Actor } from '../../../../test-support/auth';
import { as } from '../helpers/db';

type Result = { id: string; status: string; reason?: string };

async function upload(actor: Actor, ops: unknown[]): Promise<Result[]> {
  const response = await fetch(`${env.apiUrl}/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${actor.accessToken}` },
    body: JSON.stringify({ ops }),
  });
  expect(response.status).toBe(200);
  return ((await response.json()) as { results: Result[] }).results;
}

const photoImport = (actor: Actor, id: string) => ({
  op: 'put',
  table: 'imports',
  id,
  data: { household_id: actor.householdId, source_type: 'photo' },
});

const page = (actor: Actor, id: string, importId: string, extra: object = {}) => ({
  op: 'put',
  table: 'photos',
  id,
  data: {
    household_id: actor.householdId,
    kind: 'page',
    import_id: importId,
    position: 1,
    media_type: 'image/jpeg',
    bytes: 1000,
    width: 10,
    height: 10,
    ...extra,
  },
});

describe('POST /api/upload, photos', () => {
  it('stores a photo import with its page, not yet uploaded', async () => {
    const member = await signInAs(SEED.memberA);
    const importId = randomUUID();
    const pageId = randomUUID();
    const results = await upload(member, [
      photoImport(member, importId),
      page(member, pageId, importId),
    ]);
    expect(results.map((r) => r.status)).toEqual(['applied', 'applied']);
    const [row] = await as(
      member,
      (tx) => tx<{ kind: string; uploaded_at: Date | null }[]>`
        select kind, uploaded_at from public.photos where id = ${pageId}`,
    );
    expect(row).toEqual({ kind: 'page', uploaded_at: null });
  });

  it('refuses uploaded_at from the phone, and a page of another household’s import', async () => {
    const member = await signInAs(SEED.memberA);
    const adminB = await signInAs(SEED.adminB);
    const theirs = randomUUID();
    await upload(adminB, [photoImport(adminB, theirs)]);
    const results = await upload(member, [
      page(member, randomUUID(), theirs),
      page(member, randomUUID(), theirs, { uploaded_at: new Date().toISOString() }),
    ]);
    expect(results.map((r) => r.reason)).toEqual(['forbidden', 'invalid']);
  });

  it('a repeated put keeps a dismissal; a patch moves a page to a recipe', async () => {
    const member = await signInAs(SEED.memberA);
    const importId = randomUUID();
    const pageId = randomUUID();
    const recipeId = randomUUID();
    await upload(member, [photoImport(member, importId), page(member, pageId, importId)]);
    await upload(member, [
      { op: 'patch', table: 'photos', id: pageId, data: { deleted_at: new Date().toISOString() } },
      page(member, pageId, importId),
      {
        op: 'put',
        table: 'recipes',
        id: recipeId,
        data: { household_id: member.householdId, title: 'From a card', photo_id: pageId },
      },
      { op: 'patch', table: 'photos', id: pageId, data: { recipe_id: recipeId } },
    ]);
    const [row] = await as(
      member,
      (tx) => tx<{ deleted_at: Date | null; recipe_id: string; photo_id: string }[]>`
        select p.deleted_at, p.recipe_id, r.photo_id
        from public.photos p join public.recipes r on r.id = p.recipe_id
        where p.id = ${pageId}`,
    );
    expect(row?.deleted_at).not.toBeNull();
    expect([row?.recipe_id, row?.photo_id]).toEqual([recipeId, pageId]);
  });

  it('refuses a viewer’s photo', async () => {
    const member = await signInAs(SEED.memberA);
    const viewer = await signInAs(SEED.viewerA);
    const importId = randomUUID();
    await upload(member, [photoImport(member, importId)]);
    const [result] = await upload(viewer, [page(viewer, randomUUID(), importId)]);
    expect(result).toMatchObject({ status: 'rejected', reason: 'forbidden' });
  });
});
