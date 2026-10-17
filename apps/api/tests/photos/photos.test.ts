import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { env } from '../../../../test-support/env';
import { SEED, signInAs, signInFresh, type Actor } from '../../../../test-support/auth';
import { syntheticJpeg } from '../../../../test-support/jpeg';
import { adminSql } from '../helpers/db';

const fresh = () =>
  signInFresh(`photo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`);

async function upload(actor: Actor, ops: unknown[]): Promise<void> {
  const response = await fetch(`${env.apiUrl}/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${actor.accessToken}` },
    body: JSON.stringify({ ops }),
  });
  expect(response.status).toBe(200);
}

/** A photo import with one page row of the given size; returns the page id. */
export async function pageRow(actor: Actor, width = 10, height = 10): Promise<string> {
  const importId = randomUUID();
  const id = randomUUID();
  await upload(actor, [
    {
      op: 'put',
      table: 'imports',
      id: importId,
      data: { household_id: actor.householdId, source_type: 'photo' },
    },
    {
      op: 'put',
      table: 'photos',
      id,
      data: {
        household_id: actor.householdId,
        kind: 'page',
        import_id: importId,
        position: 1,
        media_type: 'image/jpeg',
        bytes: 100,
        width,
        height,
      },
    },
  ]);
  return id;
}

function putFile(actor: Actor, id: string, body: Uint8Array<ArrayBuffer>): Promise<Response> {
  return fetch(`${env.apiUrl}/photos/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/jpeg', Authorization: `Bearer ${actor.accessToken}` },
    body,
  });
}

function getFile(actor: Actor, id: string): Promise<Response> {
  return fetch(`${env.apiUrl}/photos/${id}`, {
    headers: { Authorization: `Bearer ${actor.accessToken}` },
  });
}

describe('photo files', () => {
  it('stores a file, marks it uploaded, and serves it back to the household', async () => {
    const member = await signInAs(SEED.memberA);
    const viewer = await signInAs(SEED.viewerA);
    const id = await pageRow(member);
    const bytes = syntheticJpeg(10, 10, 'round trip');
    expect((await putFile(member, id, bytes)).status).toBe(204);
    const [row] = await adminSql<{ uploaded_at: Date | null }[]>`
      select uploaded_at from public.photos where id = ${id}`;
    expect(row?.uploaded_at).not.toBeNull();
    const response = await getFile(viewer, id);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([...bytes]);
  });

  it('never serves or accepts another household’s photo (NFR-2)', async () => {
    const member = await signInAs(SEED.memberA);
    const adminB = await signInAs(SEED.adminB);
    const id = await pageRow(member);
    await putFile(member, id, syntheticJpeg(10, 10));
    expect((await getFile(adminB, id)).status).toBe(404);
    expect((await putFile(adminB, id, syntheticJpeg(10, 10))).status).toBe(404);
  });

  it('refuses a viewer, a file before its row, a non-JPEG, a wrong size and an oversize body', async () => {
    const member = await signInAs(SEED.memberA);
    const viewer = await signInAs(SEED.viewerA);
    const id = await pageRow(member, 10, 10);
    expect((await putFile(viewer, id, syntheticJpeg(10, 10))).status).toBe(403);
    expect((await putFile(member, randomUUID(), syntheticJpeg(10, 10))).status).toBe(404);
    expect((await putFile(member, id, new TextEncoder().encode('<svg/>'))).status).toBe(415);
    expect((await putFile(member, id, syntheticJpeg(20, 10))).status).toBe(422);
    expect((await putFile(member, id, new Uint8Array(3_000_001))).status).toBe(413);
  });

  it('answers 410 for a photo dismissed while uploading', async () => {
    const member = await signInAs(SEED.memberA);
    const id = await pageRow(member);
    await upload(member, [
      { op: 'patch', table: 'photos', id, data: { deleted_at: new Date().toISOString() } },
    ]);
    expect((await putFile(member, id, syntheticJpeg(10, 10))).status).toBe(410);
  });

  it('the purge removes an expired photo’s row and its file', async () => {
    const cook = await fresh();
    const id = await pageRow(cook);
    await putFile(cook, id, syntheticJpeg(10, 10));
    await adminSql`update public.photos set deleted_at = now() - interval '31 days' where id = ${id}`;
    const purge = await fetch(`${env.apiUrl}/trash/purge`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cook.accessToken}` },
    });
    expect(purge.status).toBe(200);
    expect(await adminSql`select id from public.photos where id = ${id}`).toHaveLength(0);
    // Put the row back: the file must be gone too, so the photo still cannot be served.
    const importId = randomUUID();
    await adminSql`insert into public.imports (id, household_id, source_type) values (${importId}, ${cook.householdId}, 'photo')`;
    await adminSql`insert into public.photos (id, household_id, kind, import_id, position, media_type, bytes, width, height)
      values (${id}, ${cook.householdId}, 'page', ${importId}, 1, 'image/jpeg', 100, 10, 10)`;
    expect((await getFile(cook, id)).status).toBe(404);
  });
});
