import { describe, expect, it, vi } from 'vitest';
import { askSubstitutes } from './api';

const ask = {
  id: '11111111-1111-4111-8111-111111111111',
  recipe_id: '33333333-3333-4333-8333-333333333333',
  ingredient_id: '44444444-4444-4444-8444-444444444444',
};
const deps = (response: Response | Error) => ({
  fetch: vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  }) as unknown as typeof fetch,
  apiUrl: 'https://app.test/api',
  token: 'jwt',
});
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe('askSubstitutes', () => {
  it('posts the ask with the token and returns the answer', async () => {
    const answer = {
      options: [{ substitute: 'Yogurt', amount: '1 cup', how: '', effect: 'Tangier' }],
      note: null,
    };
    const d = deps(json(200, { ...answer, ingredient_raw: '1 cup buttermilk' }));
    expect(await askSubstitutes(ask, d)).toEqual({
      kind: 'answer',
      answer,
      ingredient_raw: '1 cup buttermilk',
    });
    expect(d.fetch).toHaveBeenCalledWith('https://app.test/api/substitutions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt' },
      body: JSON.stringify(ask),
    });
  });

  it.each([
    [402, { error: 'quota' }, "Over this month's AI limit"],
    [503, { error: 'ai_unavailable' }, "Couldn't reach the AI service. Try again."],
    [422, { error: 'invalid_output' }, "Couldn't read the suggestions. Try again."],
    [404, { error: 'not_found' }, 'This recipe is no longer on the server.'],
  ])('maps %i to its message', async (status, body, message) => {
    expect(await askSubstitutes(ask, deps(json(status, body)))).toEqual({ kind: 'error', message });
  });

  it('never throws: a network failure or an unreadable answer is a message', async () => {
    expect(await askSubstitutes(ask, deps(new Error('offline')))).toEqual({
      kind: 'error',
      message: "Couldn't get substitutes. Try again.",
    });
    expect(await askSubstitutes(ask, deps(json(200, { options: 'x' })))).toEqual({
      kind: 'error',
      message: "Couldn't read the suggestions. Try again.",
    });
  });
});

describe('a recipe the server no longer has', () => {
  it('says the recipe is gone on a 404', async () => {
    expect(await askSubstitutes(ask, deps(json(404, { error: 'not_found' })))).toEqual({
      kind: 'error',
      message: 'This recipe is no longer on the server.',
    });
  });
});
