-- migrate:up
-- In-app feedback (FR-45). Runs as app_owner. Each person files under one
-- stable anonymous id ("r-3f9a1c") that GitHub sees in place of who they are.
-- The mapping to the account stays here, for the owner only: no household
-- data, so a system table (RLS on, no policies, no grants), like signup_*.

create table public.feedback_reporters (
  user_id uuid primary key references auth.users (id) on delete cascade,
  reporter_id text not null unique check (reporter_id ~ '^r-[0-9a-f]{6}$'),
  created_at timestamptz not null default now()
);

alter table public.feedback_reporters enable row level security;
revoke all on public.feedback_reporters from public;

-- The caller's reporter id, made on first use. It takes no arguments and
-- returns only the caller's own id, so no one can look up anyone else's.
create function public.feedback_reporter_id() returns text
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := public.auth_user_id();
  found_id text;
begin
  if me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  select r.reporter_id into found_id from public.feedback_reporters r where r.user_id = me;
  -- 16 million ids: a clash with someone else's is rare, and simply tried again.
  while found_id is null loop
    insert into public.feedback_reporters (user_id, reporter_id)
    values (me, 'r-' || substr(encode(sha256(convert_to(gen_random_uuid()::text, 'UTF8')), 'hex'), 1, 6))
    on conflict do nothing;
    select r.reporter_id into found_id from public.feedback_reporters r where r.user_id = me;
  end loop;
  return found_id;
end;
$$;

revoke execute on function public.feedback_reporter_id() from public;
grant execute on function public.feedback_reporter_id() to authenticated;

-- migrate:down
drop function public.feedback_reporter_id();
drop table public.feedback_reporters;
