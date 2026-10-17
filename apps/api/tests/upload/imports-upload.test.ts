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

const textImport = (actor: Actor, id: string, extra: object = {}) => ({
  op: 'put',
  table: 'imports',
  id,
  data: {
    household_id: actor.householdId,
    source_type: 'text',
    source_text: 'Soup\n- 1 onion',
    ...extra,
  },
});

describe('POST /api/upload, imports', () => {
  it('stores a text import as pending, and a url import', async () => {
    const member = await signInAs(SEED.memberA);
    const text = randomUUID();
    const url = randomUUID();
    const results = await upload(member, [
      textImport(member, text),
      {
        op: 'put',
        table: 'imports',
        id: url,
        data: {
          household_id: member.householdId,
          source_type: 'url',
          source_url: 'https://example.com/soup',
        },
      },
    ]);
    expect(results.map((r) => r.status)).toEqual(['applied', 'applied']);
    const rows = await as(
      member,
      (tx) => tx<{ id: string; status: string }[]>`
      select id, status from public.imports where id in (${text}, ${url}) order by id`,
    );
    expect(rows.map((r) => r.status)).toEqual(['pending', 'pending']);
  });

  it('refuses server-owned fields on a put or a patch', async () => {
    const member = await signInAs(SEED.memberA);
    const id = randomUUID();
    const [put] = await upload(member, [textImport(member, randomUUID(), { status: 'ready' })]);
    expect(put).toMatchObject({ status: 'rejected', reason: 'invalid' });
    await upload(member, [textImport(member, id)]);
    const results = await upload(member, [
      { op: 'patch', table: 'imports', id, data: { status: 'ready' } },
      { op: 'patch', table: 'imports', id, data: { draft: { title: 'x' } } },
    ]);
    expect(results.map((r) => r.reason)).toEqual(['invalid', 'invalid']);
  });

  it('dismisses through a patch, and a repeated put does not change the source', async () => {
    const member = await signInAs(SEED.memberA);
    const id = randomUUID();
    await upload(member, [textImport(member, id)]);
    await upload(member, [
      { op: 'patch', table: 'imports', id, data: { deleted_at: new Date().toISOString() } },
      textImport(member, id, { source_text: 'Changed' }),
    ]);
    const [row] = await as(
      member,
      (tx) => tx<{ source_text: string; deleted_at: Date | null }[]>`
      select source_text, deleted_at from public.imports where id = ${id}`,
    );
    expect(row?.source_text).toBe('Soup\n- 1 onion');
    expect(row?.deleted_at).not.toBeNull();
  });

  it('refuses a viewer import', async () => {
    const viewer = await signInAs(SEED.viewerA);
    const [result] = await upload(viewer, [textImport(viewer, randomUUID())]);
    expect(result).toMatchObject({ status: 'rejected', reason: 'forbidden' });
  });
});

describe('POST /api/upload, recipe source', () => {
  it('stores a recipe with its source, and refuses a source link that is not http(s)', async () => {
    const member = await signInAs(SEED.memberA);
    const good = randomUUID();
    const bad = randomUUID();
    const results = await upload(member, [
      {
        op: 'put',
        table: 'recipes',
        id: good,
        data: {
          household_id: member.householdId,
          title: 'Soup',
          source_url: 'https://example.com/soup',
          source_author: 'Jane',
          source_text: null,
        },
      },
      {
        op: 'put',
        table: 'recipes',
        id: bad,
        data: {
          household_id: member.householdId,
          title: 'Soup',
          source_url: 'javascript:alert(1)',
        },
      },
    ]);
    expect(results.map((r) => r.status)).toEqual(['applied', 'rejected']);
    const [row] = await as(
      member,
      (tx) => tx<{ source_url: string; source_author: string }[]>`
      select source_url, source_author from public.recipes where id = ${good}`,
    );
    expect(row).toEqual({ source_url: 'https://example.com/soup', source_author: 'Jane' });
  });
});
