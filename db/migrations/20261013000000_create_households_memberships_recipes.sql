-- migrate:up
-- Households, memberships, recipes: tables, grants, RLS, triggers, token hook, publication.
-- FR-2, FR-4, FR-30, NFR-1. Runs as app_owner.

create type public.household_role as enum ('admin', 'member', 'viewer');

-- ---------------------------------------------------------------- tables

-- The tenant root. Its id is the household_id used by every other table,
-- so it has no household_id column of its own.
create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  deleted_at timestamptz
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id),
  -- unique: one household per user in v1 (SPEC §2)
  user_id uuid not null unique references auth.users (id) on delete cascade,
  role public.household_role not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  deleted_at timestamptz
);
create index memberships_household_id_idx on public.memberships (household_id);

create table public.recipes (
  id uuid primary key, -- generated on the client; no default on purpose
  household_id uuid not null references public.households (id),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  deleted_at timestamptz
);
create index recipes_household_id_idx on public.recipes (household_id);

-- ---------------------------------------------------------------- who is asking

-- The API sets request.jwt.claims for the length of one transaction (asUser).
-- With nothing set, each helper returns null and every policy denies.

create function public.auth_user_id() returns uuid
language sql stable
as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid
$$;

create function public.auth_household_id() returns uuid
language sql stable
as $$
  select nullif(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'household_id', ''
  )::uuid
$$;

create function public.auth_household_role() returns public.household_role
language sql stable
as $$
  select nullif(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'household_role', ''
  )::public.household_role
$$;

-- ---------------------------------------------------------------- token hook

-- GoTrue calls this for every access token and adds what it returns.
-- The claim is not called "role": GoTrue uses that claim itself.
create function public.custom_access_token_hook(event jsonb) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  claims jsonb := event -> 'claims';
  membership record;
begin
  select m.household_id, m.role into membership
  from public.memberships m
  where m.user_id = (event ->> 'user_id')::uuid and m.deleted_at is null;

  if found then
    claims := jsonb_set(claims, '{household_id}', to_jsonb(membership.household_id::text));
    claims := jsonb_set(claims, '{household_role}', to_jsonb(membership.role::text));
  end if;

  return jsonb_build_object('claims', claims);
end;
$$;

grant usage on schema public to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook from public;
grant execute on function public.custom_access_token_hook to supabase_auth_admin;

-- ---------------------------------------------------------------- sign-up

-- FR-2: a new account gets its own household and becomes its admin.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  new_household_id uuid;
begin
  insert into public.households (name, updated_by)
  values (coalesce(nullif(split_part(new.email, '@', 1), ''), 'My') || ' household', new.id)
  returning id into new_household_id;

  insert into public.memberships (household_id, user_id, role, updated_by)
  values (new_household_id, new.id, 'admin', new.id);

  return new;
end;
$$;

revoke execute on function public.handle_new_user from public;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- server-owned fields

-- Last-write-wins by arrival time: the server clock decides, not the device.
create function public.stamp_row() returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
  else
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  new.updated_by := public.auth_user_id();
  return new;
end;
$$;

create trigger recipes_stamp before insert or update on public.recipes
for each row execute function public.stamp_row();

create trigger households_stamp before update on public.households
for each row execute function public.stamp_row();

-- ---------------------------------------------------------------- grants

-- "authenticated" is the role asUser switches to. No delete grant anywhere:
-- delete means setting deleted_at. Memberships are read-only for clients.
grant usage on schema public to authenticated;
grant select, update on public.households to authenticated;
grant select on public.memberships to authenticated;
grant select, insert, update on public.recipes to authenticated;

-- ---------------------------------------------------------------- RLS

alter table public.households enable row level security;
alter table public.memberships enable row level security;
alter table public.recipes enable row level security;

create policy households_select on public.households
for select to authenticated
using (id = (select public.auth_household_id()));

create policy households_update on public.households
for update to authenticated
using (
  id = (select public.auth_household_id())
  and (select public.auth_household_role()) = 'admin'
)
with check (
  id = (select public.auth_household_id())
  and (select public.auth_household_role()) = 'admin'
);

-- Memberships: rows are written only by handle_new_user.
create policy memberships_select on public.memberships
for select to authenticated
using (household_id = (select public.auth_household_id()));

-- Mirrored by powersync/sync-config.yaml. Change both together.
create policy recipes_select on public.recipes
for select to authenticated
using (household_id = (select public.auth_household_id()));

create policy recipes_insert on public.recipes
for insert to authenticated
with check (
  household_id = (select public.auth_household_id())
  and (select public.auth_household_role()) in ('admin', 'member')
);

create policy recipes_update on public.recipes
for update to authenticated
using (
  household_id = (select public.auth_household_id())
  and (select public.auth_household_role()) in ('admin', 'member')
)
with check (
  household_id = (select public.auth_household_id())
  and (select public.auth_household_role()) in ('admin', 'member')
);

-- ---------------------------------------------------------------- sync

-- PowerSync replicates from a publication with this exact name, and reads
-- the published tables for its initial snapshot.
create publication powersync for table public.recipes;
grant usage on schema public to powersync_repl;
grant select on public.recipes to powersync_repl;

-- migrate:down
-- Not supported: this is the first migration. Restore from a backup instead.
