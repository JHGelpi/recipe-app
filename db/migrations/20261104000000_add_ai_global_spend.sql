-- migrate:up
-- A spend ceiling for the whole deployment (NFR-7, issue #63). Runs as app_owner.
-- Each household has its own monthly cap, but households are created on
-- demand, so without a total the bill grew with every new account. The API
-- checks this sum against AI_GLOBAL_MONTHLY_CAP_USD before each AI call.

-- This month's AI spend across every household, in micro-dollars. RLS keeps
-- ai_usage to the caller's own household, so only a definer function can add
-- the others; it returns the total and nothing about any one household.
create function public.ai_month_spent_all() returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(u.spent_microusd), 0)::bigint from public.ai_usage u
  where u.month = date_trunc('month', now() at time zone 'utc')::date;
$$;

revoke execute on function public.ai_month_spent_all() from public;
grant execute on function public.ai_month_spent_all() to authenticated;

-- migrate:down
drop function public.ai_month_spent_all();
