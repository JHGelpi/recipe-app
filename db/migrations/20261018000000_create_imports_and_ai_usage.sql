-- migrate:up
-- Import from text and URL (FR-8, FR-9, FR-12, FR-29) and the monthly AI cap
-- (NFR-7). NFR-1: both tables carry household_id with RLS in this migration.
-- Runs as app_owner.

-- ---------------------------------------------------------------- recipe source

-- FR-12, NFR-13: where an imported recipe came from. Set once, on save from
-- review; the editor does not change them.
alter table public.recipes
  add column source_url text
    check (char_length(source_url) <= 2000 and source_url ~* '^https?://'),
  add column source_author text check (char_length(source_author) <= 200),
  add column source_text text check (char_length(source_text) <= 20000);

-- ---------------------------------------------------------------- imports

-- One row per import (ADR-0012). The phone writes the source and dismissal;
-- only the parse endpoint writes status, draft, error and parse_started_at.
create table public.imports (
  id uuid primary key, -- generated on the client; no default on purpose
  household_id uuid not null references public.households (id),
  source_type text not null check (source_type in ('text', 'url')),
  source_text text check (char_length(source_text) between 1 and 20000),
  source_url text check (char_length(source_url) <= 2000 and source_url ~* '^https?://'),
  status text not null default 'pending'
    check (status in ('pending', 'parsing', 'ready', 'failed')),
  draft jsonb check (draft is null or jsonb_typeof(draft) = 'object'),
  error text check (error in (
    'quota', 'ai_unavailable', 'fetch_failed', 'blocked_address', 'not_a_recipe', 'invalid_output'
  )),
  parse_started_at timestamptz,
  recipe_id uuid references public.recipes (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  deleted_at timestamptz,
  check (
    (source_type = 'text' and source_text is not null and source_url is null)
    or (source_type = 'url' and source_url is not null and source_text is null)
  )
);
create index imports_household_id_idx on public.imports (household_id);

create trigger imports_stamp before insert or update on public.imports
for each row execute function public.stamp_row();

-- ---------------------------------------------------------------- ai_usage

-- NFR-7: AI spend per household per calendar month (UTC), in micro-dollars.
-- Written only by the parse code; never synced, never uploaded.
create table public.ai_usage (
  household_id uuid not null references public.households (id),
  month date not null check (extract(day from month) = 1),
  spent_microusd bigint not null default 0 check (spent_microusd >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  deleted_at timestamptz,
  primary key (household_id, month)
);

create trigger ai_usage_stamp before insert or update on public.ai_usage
for each row execute function public.stamp_row();

-- ---------------------------------------------------------------- grants

-- No delete grants: an import is dismissed with deleted_at.
grant select, insert, update on public.imports to authenticated;
grant select, insert, update on public.ai_usage to authenticated;

-- ---------------------------------------------------------------- RLS

alter table public.imports enable row level security;
alter table public.ai_usage enable row level security;

-- Mirrored by powersync/sync-config.yaml (household_imports). Change both together.
create policy imports_select on public.imports
for select to authenticated
using (household_id = (select public.auth_household_id()));

create policy imports_insert on public.imports
for insert to authenticated
with check (
  household_id = (select public.auth_household_id())
  and (select public.auth_household_role()) in ('admin', 'member')
  and recipe_id is null
);

create policy imports_update on public.imports
for update to authenticated
using (
  household_id = (select public.auth_household_id())
  and (select public.auth_household_role()) in ('admin', 'member')
)
with check (
  household_id = (select public.auth_household_id())
  and (select public.auth_household_role()) in ('admin', 'member')
  and (
    recipe_id is null
    or exists (
      select 1 from public.recipes r
      where r.id = recipe_id and r.household_id = (select public.auth_household_id())
    )
  )
);

create policy ai_usage_select on public.ai_usage
for select to authenticated
using (household_id = (select public.auth_household_id()));

create policy ai_usage_insert on public.ai_usage
for insert to authenticated
with check (
  household_id = (select public.auth_household_id())
  and (select public.auth_household_role()) in ('admin', 'member')
);

create policy ai_usage_update on public.ai_usage
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

alter publication powersync add table public.imports;
grant select on public.imports to powersync_repl;

-- migrate:down
alter publication powersync drop table public.imports;
drop table public.ai_usage;
drop table public.imports;
alter table public.recipes
  drop column source_url,
  drop column source_author,
  drop column source_text;
