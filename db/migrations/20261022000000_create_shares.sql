-- migrate:up
-- Sharing out (FR-26, FR-27, NFR-2; ADR-0016). Runs as app_owner.
-- A share is a snapshot of a recipe behind a hashed link code. Links are read
-- without an account through read_share only; every policy still denies an
-- anonymous caller.

create table public.shares (
  id uuid primary key,
  household_id uuid not null references public.households (id),
  recipe_id uuid not null,
  token_hash bytea not null unique,
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  deleted_at timestamptz, -- set when stopped
  foreign key (recipe_id, household_id) references public.recipes (id, household_id)
    on delete cascade deferrable initially immediate
);
create index shares_household_id_idx on public.shares (household_id);
create index shares_recipe_id_idx on public.shares (recipe_id);

create trigger shares_stamp before insert or update on public.shares
for each row execute function public.stamp_row();

-- Read by the household; deleted only by the 30-day purge; written only by
-- the functions below.
grant select, delete on public.shares to authenticated;
alter table public.shares enable row level security;

-- Mirrored by powersync/sync-config.yaml (household_shares). Change both together.
create policy shares_select on public.shares
for select to authenticated
using (household_id = (select public.auth_household_id()));

create policy shares_purge on public.shares
for delete to authenticated
using (
  household_id = (select public.auth_household_id())
  and (select public.auth_household_role()) in ('admin', 'member')
  and (
    (deleted_at is not null and deleted_at < now() - interval '30 days')
    or exists (select 1 from public.recipes r where r.id = recipe_id and r.deleted_at < now() - interval '30 days')
  )
);

-- ---------------------------------------------------------------- functions

-- Any member, viewers too (SPEC §2): the recipe must be live and theirs.
create function public.create_share(share_id uuid, recipe uuid, snap jsonb)
returns table (id uuid, token text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  home uuid := public.auth_household_id();
  code text;
begin
  if home is null or not exists (
       select 1 from public.recipes r where r.id = recipe and r.household_id = home and r.deleted_at is null) then
    perform public.household_refuse('forbidden');
  end if;
  code := translate(rtrim(encode(decode(
    replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'hex'), 'base64'), '='), '+/', '-_');
  insert into public.shares (id, household_id, recipe_id, token_hash, snapshot)
  values (share_id, home, recipe, sha256(convert_to(code, 'UTF8')), snap);
  return query select share_id, code;
end;
$$;

create function public.stop_shares(recipe uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare
  stopped int;
begin
  -- coalesce: with no claims the role is null, and "null not in (…)" is not true.
  if coalesce(public.auth_household_role()::text, '') not in ('admin', 'member') or not exists (
       select 1 from public.recipes r where r.id = recipe and r.household_id = public.auth_household_id()) then
    perform public.household_refuse('forbidden');
  end if;
  update public.shares s set deleted_at = now()
  where s.recipe_id = recipe and s.household_id = public.auth_household_id() and s.deleted_at is null;
  get diagnostics stopped = row_count;
  return stopped;
end;
$$;

-- Callable with no claims at all: returns one snapshot by its code, and
-- nothing about anything else (NFR-2).
create function public.read_share(code text)
returns table (status text, snapshot jsonb, share_id uuid, household_id uuid)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  s public.shares;
begin
  select * into s from public.shares sh where sh.token_hash = sha256(convert_to(code, 'UTF8'));
  if not found then return query select 'unknown'::text, null::jsonb, null::uuid, null::uuid; return; end if;
  if s.deleted_at is not null then return query select 'stopped'::text, null::jsonb, null::uuid, null::uuid; return; end if;
  if exists (select 1 from public.recipes r where r.id = s.recipe_id and r.deleted_at is not null)
     or exists (select 1 from public.households h where h.id = s.household_id and h.deleted_at is not null) then
    return query select 'trashed'::text, null::jsonb, null::uuid, null::uuid; return;
  end if;
  return query select 'ok'::text, s.snapshot, s.id, s.household_id;
end;
$$;

-- The caller's own household gets an independent copy (FR-27).
create function public.save_share(code text)
returns table (recipe_id uuid, photo_id uuid, source_household uuid, share_id uuid)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  home uuid := public.auth_household_id();
  found_share record;
  snap jsonb;
  new_recipe uuid := gen_random_uuid();
  new_photo uuid := null;
begin
  if home is null or coalesce(public.auth_household_role()::text, '') not in ('admin', 'member') then
    perform public.household_refuse('forbidden');
  end if;
  select * into found_share from public.read_share(code);
  if found_share.status <> 'ok' then perform public.household_refuse('share_unavailable'); end if;
  if found_share.household_id = home then perform public.household_refuse('own_household'); end if;
  snap := found_share.snapshot;

  insert into public.recipes (id, household_id, title, servings, prep_minutes, cook_minutes,
                              ingredients, steps, tags, notes, source_url, source_author, source_text)
  values (
    new_recipe, home, snap ->> 'title',
    (snap ->> 'servings')::int, (snap ->> 'prep_minutes')::int, (snap ->> 'cook_minutes')::int,
    coalesce((select jsonb_agg(item || jsonb_build_object('id', gen_random_uuid()))
              from jsonb_array_elements(snap -> 'ingredients') item), '[]'::jsonb),
    coalesce((select jsonb_agg(item || jsonb_build_object('id', gen_random_uuid()))
              from jsonb_array_elements(snap -> 'steps') item), '[]'::jsonb),
    array(select jsonb_array_elements_text(snap -> 'tags')),
    coalesce(snap ->> 'notes', ''),
    snap ->> 'source_url', snap ->> 'source_author',
    'Shared by the ' || (snap ->> 'household_name')
  );

  if jsonb_typeof(snap -> 'photo') = 'object' then
    new_photo := gen_random_uuid();
    insert into public.photos (id, household_id, kind, recipe_id, media_type, bytes, width, height, uploaded_at)
    values (new_photo, home, 'dish', new_recipe, 'image/jpeg',
            (snap -> 'photo' ->> 'bytes')::int, (snap -> 'photo' ->> 'width')::int,
            (snap -> 'photo' ->> 'height')::int, now());
    update public.recipes r set photo_id = new_photo where r.id = new_recipe;
  end if;

  return query select new_recipe, new_photo, found_share.household_id, found_share.share_id;
end;
$$;

revoke execute on function public.create_share(uuid, uuid, jsonb), public.stop_shares(uuid),
  public.read_share(text), public.save_share(text) from public;
grant execute on function public.create_share(uuid, uuid, jsonb), public.stop_shares(uuid),
  public.read_share(text), public.save_share(text) to authenticated;

alter publication powersync add table public.shares;
grant select on public.shares to powersync_repl;

-- migrate:down
alter publication powersync drop table public.shares;
drop function public.save_share(text);
drop function public.read_share(text);
drop function public.stop_shares(uuid);
drop function public.create_share(uuid, uuid, jsonb);
drop table public.shares;
