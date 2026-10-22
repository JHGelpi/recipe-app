-- migrate:up
-- Cook Log (FR-37–FR-41). Runs as app_owner. NFR-1: cook_logs carries
-- household_id with RLS in this migration; the sync stream mirrors the select.
-- A meal's photos are photos rows of kind 'cook' (ADR-0013 files, same upload).

create table public.cook_logs (
  id uuid primary key, -- generated on the client
  household_id uuid not null references public.households (id),
  -- Set null when the recipe is purged; the entry and its title stay (FR-37).
  recipe_id uuid,
  recipe_title text not null check (char_length(btrim(recipe_title)) between 1 and 200),
  cooked_on date not null check (cooked_on >= date '2000-01-01'),
  -- Stamped by cook_logs_cooked_by: the person who logged it, never changed.
  cooked_by uuid references auth.users (id) on delete set null,
  notes text check (char_length(notes) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  deleted_at timestamptz,
  unique (id, household_id),
  -- Proves the recipe is in the same household, whatever RLS lets the writer see.
  foreign key (recipe_id, household_id) references public.recipes (id, household_id)
    on delete set null (recipe_id) deferrable initially immediate
);
create index cook_logs_household_id_idx on public.cook_logs (household_id);
create index cook_logs_recipe_id_idx on public.cook_logs (recipe_id);

create trigger cook_logs_stamp before insert or update on public.cook_logs
for each row execute function public.stamp_row();

create function public.cook_logs_cooked_by() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.cooked_by := coalesce(public.auth_user_id(), new.cooked_by);
  else
    new.cooked_by := old.cooked_by;
  end if;
  return new;
end $$;

create trigger cook_logs_cooked_by before insert or update on public.cook_logs
for each row execute function public.cook_logs_cooked_by();

-- Delete only for the 30-day purge (cook_logs_purge below).
grant select, insert, update, delete on public.cook_logs to authenticated;
alter table public.cook_logs enable row level security;

-- Mirrored by powersync/sync-config.yaml (household_cook_logs).
create policy cook_logs_select on public.cook_logs
for select to authenticated
using (household_id = (select public.auth_household_id()));
create policy cook_logs_insert on public.cook_logs
for insert to authenticated
with check (
  household_id = (select public.auth_household_id())
  and (select public.auth_household_role()) in ('admin', 'member')
);
create policy cook_logs_update on public.cook_logs
for update to authenticated
using (
  household_id = (select public.auth_household_id())
  and (select public.auth_household_role()) in ('admin', 'member')
)
with check (
  household_id = (select public.auth_household_id())
  and (select public.auth_household_role()) in ('admin', 'member')
);
create policy cook_logs_purge on public.cook_logs
for delete to authenticated
using (
  household_id = (select public.auth_household_id())
  and (select public.auth_household_role()) in ('admin', 'member')
  and deleted_at is not null
  and deleted_at < now() - interval '30 days'
);

-- ---------------------------------------------------------------- photos

-- A cook photo belongs to its entry only: no recipe_id, so purging a recipe
-- never takes a meal's photos. position orders them (1–8, like pages).
alter table public.photos
  add column cook_log_id uuid,
  add constraint photos_cook_log_id_household_id_fkey foreign key (cook_log_id, household_id)
    references public.cook_logs (id, household_id) deferrable initially immediate,
  drop constraint photos_kind_check,
  add constraint photos_kind_check check (kind in ('page', 'dish', 'cook')),
  drop constraint photos_check,
  add constraint photos_check check (
    (kind = 'page' and import_id is not null and position is not null and cook_log_id is null)
    or (kind = 'dish' and import_id is null and position is null and cook_log_id is null)
    or (kind = 'cook' and cook_log_id is not null and position is not null
        and import_id is null and recipe_id is null)
  );
create index photos_cook_log_id_idx on public.photos (cook_log_id);

-- FR-18: as before, plus the photos of an entry in expired trash (purged
-- just before the entry).
drop policy photos_purge on public.photos;
create policy photos_purge on public.photos
for delete to authenticated
using (
  household_id = (select public.auth_household_id())
  and (select public.auth_household_role()) in ('admin', 'member')
  and (
    (deleted_at is not null and deleted_at < now() - interval '30 days')
    or exists (
      select 1 from public.recipes r
      where r.id = recipe_id and r.deleted_at < now() - interval '30 days'
    )
    or exists (
      select 1 from public.cook_logs c
      where c.id = cook_log_id and c.deleted_at < now() - interval '30 days'
    )
  )
);

-- ---------------------------------------------------------------- joining

-- As 20261026000000, plus cook_logs moving with everything else when a person
-- alone joins another household (spec §4). Only the "alone" branch changed.
create or replace function public.accept_invite(code text)
returns table (household_id uuid, from_household uuid, moved_recipes int, moved_photos uuid[])
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  inv public.invites;
  home uuid;
  my_role public.household_role;
  others int;
  recipes_moved int := 0;
  photos_moved uuid[] := '{}';
  mail text := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email';
begin
  select * into inv from public.invites i where i.token_hash = sha256(convert_to(code, 'UTF8')) for update;
  if not found then perform public.household_refuse('invite_unknown'); end if;
  if inv.deleted_at is not null then perform public.household_refuse('invite_cancelled'); end if;
  if inv.accepted_at is not null then perform public.household_refuse('invite_used'); end if;
  if inv.expires_at <= now() then perform public.household_refuse('invite_expired'); end if;
  perform 1 from public.households h where h.id = inv.household_id and h.deleted_at is null for update;
  if not found then perform public.household_refuse('invite_cancelled'); end if;

  select l.household, l.my_role into home, my_role from public.lock_my_household() l;
  if home = inv.household_id then perform public.household_refuse('already_member'); end if;
  select count(*) into others from public.memberships m
  where m.household_id = home and m.user_id <> public.auth_user_id() and m.deleted_at is null;
  if others > 0 and my_role = 'admin' and not exists (
       select 1 from public.memberships m
       where m.household_id = home and m.role = 'admin' and m.user_id <> public.auth_user_id()
         and m.deleted_at is null) then
    perform public.household_refuse('only_admin');
  end if;

  if others = 0 then
    -- Alone: everything of the old household comes along (spec §4).
    set constraints all deferred;
    -- Share photo copies are files named by the share id (ADR-0016), so they move too.
    photos_moved := array(select p.id from public.photos p where p.household_id = home)
      || array(select sh.id from public.shares sh
               where sh.household_id = home and jsonb_typeof(sh.snapshot -> 'photo') = 'object');
    update public.recipes r set household_id = inv.household_id where r.household_id = home;
    get diagnostics recipes_moved = row_count;
    update public.photos p set household_id = inv.household_id where p.household_id = home;
    update public.imports i set household_id = inv.household_id where i.household_id = home;
    update public.substitutions s set household_id = inv.household_id where s.household_id = home;
    update public.favorites f set household_id = inv.household_id where f.household_id = home;
    update public.shares sh set household_id = inv.household_id where sh.household_id = home;
    update public.cook_logs c set household_id = inv.household_id where c.household_id = home;
    update public.households h set deleted_at = now() where h.id = home;
    update public.invites i set deleted_at = now()
    where i.household_id = home and i.accepted_at is null and i.deleted_at is null;
  else
    update public.favorites f set deleted_at = now()
    where f.user_id = public.auth_user_id() and f.household_id = home and f.deleted_at is null;
  end if;

  update public.memberships m
  set household_id = inv.household_id, role = inv.role, email = coalesce(mail, m.email)
  where m.user_id = public.auth_user_id();
  update public.invites i set accepted_at = now(), accepted_by = public.auth_user_id() where i.id = inv.id;
  return query select inv.household_id, home, recipes_moved, photos_moved;
end;
$$;

-- ---------------------------------------------------------------- sync

alter publication powersync add table public.cook_logs;
grant select on public.cook_logs to powersync_repl;

-- migrate:down
-- Roll forward: dropping cook_logs would destroy the household's diary.
select 1;
