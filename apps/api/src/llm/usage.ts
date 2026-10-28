import type { UserTx } from '../db/asUser';
import type { AiConfig } from './gateway';

// NFR-7: one monthly spend per household, shared by imports and substitutions,
// and a ceiling on all households together (issue #63). Run as the user
// (rule 1); RLS keeps each household to its own row, and the total comes from
// a definer function that returns only the sum.

/** Both monthly caps, in micro-dollars. */
export type SpendCaps = { household: number; global: number };

export function spendCaps(ai: Pick<AiConfig, 'capUsd' | 'globalCapUsd'>): SpendCaps {
  return {
    household: Math.round(ai.capUsd * 1_000_000),
    global: Math.round(ai.globalCapUsd * 1_000_000),
  };
}

export async function monthSpentMicroUsd(tx: UserTx): Promise<number> {
  const [usage] = await tx<{ spent: string }[]>`
    select spent_microusd::text as spent from public.ai_usage
    where household_id = (select public.auth_household_id())
      and month = date_trunc('month', now() at time zone 'utc')::date`;
  return Number(usage?.spent ?? 0);
}

export async function recordSpend(tx: UserTx, microUsd: number): Promise<void> {
  if (microUsd <= 0) return;
  await tx`
    insert into public.ai_usage (household_id, month, spent_microusd)
    values ((select public.auth_household_id()),
            date_trunc('month', now() at time zone 'utc')::date, ${microUsd})
    on conflict (household_id, month)
    do update set spent_microusd = public.ai_usage.spent_microusd + excluded.spent_microusd`;
}

/** What one AI call is held against the cap until its real cost is known (spec §3). */
export const AI_RESERVE_MICROUSD = 50_000;

/**
 * Takes a reservation if both the household's and everyone's spend this month
 * are under their caps. One lock for all households, taken first, then the
 * household's, so parallel imports and asks anywhere are counted one at a time
 * and can't pass either cap. False at or over a cap, and nothing is added.
 */
export async function reserveSpend(
  tx: UserTx,
  caps: SpendCaps,
  reserveMicroUsd: number,
): Promise<boolean> {
  await tx`select pg_advisory_xact_lock(hashtext('ai_usage:all'))`;
  await tx`select pg_advisory_xact_lock(hashtext('ai_usage:' || (select public.auth_household_id())::text))`;
  if ((await monthSpentMicroUsd(tx)) >= caps.household) return false;
  const [all] = await tx<{ spent: string }[]>`select public.ai_month_spent_all()::text as spent`;
  if (Number(all?.spent ?? 0) >= caps.global) return false;
  await recordSpend(tx, reserveMicroUsd);
  return true;
}

/** Replaces a reservation with the real cost: adds the difference, never below zero. */
export async function settleSpend(tx: UserTx, deltaMicroUsd: number): Promise<void> {
  if (deltaMicroUsd === 0) return;
  if (deltaMicroUsd > 0) {
    await recordSpend(tx, deltaMicroUsd);
    return;
  }
  await tx`
    update public.ai_usage
    set spent_microusd = greatest(0, spent_microusd + ${deltaMicroUsd})
    where household_id = (select public.auth_household_id())
      and month = date_trunc('month', now() at time zone 'utc')::date`;
}
