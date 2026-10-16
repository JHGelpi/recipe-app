-- migrate:up
-- Recipe details (FR-15, FR-16), favorites (FR-17), 30-day trash purge (FR-18).
-- NFR-1: favorites carry household_id with RLS in this same migration.
-- Runs as app_owner.

-- ---------------------------------------------------------------- recipe details

-- Ingredients and steps are JSON on the row (ADR-0010): one recipe, one row,
-- so a save is atomic and last-write-wins applies to the whole recipe.
-- Element shapes are validated by the API (packages/domain); the database
-- checks types and counts.
alter table public.recipes
  add column servings integer check (servings between 1 and 999),
  add column prep_minutes integer check (prep_minutes between 0 and 10000),
  add column cook_minutes integer check (cook_minutes between 0 and 10000),
  add column ingredients jsonb not null default '[]'::jsonb
    check (jsonb_typeof(ingredients) = 'array' and jsonb_array_length(ingredients) <= 200),
  add column steps jsonb not null default '[]'::jsonb
    check (jsonb_typeof(steps) = 'array' and jsonb_array_length(steps) <= 100),
  add column tags text[] not null default '{}'
    check (cardinality(tags) <= 30),
  add column notes text not null default ''
    check (char_length(notes) <= 10000);

-- ---------------------------------------------------------------- favorites

-- One row per user and recipe. Un-starring sets deleted_at; starring again
-- clears it on the same row.
create table public.favorites (
  id uuid primary key, -- generated on the client; no default on purpose
  household_id uuid not null references public.households (id),
  user_id uuid not null references auth.users (id) on delete cascade,
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  deleted_at timestamptz,
  unique (user_id, recipe_id)
);
create index favorites_household_id_idx on public.favorites (household_id);
create index favorites_recipe_id_idx on public.favorites (recipe_id);

create trigger favorites_stamp before insert or update on public.favorites
for each row execute function public.stamp_row();

-- ---------------------------------------------------------------- grants

-- Favorites: any role writes its own rows (a personal bookmark, not household
-- data). No delete grant: removal is soft, or by cascade from a purged recipe.
grant select, insert, update on public.favorites to authenticated;

-- Recipes: delete is granted only for the 30-day purge; recipes_purge below
-- limits it to expired trash. Every other delete matches no row.
grant delete on public.recipes to authenticated;

-- ---------------------------------------------------------------- RLS

alter table public.favorites enable row level security;

-- Mirrored by powersync/sync-config.yaml (user_favorites). Change both together.
create policy favorites_select on public.favorites
for select to authenticated
using (
  household_id = (select public.auth_household_id())
  and user_id = (select public.auth_user_id())
);

create policy favorites_insert on public.favorites
for insert to authenticated
with check (
  household_id = (select public.auth_household_id())
  and user_id = (select public.auth_user_id())
  and exists (
    select 1 from public.recipes r
    where r.id = recipe_id and r.household_id = (select public.auth_household_id())
  )
);

create policy favorites_update on public.favorites
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

-- FR-18: trash older than 30 days is deleted for good, by an admin or member
-- of the household, through POST /api/trash/purge.
create policy recipes_purge on public.recipes
for delete to authenticated
using (
  household_id = (select public.auth_household_id())
  and (select public.auth_household_role()) in ('admin', 'member')
  and deleted_at is not null
  and deleted_at < now() - interval '30 days'
);

-- ---------------------------------------------------------------- sync

alter publication powersync add table public.favorites;
grant select on public.favorites to powersync_repl;

-- migrate:down
alter publication powersync drop table public.favorites;
drop policy recipes_purge on public.recipes;
revoke delete on public.recipes from authenticated;
drop table public.favorites;
alter table public.recipes
  drop column servings,
  drop column prep_minutes,
  drop column cook_minutes,
  drop column ingredients,
  drop column steps,
  drop column tags,
  drop column notes;
