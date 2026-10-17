import { describe, expect, it, vi } from 'vitest';
import { AiUnavailableError, type Gateway } from '../llm/gateway';
import { createSubstitutionService } from './service';

const H = '00000000-0000-0000-0000-00000000000a';
const RECIPE = '33333333-3333-4333-8333-333333333333';
const LINE = '44444444-4444-4444-8444-444444444444';
const ASK = { id: '11111111-1111-4111-8111-111111111111', recipe_id: RECIPE, ingredient_id: LINE };
const member = { sub: 'u1', household_id: H, household_role: 'member', exp: 0 };
const ingredients = [
  {
    id: LINE,
    raw: '1 cup buttermilk',
    quantity: 1,
    quantity_max: null,
    unit: 'cup',
    item: 'buttermilk',
    note: null,
    heading: false,
  },
  {
    id: 'h1',
    raw: 'For the glaze:',
    quantity: null,
    quantity_max: null,
    unit: null,
    item: '',
    note: null,
    heading: true,
  },
];
const good = {
  options: [{ substitute: 'Yogurt', amount: '1 cup yogurt', how: '', effect: 'Tangier' }],
  note: null,
};

function setup(
  over: {
    claims?: object;
    recipe?: object | null;
    spent?: number;
    call?: Gateway['callTool'];
  } = {},
) {
  const statements: string[] = [];
  const tx = vi.fn(async (strings: TemplateStringsArray) => {
    const sql = strings.join('?');
    statements.push(sql);
    if (sql.includes('from public.recipes')) {
      return over.recipe === null
        ? []
        : [over.recipe ?? { title: 'Cake', servings: 8, ingredients, steps: [] }];
    }
    if (sql.includes('from public.ai_usage')) return [{ spent: String(over.spent ?? 0) }];
    return [];
  }) as unknown as ((...args: unknown[]) => Promise<unknown>) & { json: (v: unknown) => unknown };
  (tx as { json: (v: unknown) => unknown }).json = (value) => value;
  const callTool = vi.fn(
    over.call ?? (async () => ({ input: good, usage: { inputTokens: 1000, outputTokens: 200 } })),
  );
  const service = createSubstitutionService({
    verify: vi.fn().mockResolvedValue(over.claims ?? member),
    asClaims: (async (_c: unknown, fn: (t: unknown) => Promise<unknown>) => fn(tx)) as never,
    gateway: { callTool },
    ai: { capUsd: 2, priceInputPerMTokUsd: 2, priceOutputPerMTokUsd: 10 },
    log: vi.fn(),
  });
  return { service, statements, callTool };
}

describe('substitution service', () => {
  it('answers with options, recording the spend and saving the row', async () => {
    const { service, statements, callTool } = setup();
    const outcome = await service.ask('jwt', ASK);
    expect(outcome).toEqual({ kind: 'answer', answer: good, ingredient_raw: '1 cup buttermilk' });
    expect(callTool).toHaveBeenCalledTimes(1);
    expect(statements.some((sql) => sql.includes('insert into public.ai_usage'))).toBe(true);
    expect(statements.some((sql) => sql.includes('insert into public.substitutions'))).toBe(true);
  });

  it('refuses a viewer without reading anything', async () => {
    const { service, callTool, statements } = setup({
      claims: { ...member, household_role: 'viewer' },
    });
    expect(await service.ask('jwt', ASK)).toEqual({ kind: 'forbidden' });
    expect(statements).toEqual([]);
    expect(callTool).not.toHaveBeenCalled();
  });

  it('answers missing for a recipe it cannot see, or a heading', async () => {
    expect(await setup({ recipe: null }).service.ask('jwt', ASK)).toEqual({ kind: 'missing' });
    expect(await setup().service.ask('jwt', { ...ASK, ingredient_id: 'h1' })).toEqual({
      kind: 'missing',
    });
  });

  it('stops at the cap before calling Claude', async () => {
    const { service, callTool } = setup({ spent: 2_000_000 });
    expect(await service.ask('jwt', ASK)).toEqual({ kind: 'quota' });
    expect(callTool).not.toHaveBeenCalled();
  });

  it('reports an unavailable AI, and output it cannot use (spend still recorded)', async () => {
    const down = setup({
      call: async () => {
        throw new AiUnavailableError('down');
      },
    });
    expect(await down.service.ask('jwt', ASK)).toEqual({ kind: 'ai_unavailable' });
    const bad = setup({
      call: async () => ({ input: { options: 'x' }, usage: { inputTokens: 10, outputTokens: 10 } }),
    });
    expect(await bad.service.ask('jwt', ASK)).toEqual({ kind: 'invalid_output' });
    expect(bad.statements.some((sql) => sql.includes('insert into public.ai_usage'))).toBe(true);
    expect(bad.statements.some((sql) => sql.includes('insert into public.substitutions'))).toBe(
      false,
    );
  });
});
