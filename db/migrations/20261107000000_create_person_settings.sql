-- migrate:up
-- Units and Appearance defaults belong to the person, not the device (FR-23,
-- NFR-11, ADR-0031). Runs as app_owner.
--
-- A per-person table, not a tenant table: it has no household_id, so the
-- settings survive a household move (ADR-0015). The one exception to CLAUDE.md
-- rule 1, recorded in ADR-0031. RLS and the sync stream (my_settings) both
-- scope it to the person's own row (rule 6). Every role writes its own row,
-- Viewers too, as for favorites and ratings (rule 4's exception).

create table public.person_settings (
  -- The person's own id, so every device writes the same row.
  id uuid primary key check (id = user_id),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  units text not null default 'as_written' check (units in ('as_written', 'us', 'metric')),
  appearance text not null default 'system' check (appearance in ('system', 'light', 'dark')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  deleted_at timestamptz
);

create trigger person_settings_stamp before insert or update on public.person_settings
for each row execute function public.stamp_row();

-- No delete grant: nothing deletes settings but the account's own removal.
grant select, insert, update on public.person_settings to authenticated;
alter table public.person_settings enable row level security;

-- Mirrored by powersync/sync-config.yaml (my_settings).
create policy person_settings_select on public.person_settings
for select to authenticated
using (user_id = (select public.auth_user_id()));

create policy person_settings_insert on public.person_settings
for insert to authenticated
with check (user_id = (select public.auth_user_id()));

create policy person_settings_update on public.person_settings
for update to authenticated
using (user_id = (select public.auth_user_id()))
with check (user_id = (select public.auth_user_id()));

alter publication powersync add table public.person_settings;
grant select on public.person_settings to powersync_repl;

-- migrate:down
drop table public.person_settings;
