import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signInFresh, type Actor } from '../../../../test-support/auth';
import { AI_RESERVE_MICROUSD, reserveSpend } from '../../src/llm/usage';
import { adminSql, as } from '../helpers/db';

// Issue #63: a ceiling on every household's AI spend together. The dev
// database keeps a month of test spend, so caps here are set relative to the
// current total, never to a fixed amount.

const fresh = () => signInFresh(`ceiling-${randomUUID()}@example.test`);
const HOUSEHOLD_CAP = 2_000_000;

async function totalNow(): Promise<number> {
  const [row] = await adminSql<{ spent: string }[]>`
    select coalesce(sum(spent_microusd), 0)::text as spent from public.ai_usage
    where month = date_trunc('month', now() at time zone 'utc')::date`;
  return Number(row!.spent);
}

const reserve = (actor: Actor, global: number) =>
  as(actor, (tx) => reserveSpend(tx, { household: HOUSEHOLD_CAP, global }, AI_RESERVE_MICROUSD));

async function ownSpend(actor: Actor): Promise<number> {
  const [row] = await as(
    actor,
    (tx) => tx<{ spent: string }[]>`select coalesce(sum(spent_microusd), 0)::text as spent
      from public.ai_usage`,
  );
  return Number(row!.spent);
}

describe('the global AI ceiling (#63)', () => {
  it('a member reads only the total across households, through the definer function', async () => {
    const actor = await fresh();
    const [row] = await as(
      actor,
      (tx) => tx<{ spent: string }[]>`select public.ai_month_spent_all()::text as spent`,
    );
    expect(Number(row!.spent)).toBe(await totalNow());
    // Their own rows only: a new household has none.
    expect(await ownSpend(actor)).toBe(0);
  });

  it('refuses a household under its own cap once everyone together reaches the ceiling', async () => {
    const actor = await fresh();
    expect(await reserve(actor, await totalNow())).toBe(false);
    expect(await ownSpend(actor)).toBe(0);

    expect(await reserve(actor, (await totalNow()) + 1_000_000)).toBe(true);
    expect(await ownSpend(actor)).toBe(AI_RESERVE_MICROUSD);
  });

  it('two households reserving at once with room for one: exactly one gets it', async () => {
    const [a, b] = await Promise.all([fresh(), fresh()]);
    const ceiling = (await totalNow()) + 1;
    const results = await Promise.all([reserve(a, ceiling), reserve(b, ceiling)]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});
