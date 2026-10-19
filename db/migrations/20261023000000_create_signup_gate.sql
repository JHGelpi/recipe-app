-- migrate:up
-- Who may sign up (production spec §4; ADR-0018). Runs as app_owner.
-- GoTrue calls before_user_created_hook before it creates any account. With
-- the gate on, only listed emails and emails holding a live pass get through.
-- Passes come from live invite, share or friend links (grant_signup_pass).

create table public.signup_settings (
  id boolean primary key default true check (id), -- one row
  gate_on boolean not null default false
);
insert into public.signup_settings default values;

create table public.signup_allowed (
  email text primary key check (email = lower(btrim(email))),
  created_at timestamptz not null default now()
);

create table public.signup_passes (
  email text primary key check (email = lower(btrim(email))),
  expires_at timestamptz not null
);

-- RLS on and no policies or grants: only the functions below (owned by
-- app_owner) and the postgres login of the prod:* scripts reach these rows.
alter table public.signup_settings enable row level security;
alter table public.signup_allowed enable row level security;
alter table public.signup_passes enable row level security;
revoke all on public.signup_settings, public.signup_allowed, public.signup_passes from public;

-- "Make your own collection" links (FR-6). Not synced.
create table public.friend_links (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id),
  token_hash bytea not null unique, -- sha256 of the link's code; the code is never stored
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  deleted_at timestamptz
);
create index friend_links_household_id_idx on public.friend_links (household_id);

create trigger friend_links_stamp before insert or update on public.friend_links
for each row execute function public.stamp_row();

grant select on public.friend_links to authenticated;
alter table public.friend_links enable row level security;

create policy friend_links_select on public.friend_links
for select to authenticated
using (
  household_id = (select public.auth_household_id())
  and (select public.auth_household_role()) in ('admin', 'member')
);

create function public.create_friend_link()
returns table (id uuid, token text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  home uuid;
  code text;
  new_id uuid;
  new_expiry timestamptz;
begin
  -- Any member may invite a friend to start their own household: it adds
  -- nothing to this one, so viewers may too.
  select l.household into home from public.lock_my_household() l;
  if (select count(*) from public.friend_links f
      where f.household_id = home and f.deleted_at is null and f.expires_at > now()) >= 50 then
    perform public.household_refuse('too_many_invites');
  end if;
  code := translate(rtrim(encode(decode(
    replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'hex'), 'base64'), '='), '+/', '-_');
  insert into public.friend_links (household_id, token_hash, expires_at)
  values (home, sha256(convert_to(code, 'UTF8')), now() + interval '30 days')
  returning friend_links.id, friend_links.expires_at into new_id, new_expiry;
  return query select new_id, code, new_expiry;
end;
$$;

-- Called signed out (asAnonymous). Says only yes or no.
create function public.grant_signup_pass(link_kind text, link_code text, address text)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  who text := lower(btrim(coalesce(address, '')));
  hash bytea := sha256(convert_to(coalesce(link_code, ''), 'UTF8'));
  live boolean;
begin
  delete from public.signup_passes p where p.expires_at <= now();
  if length(who) > 254 or who !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    return false;
  end if;
  live := case link_kind
    when 'invite' then exists (
      select 1 from public.invites i
      where i.token_hash = hash and i.deleted_at is null and i.accepted_at is null
        and i.expires_at > now())
    when 'share' then coalesce((select r.status = 'ok' from public.read_share(link_code) r), false)
    when 'friend' then exists (
      select 1 from public.friend_links f
      join public.households h on h.id = f.household_id
      where f.token_hash = hash and f.deleted_at is null and f.expires_at > now()
        and h.deleted_at is null)
    else false
  end;
  if not live then return false; end if;
  insert into public.signup_passes (email, expires_at) values (who, now() + interval '24 hours')
  on conflict (email) do update set expires_at = excluded.expires_at;
  return true;
end;
$$;

-- GoTrue's before_user_created hook (pg-functions). Returning an error object
-- refuses the sign-up with that status and message.
create function public.before_user_created_hook(event jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  who text := lower(btrim(coalesce(event -> 'user' ->> 'email', '')));
begin
  if not (select s.gate_on from public.signup_settings s)
     or exists (select 1 from public.signup_allowed a where a.email = who)
     or exists (select 1 from public.signup_passes p where p.email = who and p.expires_at > now()) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'invite_only'));
end;
$$;

revoke execute on function public.create_friend_link(), public.grant_signup_pass(text, text, text),
  public.before_user_created_hook(jsonb) from public;
grant execute on function public.create_friend_link(), public.grant_signup_pass(text, text, text)
  to authenticated;
grant execute on function public.before_user_created_hook(jsonb) to supabase_auth_admin;

-- migrate:down
drop function public.before_user_created_hook(jsonb);
drop function public.grant_signup_pass(text, text, text);
drop function public.create_friend_link();
drop table public.friend_links;
drop table public.signup_passes;
drop table public.signup_allowed;
drop table public.signup_settings;
