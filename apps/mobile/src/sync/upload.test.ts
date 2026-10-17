import { describe, expect, it, vi } from 'vitest';
import { sendOps, toUploadOps, type UploadOp } from './upload';

describe('toUploadOps', () => {
  it('maps a PUT and keeps only client fields', () => {
    expect(
      toUploadOps([
        {
          op: 'PUT',
          table: 'recipes',
          id: 'r1',
          opData: {
            household_id: 'h1',
            title: 'Soup',
            created_at: null,
            updated_at: null,
            updated_by: null,
          },
        },
      ]),
    ).toEqual([
      { op: 'put', table: 'recipes', id: 'r1', data: { household_id: 'h1', title: 'Soup' } },
    ]);
  });

  it('maps a PATCH', () => {
    expect(
      toUploadOps([{ op: 'PATCH', table: 'recipes', id: 'r1', opData: { title: 'Stew' } }]),
    ).toEqual([{ op: 'patch', table: 'recipes', id: 'r1', data: { title: 'Stew' } }]);
  });

  it('drops a PATCH that only touched server-owned fields', () => {
    expect(
      toUploadOps([{ op: 'PATCH', table: 'recipes', id: 'r1', opData: { updated_at: 'x' } }]),
    ).toEqual([]);
  });

  it('passes a DELETE through so the server can refuse it', () => {
    expect(toUploadOps([{ op: 'DELETE', table: 'recipes', id: 'r1' }])).toEqual([
      { op: 'delete', table: 'recipes', id: 'r1' },
    ]);
  });

  it('sends no data for a table it does not know', () => {
    expect(toUploadOps([{ op: 'PUT', table: 'mystery', id: 'x', opData: { secret: 1 } }])).toEqual([
      { op: 'put', table: 'mystery', id: 'x', data: {} },
    ]);
  });
});

describe('sendOps', () => {
  const ops: UploadOp[] = [
    { op: 'put', table: 'recipes', id: 'r1', data: { household_id: 'h1', title: 'Soup' } },
    { op: 'put', table: 'recipes', id: 'r2', data: { household_id: 'h1', title: '' } },
  ];
  const deps = (fetchImpl: typeof fetch) => ({
    fetch: fetchImpl,
    url: 'http://api.test/api/upload',
    token: 'jwt',
  });
  const respond = (status: number, body: unknown = {}) =>
    vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body), { status }));

  it('posts the batch with the user token', async () => {
    const fetchImpl = respond(200, { results: [] });
    await sendOps(ops, deps(fetchImpl));
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('http://api.test/api/upload');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer jwt');
    expect(JSON.parse(String(init?.body))).toEqual({ ops });
  });

  it('reports rejected ops when the batch is done', async () => {
    const fetchImpl = respond(200, {
      results: [
        { id: 'r1', status: 'applied' },
        { id: 'r2', status: 'rejected', reason: 'invalid' },
      ],
    });
    expect(await sendOps(ops, deps(fetchImpl))).toEqual({
      outcome: 'done',
      rejected: [{ id: 'r2', reason: 'invalid' }],
    });
  });

  it('asks for a retry on a server error', async () => {
    expect(await sendOps(ops, deps(respond(500)))).toEqual({ outcome: 'retry' });
    expect(await sendOps(ops, deps(respond(503)))).toEqual({ outcome: 'retry' });
  });

  it('asks for a retry when the network is down', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await sendOps(ops, deps(fetchImpl))).toEqual({ outcome: 'retry' });
  });

  it('asks for re-authentication on 401', async () => {
    expect(await sendOps(ops, deps(respond(401)))).toEqual({ outcome: 'reauth' });
  });

  it('drops the whole batch on any other 4xx so the queue is not blocked', async () => {
    expect(await sendOps(ops, deps(respond(400, { error: 'invalid_body' })))).toEqual({
      outcome: 'done',
      rejected: [
        { id: 'r1', reason: 'http_400' },
        { id: 'r2', reason: 'http_400' },
      ],
    });
    expect(await sendOps(ops, deps(respond(413, { error: 'too_large' })))).toEqual({
      outcome: 'done',
      rejected: [
        { id: 'r1', reason: 'http_413' },
        { id: 'r2', reason: 'http_413' },
      ],
    });
  });

  it('asks for a retry when the proxy answers for a stopped API', async () => {
    expect(await sendOps(ops, deps(respond(502)))).toEqual({ outcome: 'retry' });
  });

  it('asks for a retry when a 200 response is not the expected shape', async () => {
    expect(await sendOps(ops, deps(respond(200, { unexpected: true })))).toEqual({
      outcome: 'retry',
    });
  });
});

describe('toUploadOps for recipe details and favorites', () => {
  it('decodes JSON text columns into arrays', () => {
    const [op] = toUploadOps([
      {
        op: 'PUT',
        table: 'recipes',
        id: 'r1',
        opData: {
          household_id: 'h1',
          title: 'Bread',
          ingredients: '[{"raw":"1 egg"}]',
          steps: '[]',
          tags: '["bread"]',
          notes: '',
        },
      },
    ]);
    expect(op?.data).toMatchObject({
      ingredients: [{ raw: '1 egg' }],
      steps: [],
      tags: ['bread'],
      notes: '',
    });
  });

  it('keeps unreadable JSON as text, so the server rejects it instead of the client crashing', () => {
    const [op] = toUploadOps([{ op: 'PATCH', table: 'recipes', id: 'r1', opData: { tags: '[' } }]);
    expect(op?.data).toEqual({ tags: '[' });
  });

  it('uploads only the client fields of a favorite', () => {
    const [op] = toUploadOps([
      {
        op: 'PUT',
        table: 'favorites',
        id: 'f1',
        opData: { household_id: 'h1', user_id: 'u1', recipe_id: 'r1', created_at: 'x' },
      },
    ]);
    expect(op).toEqual({
      op: 'put',
      table: 'favorites',
      id: 'f1',
      data: { household_id: 'h1', user_id: 'u1', recipe_id: 'r1' },
    });
  });
});

it('uploads only the client fields of an import', () => {
  const ops = toUploadOps([
    {
      op: 'PUT',
      table: 'imports',
      id: 'i1',
      opData: {
        household_id: 'h1',
        source_type: 'text',
        source_text: 'Soup',
        status: 'pending',
        created_at: '2026-10-17T10:00:00Z',
      },
    },
    {
      op: 'PATCH',
      table: 'imports',
      id: 'i1',
      opData: { recipe_id: 'r1', deleted_at: '2026-10-17T10:01:00Z' },
    },
  ]);
  expect(ops).toEqual([
    {
      op: 'put',
      table: 'imports',
      id: 'i1',
      data: { household_id: 'h1', source_type: 'text', source_text: 'Soup' },
    },
    {
      op: 'patch',
      table: 'imports',
      id: 'i1',
      data: { recipe_id: 'r1', deleted_at: '2026-10-17T10:01:00Z' },
    },
  ]);
});
