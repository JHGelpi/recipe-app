import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { env } from '../../../../test-support/env';
import { SEED, signInAs, signInFresh, type Actor } from '../../../../test-support/auth';
import { syntheticJpeg } from '../../../../test-support/jpeg';
import { adminSql, as } from '../helpers/db';

type Row = {
  status: string;
  error: string | null;
  draft: Record<string, unknown> | null;
  deleted_at: Date | null;
};

const fresh = () =>
  signInFresh(`import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`);
const marker = () => `m${randomUUID().replace(/-/g, '')}`;

async function upload(actor: Actor, ops: unknown[]): Promise<void> {
  const response = await fetch(`${env.apiUrl}/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${actor.accessToken}` },
    body: JSON.stringify({ ops }),
  });
  expect(response.status).toBe(200);
}

async function textImport(actor: Actor, text: string): Promise<string> {
  const id = randomUUID();
  await upload(actor, [
    {
      op: 'put',
      table: 'imports',
      id,
      data: { household_id: actor.householdId, source_type: 'text', source_text: text },
    },
  ]);
  return id;
}

async function urlImport(actor: Actor, url: string): Promise<string> {
  const id = randomUUID();
  await upload(actor, [
    {
      op: 'put',
      table: 'imports',
      id,
      data: { household_id: actor.householdId, source_type: 'url', source_url: url },
    },
  ]);
  return id;
}

function parse(actor: Actor, id: string): Promise<Response> {
  return fetch(`${env.apiUrl}/imports/${id}/parse`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${actor.accessToken}` },
  });
}

async function settled(actor: Actor, id: string): Promise<Row> {
  for (let i = 0; i < 100; i++) {
    const [row] = await as(
      actor,
      (tx) =>
        tx<Row[]>`select status, error, draft, deleted_at from public.imports where id = ${id}`,
    );
    if (row && row.status !== 'pending' && row.status !== 'parsing') return row;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`import ${id} did not settle`);
}

async function fakeRequests(): Promise<string[]> {
  const response = await fetch(`${env.fakeAiUrl}/__requests`);
  return ((await response.json()) as { requests: string[] }).requests;
}

async function spent(actor: Actor): Promise<number> {
  const [row] = await adminSql<{ spent: string }[]>`
    select spent_microusd::text as spent from public.ai_usage
    where household_id = ${actor.householdId}
      and month = date_trunc('month', now() at time zone 'utc')::date`;
  return Number(row?.spent ?? 0);
}

const SOUP = 'Weeknight Soup\n- 1 onion\n- 2 carrots\n1. Chop.\n2. Simmer.';

describe('POST /api/imports/:id/parse', () => {
  it('parses pasted text into a draft and records the spend', async () => {
    const cook = await fresh();
    const id = await textImport(cook, SOUP);
    const response = await parse(cook, id);
    expect(response.status).toBe(202);
    const row = await settled(cook, id);
    expect(row.status).toBe('ready');
    expect(row.draft).toMatchObject({
      title: 'Weeknight Soup',
      servings: 4,
      steps: ['Chop.', 'Simmer.'],
      tags: ['fake-suggested'],
      low_confidence: ['servings'],
    });
    expect(await spent(cook)).toBe(7_000);
    const usage = await fetch(`${env.apiUrl}/imports/usage`, {
      headers: { Authorization: `Bearer ${cook.accessToken}` },
    });
    expect(await usage.json()).toEqual({ spentUsd: 0.007, capUsd: 2 });
  });

  it('a second call while parsing answers 409, and a ready import is not parsed again', async () => {
    const cook = await fresh();
    const id = await textImport(cook, `${SOUP}\nFAKE_SLOW`);
    expect((await parse(cook, id)).status).toBe(202);
    const second = await parse(cook, id);
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ status: 'parsing' });
    await settled(cook, id);
    expect((await parse(cook, id)).status).toBe(409);
  });

  it('reclaims an import stuck in parsing for over 5 minutes', async () => {
    const cook = await fresh();
    const id = await textImport(cook, SOUP);
    await adminSql`update public.imports
      set status = 'parsing', parse_started_at = now() - interval '6 minutes' where id = ${id}`;
    expect((await parse(cook, id)).status).toBe(202);
    expect((await settled(cook, id)).status).toBe('ready');
  });

  it('refuses at the monthly cap without calling the AI', async () => {
    const cook = await fresh();
    await adminSql`insert into public.ai_usage (household_id, month, spent_microusd)
      values (${cook.householdId}, date_trunc('month', now() at time zone 'utc')::date, 2000000)`;
    const tag = marker();
    const id = await textImport(cook, `${SOUP}\n${tag}`);
    await parse(cook, id);
    expect(await settled(cook, id)).toMatchObject({ status: 'failed', error: 'quota' });
    expect((await fakeRequests()).some((text) => text.includes(tag))).toBe(false);
  });

  it('records the spend of output it could not use', async () => {
    const cook = await fresh();
    const id = await textImport(cook, `${SOUP}\nFAKE_INVALID`);
    await parse(cook, id);
    expect(await settled(cook, id)).toMatchObject({ status: 'failed', error: 'invalid_output' });
    expect(await spent(cook)).toBe(7_000);
  });

  it('a non-recipe cannot be retried; an AI outage can', async () => {
    const cook = await fresh();
    const notRecipe = await textImport(cook, 'Weather today\nFAKE_NOT_RECIPE');
    await parse(cook, notRecipe);
    expect(await settled(cook, notRecipe)).toMatchObject({
      status: 'failed',
      error: 'not_a_recipe',
    });
    expect((await parse(cook, notRecipe)).status).toBe(409);

    const outage = await textImport(cook, `${SOUP}\nFAKE_OVERLOADED`);
    await parse(cook, outage);
    expect(await settled(cook, outage)).toMatchObject({
      status: 'failed',
      error: 'ai_unavailable',
    });
    expect((await parse(cook, outage)).status).toBe(202);
  });

  it('reads a JSON-LD page without the AI', async () => {
    const cook = await fresh();
    const tag = marker();
    const id = await urlImport(cook, `http://fake-ai:4010/pages/jsonld.html?t=${tag}`);
    await parse(cook, id);
    const row = await settled(cook, id);
    expect(row.status).toBe('ready');
    expect(row.draft).toMatchObject({
      title: 'Fixture Lasagna',
      author: 'Fixture Cook',
      servings: 8,
      cook_minutes: 75,
    });
    expect((await fakeRequests()).some((text) => text.includes(tag))).toBe(false);
    expect(await spent(cook)).toBe(0);
  });

  it('sends a page without JSON-LD to the AI', async () => {
    const cook = await fresh();
    const tag = marker();
    const id = await urlImport(cook, `http://fake-ai:4010/pages/plain.html?t=${tag}`);
    await parse(cook, id);
    expect((await settled(cook, id)).draft).toMatchObject({ title: 'Fixture Tomato Soup' });
    expect((await fakeRequests()).some((text) => text.includes(tag))).toBe(true);
  });

  it.each([
    ['http://fake-ai:4010/pages/redirect-private'],
    ['http://10.0.0.1/recipe'],
    ['http://localhost:3000/api/health'],
  ])('refuses %s as blocked_address', async (url) => {
    const cook = await fresh();
    const id = await urlImport(cook, url);
    await parse(cook, id);
    expect(await settled(cook, id)).toMatchObject({ status: 'failed', error: 'blocked_address' });
  });

  it('an import dismissed while parsing stays dismissed', async () => {
    const cook = await fresh();
    const id = await textImport(cook, `${SOUP}\nFAKE_SLOW`);
    expect((await parse(cook, id)).status).toBe(202);
    await upload(cook, [
      { op: 'patch', table: 'imports', id, data: { deleted_at: new Date().toISOString() } },
    ]);
    const row = await settled(cook, id);
    expect(row.deleted_at).not.toBeNull();
    expect((await parse(cook, id)).status).toBe(404);
  });

  it('a viewer gets 403, another household 404, a bad id 404, no token 401', async () => {
    const member = await signInAs(SEED.memberA);
    const viewer = await signInAs(SEED.viewerA);
    const adminB = await signInAs(SEED.adminB);
    const id = await textImport(member, `${SOUP}\nFAKE_SLOW`);
    expect((await parse(viewer, id)).status).toBe(403);
    expect((await parse(adminB, id)).status).toBe(404);
    expect((await parse(member, 'not-a-uuid')).status).toBe(404);
    expect((await fetch(`${env.apiUrl}/imports/${id}/parse`, { method: 'POST' })).status).toBe(401);
    const [row] = await as(
      member,
      (tx) => tx<{ status: string }[]>`select status from public.imports where id = ${id}`,
    );
    expect(row?.status).toBe('pending');
  });
});

describe('fake Claude, photo pages', () => {
  it('reads the comments of image blocks in page order', async () => {
    const page = (text: string) => ({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/jpeg',
        data: Buffer.from(syntheticJpeg(4, 4, text)).toString('base64'),
      },
    });
    const response = await fetch(`${env.fakeAiUrl}/v1/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'x',
        tool_choice: { type: 'auto' },
        messages: [
          {
            role: 'user',
            content: [
              page('Card Cake\n- 1 egg'),
              page('1. Bake.'),
              { type: 'text', text: 'Tags: none' },
            ],
          },
        ],
      }),
    });
    const body = (await response.json()) as {
      content: { input: { title: string; steps: string[] } }[];
    };
    expect(body.content[0]?.input).toMatchObject({ title: 'Card Cake', steps: ['Bake.'] });
    expect((await fakeRequests()).at(-1)).toBe('images:2\nCard Cake\n- 1 egg\n1. Bake.');
  });
});
