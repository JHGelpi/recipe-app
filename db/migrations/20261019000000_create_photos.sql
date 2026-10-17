-- migrate:up
-- Photo import and dish photos (FR-7, FR-12, FR-15). NFR-1: photos carries
-- household_id with RLS in this migration. Runs as app_owner. The bytes live
-- on the API's volume (ADR-0013); this table only describes them.

-- Composite keys let a foreign key prove that a reference stays inside the
-- household: (import_id, household_id) must match an import of the same
-- household, whatever RLS lets the writer see.
alter table public.imports add constraint imports_id_household_key unique (id, household_id);
alter table public.recipes add constraint recipes_id_household_key unique (id, household_id);

-- ---------------------------------------------------------------- imports

alter table public.imports
  drop constraint imports_source_type_check,
  drop constraint imports_check,
  drop constraint imports_error_check,
  add constraint imports_source_type_check check (source_type in ('text', 'url', 'photo')),
  -- A photo import's pages are the photos rows that point at it.
  add constraint imports_source_check check (
    (source_type = 'text' and source_text is not null and source_url is null)
    or (source_type = 'url' and source_url is not null and source_text is null)
    or (source_type = 'photo' and source_text is null and source_url is null)
  ),
  add constraint imports_error_check check (error in (
    'quota', 'ai_unavailable', 'fetch_failed', 'blocked_address', 'not_a_recipe',
    'invalid_output', 'photo_unreadable'
  ));

-- ---------------------------------------------------------------- photos

create table public.photos (
  id uuid primary key, -- generated on the client; also the file name
  household_id uuid not null references public.households (id),
  kind text not null check (kind in ('page', 'dish')),
  import_id uuid,
  position integer check (position between 1 and 8),
  recipe_id uuid,
  media_type text not null check (media_type = 'image/jpeg'),
  bytes integer not null check (bytes between 1 and 3000000),
  width integer not null check (width between 1 and 4000),
  height integer not null check (height between 1 and 4000),
  -- Set by PUT /api/photos/:id once the file is stored; never by a client.
  uploaded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  deleted_at timestamptz,
  unique (id, household_id),
  foreign key (import_id, household_id) references public.imports (id, household_id),
  foreign key (recipe_id, household_id) references public.recipes (id, household_id)
    on delete set null (recipe_id),
  check (
    (kind = 'page' and import_id is not null and position is not null)
    or (kind = 'dish' and import_id is null and position is null)
  )
);
create index photos_household_id_idx on public.photos (household_id);
create index photos_import_id_idx on public.photos (import_id);
create index photos_recipe_id_idx on public.photos (recipe_id);
create unique index photos_import_position_key on public.photos (import_id, position)
  where kind = 'page' and deleted_at is null;

create trigger photos_stamp before insert or update on public.photos
for each row execute function public.stamp_row();

-- FR-15: the dish photo. May point at one of the recipe's pages.
alter table public.recipes
  add column photo_id uuid,
  add constraint recipes_photo_fkey foreign key (photo_id, household_id)
    references public.photos (id, household_id) on delete set null (photo_id);

-- ---------------------------------------------------------------- grants

-- Delete is granted only for the 30-day purge; photos_purge limits it.
grant select, insert, update, delete on public.photos to authenticated;

-- ---------------------------------------------------------------- RLS

alter table public.photos enable row level security;

-- Mirrored by powersync/sync-config.yaml (household_photos). Change both together.
create policy photos_select on public.photos
for select to authenticated
using (household_id = (select public.auth_household_id()));

create policy photos_insert on public.photos
for insert to authenticated
with check (
  household_id = (select public.auth_household_id())
  and (select public.auth_household_role()) in ('admin', 'member')
  and uploaded_at is null
);

create policy photos_update on public.photos
for update to authenticated
using (
  household_id = (select public.auth_household_id())
  and (select public.auth_household_role()) in ('admin', 'member')
)
with check (
  household_id = (select public.auth_household_id())
  and (select public.auth_household_role()) in ('admin', 'member')
);

-- FR-18 for photos: dismissed or replaced over 30 days ago, or belonging to a
-- recipe in expired trash (purged just before the recipe).
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
  )
);

-- ---------------------------------------------------------------- sync

alter publication powersync add table public.photos;
grant select on public.photos to powersync_repl;

-- migrate:down
alter publication powersync drop table public.photos;
alter table public.recipes drop constraint recipes_photo_fkey, drop column photo_id;
drop table public.photos;
alter table public.imports
  drop constraint imports_source_type_check,
  drop constraint imports_source_check,
  drop constraint imports_error_check,
  add constraint imports_source_type_check check (source_type in ('text', 'url')),
  add constraint imports_check check (
    (source_type = 'text' and source_text is not null and source_url is null)
    or (source_type = 'url' and source_url is not null and source_text is null)
  ),
  add constraint imports_error_check check (error in (
    'quota', 'ai_unavailable', 'fetch_failed', 'blocked_address', 'not_a_recipe', 'invalid_output'
  ));
alter table public.recipes drop constraint recipes_id_household_key;
alter table public.imports drop constraint imports_id_household_key;
