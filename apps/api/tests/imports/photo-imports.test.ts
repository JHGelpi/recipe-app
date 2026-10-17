import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { env } from '../../../../test-support/env';
import { signInFresh, type Actor } from '../../../../test-support/auth';
import { syntheticJpeg } from '../../../../test-support/jpeg';
import { adminSql, as } from '../helpers/db';

const fresh = () =>
  signInFresh(`photo-import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`);

async function upload(actor: Actor, ops: unknown[]): Promise<void> {
  const response = await fetch(`${env.apiUrl}/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${actor.accessToken}` },
    body: JSON.stringify({ ops }),
  });
  expect(response.status).toBe(200);
}

/** A photo import whose pages carry `texts` in their JPEG comments. */
async function photoImport(actor: Actor, texts: string[]) {
  const id = randomUUID();
  const pages = texts.map((text) => ({ id: randomUUID(), bytes: syntheticJpeg(8, 6, text) }));
  await upload(actor, [
    {
      op: 'put',
      table: 'imports',
      id,
      data: { household_id: actor.householdId, source_type: 'photo' },
    },
    ...pages.map((page, index) => ({
      op: 'put',
      table: 'photos',
      id: page.id,
      data: {
        household_id: actor.householdId,
        kind: 'page',
        import_id: id,
        position: index + 1,
        media_type: 'image/jpeg',
        bytes: page.bytes.byteLength,
        width: 8,
        height: 6,
      },
    })),
  ]);
  return { id, pages };
}

function putFile(actor: Actor, id: string, body: Uint8Array<ArrayBuffer>): Promise<Response> {
  return fetch(`${env.apiUrl}/photos/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/jpeg', Authorization: `Bearer ${actor.accessToken}` },
    body,
  });
}

function parse(actor: Actor, id: string): Promise<Response> {
  return fetch(`${env.apiUrl}/imports/${id}/parse`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${actor.accessToken}` },
  });
}

async function settled(actor: Actor, id: string) {
  for (let i = 0; i < 100; i++) {
    const [row] = await as(
      actor,
      (tx) => tx<
        {
          status: string;
          error: string | null;
          draft: { title?: string; steps?: string[] } | null;
        }[]
      >`
        select status, error, draft from public.imports where id = ${id}`,
    );
    if (row && row.status !== 'pending' && row.status !== 'parsing') return row;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`import ${id} did not settle`);
}

describe('photo imports', () => {
  it('waits for every page, then reads them in order into a draft', async () => {
    const cook = await fresh();
    const { id, pages } = await photoImport(cook, [
      'Card Bread\n- 500 g flour',
      '1. Knead.\n2. Bake.',
    ]);
    expect((await putFile(cook, pages[0]!.id, pages[0]!.bytes)).status).toBe(204);
    const early = await parse(cook, id);
    expect(early.status).toBe(409);
    expect(await early.json()).toEqual({ error: 'photos_pending' });
    expect((await putFile(cook, pages[1]!.id, pages[1]!.bytes)).status).toBe(204);
    expect((await parse(cook, id)).status).toBe(202);
    const row = await settled(cook, id);
    expect(row.status).toBe('ready');
    expect(row.draft).toMatchObject({ title: 'Card Bread', steps: ['Knead.', 'Bake.'] });
  });

  it('fails as photo_unreadable when a page file is gone from the server', async () => {
    const cook = await fresh();
    const { id, pages } = await photoImport(cook, ['Lost Pie']);
    await adminSql`update public.photos set uploaded_at = now() where id = ${pages[0]!.id}`;
    expect((await parse(cook, id)).status).toBe(202);
    expect(await settled(cook, id)).toMatchObject({ status: 'failed', error: 'photo_unreadable' });
  });

  it('reports photos with no recipe', async () => {
    const cook = await fresh();
    const { id, pages } = await photoImport(cook, ['A cat on a sofa\nFAKE_NOT_RECIPE']);
    await putFile(cook, pages[0]!.id, pages[0]!.bytes);
    expect((await parse(cook, id)).status).toBe(202);
    expect(await settled(cook, id)).toMatchObject({ status: 'failed', error: 'not_a_recipe' });
  });
});
