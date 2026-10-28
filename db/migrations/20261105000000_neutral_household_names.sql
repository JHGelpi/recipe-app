-- migrate:up
-- Issue #66: a new household was named after its creator's email local part
-- ("jane.doe household"), and every share snapshot carries the name to the
-- signed-out share page. New households are now "My household" (the same
-- default as DEFAULT_HOUSEHOLD_NAME in packages/domain), and existing ones
-- still named after a member's email are renamed, with their live snapshots.

-- As 20261103000000, with the neutral name.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  new_household_id uuid;
  who text := lower(btrim(coalesce(new.email, '')));
begin
  insert into public.households (name, updated_by)
  values ('My household', new.id)
  returning id into new_household_id;

  insert into public.memberships (household_id, user_id, role, email, updated_by)
  values (new_household_id, new.id, 'admin', new.email, new.id);

  update public.friend_links f
  set accepted_at = now(), accepted_by = new.id, accepted_email = who
  from public.signup_passes p
  where p.email = who and p.friend_link_id = f.id and f.accepted_at is null;
  insert into public.share_signups (share_id, accepted_by)
  select p.share_id, new.id from public.signup_passes p
  where p.email = who and p.share_id is not null
  on conflict (share_id) do nothing;
  update public.signup_passes p set friend_link_id = null, share_id = null
  where p.email = who and (p.friend_link_id is not null or p.share_id is not null);

  return new;
end;
$$;

-- As 20261101000000, with the neutral name: the person's new household after
-- a removal, a leave, or joining with recipes left behind.
create or replace function public.move_to_new_household(target uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  old uuid;
  new_home uuid;
begin
  select m.household_id into old from public.memberships m where m.user_id = target;
  insert into public.households (name, updated_by)
  values ('My household', target)
  returning id into new_home;
  update public.favorites set deleted_at = now()
  where user_id = target and household_id = old and deleted_at is null;
  update public.recipe_ratings set deleted_at = now()
  where user_id = target and household_id = old and deleted_at is null;
  update public.memberships set household_id = new_home, role = 'admin' where user_id = target;
end;
$$;

-- As 20261029000000, but a copy from a household with the default name says
-- where it came from without "the My household".
create or replace function public.save_share(code text)
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
                              ingredients, steps, tags, notes, source_url, source_author, source_text,
                              nutrition)
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
    case when snap ->> 'household_name' = 'My household'
         then 'Shared by another Dishkept household'
         else 'Shared by the ' || (snap ->> 'household_name') end,
    case when jsonb_typeof(snap -> 'nutrition') = 'object' then snap -> 'nutrition' end
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

-- Households still named after any member's email, as the earlier functions
-- named them. A household renamed to anything else is left alone. Memberships
-- keep the email (the migration role cannot read auth.users).
create temporary table email_named on commit drop as
select h.id, h.name as old_name
from public.households h
where h.name <> 'My household'
  and exists (
    select 1 from public.memberships m
    where m.household_id = h.id and m.email is not null
      and h.name = coalesce(nullif(split_part(m.email, '@', 1), ''), 'My') || ' household');

update public.households h set name = 'My household', updated_at = now()
from email_named e where h.id = e.id;

-- Links show the new name too; a snapshot that kept an older custom name is
-- not touched.
update public.shares s
set snapshot = jsonb_set(s.snapshot, '{household_name}', to_jsonb('My household'::text))
from email_named e
where s.household_id = e.id and s.snapshot ->> 'household_name' = e.old_name;

-- migrate:down
-- Roll forward: the earlier bodies name households after an email address.
select 1;
