-- migrate:up
-- AI substitutions, remembered per recipe ingredient (FR-24). NFR-1:
-- household_id with RLS in this migration. Runs as app_owner. Only
-- POST /api/substitutions writes it, as the user; phones only read it.

create table public.substitutions (
  id uuid primary key, -- generated on the phone and sent with the ask
  household_id uuid not null references public.households (id),
  recipe_id uuid not null,
  ingredient_id uuid not null, -- an id inside the recipe's ingredients JSON
  ingredient_raw text not null check (char_length(ingredient_raw) between 1 and 500),
  options jsonb not null
    check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) <= 3),
  note text check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  deleted_at timestamptz,
  -- The composite key keeps the recipe inside the household. The 30-day
  -- purge is the only hard delete of a recipe, and its answers go with it.
  foreign key (recipe_id, household_id) references public.recipes (id, household_id)
    on delete cascade
);
create index substitutions_household_id_idx on public.substitutions (household_id);
create unique index substitutions_recipe_ingredient_key on public.substitutions (recipe_id, ingredient_id)
  where deleted_at is null;

create trigger substitutions_stamp before insert or update on public.substitutions
for each row execute function public.stamp_row();

grant select, insert, update on public.substitutions to authenticated;

alter table public.substitutions enable row level security;

-- Mirrored by powersync/sync-config.yaml (household_substitutions). Change both together.
create policy substitutions_select on public.substitutions
for select to authenticated
using (household_id = (select public.auth_household_id()));

create policy substitutions_insert on public.substitutions
for insert to authenticated
with check (
  household_id = (select public.auth_household_id())
  and (select public.auth_household_role()) in ('admin', 'member')
);

create policy substitutions_update on public.substitutions
for update to authenticated
using (
  household_id = (select public.auth_household_id())
  and (select public.auth_household_role()) in ('admin', 'member')
)
with check (
  household_id = (select public.auth_household_id())
  and (select public.auth_household_role()) in ('admin', 'member')
);

alter publication powersync add table public.substitutions;
grant select on public.substitutions to powersync_repl;

-- migrate:down
alter publication powersync drop table public.substitutions;
drop table public.substitutions;
