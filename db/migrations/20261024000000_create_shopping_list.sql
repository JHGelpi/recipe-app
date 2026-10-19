-- migrate:up
-- Shopping list (Phase 2, FR-31–FR-35; ADR-0019). Runs as app_owner.
-- One row per added ingredient or typed item; the app merges rows into lines.
-- Both tables are household data: RLS here, sync streams mirror the selects.

create table public.shopping_items (
  id uuid primary key, -- generated on the client
  household_id uuid not null references public.households (id),
  item text not null check (char_length(btrim(item)) between 1 and 200),
  item_key text not null check (char_length(item_key) between 1 and 200),
  quantity numeric check (quantity >= 0 and quantity <= 100000),
  quantity_max numeric check (quantity_max >= 0 and quantity_max <= 100000),
  unit text,
  note text check (char_length(note) <= 200),
  aisle text not null check (aisle in ('produce', 'meat', 'dairy', 'bakery', 'pantry', 'spices', 'frozen', 'drinks', 'household', 'other')),
  -- No foreign key: purging a recipe never breaks the list; the title is kept.
  recipe_id uuid,
  recipe_title text check (char_length(recipe_title) <= 200),
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  deleted_at timestamptz
);
create index shopping_items_household_id_idx on public.shopping_items (household_id);

create table public.aisle_choices (
  id uuid primary key,
  household_id uuid not null references public.households (id),
  item_key text not null check (char_length(item_key) between 1 and 200),
  aisle text not null check (aisle in ('produce', 'meat', 'dairy', 'bakery', 'pantry', 'spices', 'frozen', 'drinks', 'household', 'other')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  deleted_at timestamptz,
  unique (household_id, item_key)
);

create trigger shopping_items_stamp before insert or update on public.shopping_items
for each row execute function public.stamp_row();
create trigger aisle_choices_stamp before insert or update on public.aisle_choices
for each row execute function public.stamp_row();

-- Delete only for the 30-day purge (shopping_items_purge below).
grant select, insert, update, delete on public.shopping_items to authenticated;
grant select, insert, update on public.aisle_choices to authenticated;
alter table public.shopping_items enable row level security;
alter table public.aisle_choices enable row level security;

-- Mirrored by powersync/sync-config.yaml (household_shopping_items).
create policy shopping_items_select on public.shopping_items
for select to authenticated
using (household_id = (select public.auth_household_id()));
create policy shopping_items_insert on public.shopping_items
for insert to authenticated
with check (
  household_id = (select public.auth_household_id())
  and (select public.auth_household_role()) in ('admin', 'member')
);
create policy shopping_items_update on public.shopping_items
for update to authenticated
using (
  household_id = (select public.auth_household_id())
  and (select public.auth_household_role()) in ('admin', 'member')
)
with check (
  household_id = (select public.auth_household_id())
  and (select public.auth_household_role()) in ('admin', 'member')
);
create policy shopping_items_purge on public.shopping_items
for delete to authenticated
using (
  household_id = (select public.auth_household_id())
  and (select public.auth_household_role()) in ('admin', 'member')
  and deleted_at is not null
  and deleted_at < now() - interval '30 days'
);

-- Mirrored by powersync/sync-config.yaml (household_aisle_choices).
create policy aisle_choices_select on public.aisle_choices
for select to authenticated
using (household_id = (select public.auth_household_id()));
create policy aisle_choices_insert on public.aisle_choices
for insert to authenticated
with check (
  household_id = (select public.auth_household_id())
  and (select public.auth_household_role()) in ('admin', 'member')
);
create policy aisle_choices_update on public.aisle_choices
for update to authenticated
using (
  household_id = (select public.auth_household_id())
  and (select public.auth_household_role()) in ('admin', 'member')
)
with check (
  household_id = (select public.auth_household_id())
  and (select public.auth_household_role()) in ('admin', 'member')
);

-- PowerSync replicates only the tables in this publication.
alter publication powersync add table public.shopping_items, public.aisle_choices;

-- migrate:down
alter publication powersync drop table public.shopping_items, public.aisle_choices;
drop table public.aisle_choices;
drop table public.shopping_items;
