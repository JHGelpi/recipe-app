import type { UserTx } from '../db/asUser';

// NFR-7: one monthly spend per household, shared by imports and substitutions.
// Run as the user (rule 1); RLS keeps each household to its own row.

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
 * Takes a reservation if the month's spend is under the cap, under a
 * per-household lock so parallel imports and asks are counted one at a time.
 * False at or over the cap, and nothing is added.
 */
export async function reserveSpend(
  tx: UserTx,
  capMicroUsd: number,
  reserveMicroUsd: number,
): Promise<boolean> {
  await tx`select pg_advisory_xact_lock(hashtext('ai_usage:' || (select public.auth_household_id())::text))`;
  if ((await monthSpentMicroUsd(tx)) >= capMicroUsd) return false;
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
