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
