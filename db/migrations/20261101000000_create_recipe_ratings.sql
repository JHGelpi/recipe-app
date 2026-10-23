-- migrate:up
-- Recipe ratings (FR-44, ADR-0022). Runs as app_owner. NFR-1: both tables
-- carry household_id with RLS in this migration; the sync streams mirror the
-- selects (rule 6).
--
-- A rating is private: only its owner reads it. The household sees only each
-- recipe's total and count, kept in recipe_rating_totals by a trigger.

-- ---------------------------------------------------------------- ratings

-- One row per person and recipe. Clearing sets deleted_at; rating again
-- clears it on the same row, as favorites do. Any role rates, Viewers too.
create table public.recipe_ratings (
  id uuid primary key, -- generated on the client
  household_id uuid not null references public.households (id),
  user_id uuid not null references auth.users (id) on delete cascade,
  recipe_id uuid not null,
  stars smallint not null check (stars between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  deleted_at timestamptz,
  unique (user_id, recipe_id),
  -- The recipe is in the same household; a purged recipe takes its ratings.
  foreign key (recipe_id, household_id) references public.recipes (id, household_id)
    on delete cascade deferrable initially immediate
);
create index recipe_ratings_household_id_idx on public.recipe_ratings (household_id);
create index recipe_ratings_recipe_id_idx on public.recipe_ratings (recipe_id);

create trigger recipe_ratings_stamp before insert or update on public.recipe_ratings
for each row execute function public.stamp_row();

-- No delete grant: clearing is soft, removal only by cascade.
grant select, insert, update on public.recipe_ratings to authenticated;
alter table public.recipe_ratings enable row level security;

-- Mirrored by powersync/sync-config.yaml (user_ratings). Only your own rows:
-- people see the household's average, never each other's ratings.
create policy recipe_ratings_select on public.recipe_ratings
for select to authenticated
using (
  household_id = (select public.auth_household_id())
  and user_id = (select public.auth_user_id())
);

create policy recipe_ratings_insert on public.recipe_ratings
for insert to authenticated
with check (
  household_id = (select public.auth_household_id())
  and user_id = (select public.auth_user_id())
  and exists (
    select 1 from public.recipes r
    where r.id = recipe_id and r.household_id = (select public.auth_household_id())
  )
);

create policy recipe_ratings_update on public.recipe_ratings
for update to authenticated
using (
  household_id = (select public.auth_household_id())
  and user_id = (select public.auth_user_id())
)
with check (
  household_id = (select public.auth_household_id())
  and user_id = (select public.auth_user_id())
  and exists (
    select 1 from public.recipes r
    where r.id = recipe_id and r.household_id = (select public.auth_household_id())
  )
);

-- ---------------------------------------------------------------- totals

-- Each rated recipe's live ratings, summed and counted. Written only by
-- recount_recipe_ratings; clients read it. id is the recipe's id. updated_by
-- stays null on purpose: stamping it would name the last person who rated.
create table public.recipe_rating_totals (
  id uuid primary key,
  household_id uuid not null references public.households (id),
  stars_total integer not null default 0 check (stars_total >= 0),
  ratings_count integer not null default 0 check (ratings_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  deleted_at timestamptz,
  foreign key (id, household_id) references public.recipes (id, household_id)
    on delete cascade deferrable initially immediate
);
create index recipe_rating_totals_household_id_idx on public.recipe_rating_totals (household_id);

grant select on public.recipe_rating_totals to authenticated;
alter table public.recipe_rating_totals enable row level security;

-- Mirrored by powersync/sync-config.yaml (household_ratings). No write
-- policies: only the trigger below changes these rows.
create policy recipe_rating_totals_select on public.recipe_rating_totals
for select to authenticated
using (household_id = (select public.auth_household_id()));

-- Recounts one recipe from its live ratings. security definer because no
-- client may read the household's ratings or write totals (ADR-0022); it
-- takes only a recipe id, and only the trigger calls it.
create function public.recount_recipe_ratings(rid uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  home uuid;
begin
  select r.household_id into home from public.recipes r where r.id = rid;
  -- A purged recipe: its totals go with it by cascade.
  if not found then return; end if;
  insert into public.recipe_rating_totals (id, household_id) values (rid, home)
  on conflict (id) do nothing;
  -- Two ratings of one recipe at once: the second waits here, then its count
  -- below (a new statement, so a new snapshot) includes the first.
  perform 1 from public.recipe_rating_totals t where t.id = rid for update;
  update public.recipe_rating_totals t
  set household_id = home, stars_total = s.total, ratings_count = s.n, updated_at = now()
  from (
    select coalesce(sum(g.stars), 0)::int as total, count(*)::int as n
    from public.recipe_ratings g
    where g.recipe_id = rid and g.deleted_at is null
  ) s
  where t.id = rid;
end;
$$;

create function public.recipe_ratings_recount() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.recount_recipe_ratings(old.recipe_id);
  end if;
  if tg_op = 'INSERT' or (tg_op = 'UPDATE' and new.recipe_id <> old.recipe_id) then
    perform public.recount_recipe_ratings(new.recipe_id);
  end if;
  return null;
end;
$$;

revoke execute on function public.recount_recipe_ratings(uuid), public.recipe_ratings_recount()
  from public;

create trigger recipe_ratings_recount after insert or update or delete on public.recipe_ratings
for each row execute function public.recipe_ratings_recount();

-- ---------------------------------------------------------------- moving

-- As 20261021000001, plus their ratings of the old household's recipes,
-- which stop counting there like their favorites (FR-44).
create or replace function public.move_to_new_household(target uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  old uuid;
  new_home uuid;
  mail text;
begin
  select m.household_id, m.email into old, mail from public.memberships m where m.user_id = target;
  insert into public.households (name, updated_by)
  values (coalesce(nullif(split_part(mail, '@', 1), ''), 'My') || ' household', target)
  returning id into new_home;
  update public.favorites set deleted_at = now()
  where user_id = target and household_id = old and deleted_at is null;
  update public.recipe_ratings set deleted_at = now()
  where user_id = target and household_id = old and deleted_at is null;
  update public.memberships set household_id = new_home, role = 'admin' where user_id = target;
end;
$$;

-- As 20261031000000, plus ratings: a person alone brings theirs, and anyone
-- else's stop counting in the household they leave.
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
    -- The shopping list joins the new household's list (issue #36). An aisle
    -- choice moves only where the new household has none for that item: its
    -- own choice wins, and the unique (household_id, item_key) holds.
    update public.shopping_items s set household_id = inv.household_id where s.household_id = home;
    update public.aisle_choices a set household_id = inv.household_id
    where a.household_id = home
      and not exists (select 1 from public.aisle_choices t
                      where t.household_id = inv.household_id and t.item_key = a.item_key);
    -- Ratings come along with their recipes (FR-44); the triggers recount
    -- them, and the totals of recipes with no ratings left move here.
    update public.recipe_ratings g set household_id = inv.household_id where g.household_id = home;
    update public.recipe_rating_totals t set household_id = inv.household_id where t.household_id = home;
    update public.households h set deleted_at = now() where h.id = home;
    update public.invites i set deleted_at = now()
    where i.household_id = home and i.accepted_at is null and i.deleted_at is null;
  else
    update public.favorites f set deleted_at = now()
    where f.user_id = public.auth_user_id() and f.household_id = home and f.deleted_at is null;
    -- Their ratings of recipes left behind stop counting there (FR-44).
    update public.recipe_ratings g set deleted_at = now()
    where g.user_id = public.auth_user_id() and g.household_id = home and g.deleted_at is null;
  end if;

  update public.memberships m
  set household_id = inv.household_id, role = inv.role, email = coalesce(mail, m.email)
  where m.user_id = public.auth_user_id();
  update public.invites i set accepted_at = now(), accepted_by = public.auth_user_id() where i.id = inv.id;
  return query select inv.household_id, home, recipes_moved, photos_moved;
end;
$$;

-- ---------------------------------------------------------------- sync

alter publication powersync add table public.recipe_ratings, public.recipe_rating_totals;
grant select on public.recipe_ratings, public.recipe_rating_totals to powersync_repl;

-- migrate:down
-- Roll forward: dropping the tables would destroy the household's ratings.
select 1;
