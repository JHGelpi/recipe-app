-- migrate:up
-- Optional nutrition per serving (FR-43). Runs as app_owner. On the recipe row
-- (ADR-0010): one jsonb object, null when nothing is known. RLS is unchanged:
-- recipes' policies already cover the row; the sync stream gains the column.

-- The same shape and limits as nutritionSchema in packages/domain: only these
-- keys, each a number in range or null, and at least one number.
create function public.valid_nutrition(n jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select n is null or (
    jsonb_typeof(n) = 'object'
    and not exists (
      select 1 from jsonb_object_keys(n) k
      where k not in ('calories', 'protein_g', 'carbs_g', 'fat_g'))
    and not exists (
      select 1 from jsonb_each(n) e
      where jsonb_typeof(e.value) not in ('number', 'null')
         or (jsonb_typeof(e.value) = 'number' and (
              (e.value)::numeric < 0
              or (e.value)::numeric > case e.key when 'calories' then 10000 else 1000 end)))
    and exists (select 1 from jsonb_each(n) e where jsonb_typeof(e.value) = 'number')
  )
$$;

alter table public.recipes
  add column nutrition jsonb,
  add constraint recipes_nutrition_check check (public.valid_nutrition(nutrition));

-- As 20261022000000, plus the snapshot's nutrition on the saved copy. A
-- snapshot made before FR-43 has none: the copy's nutrition is null.
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
    'Shared by the ' || (snap ->> 'household_name'),
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

-- migrate:down
-- Roll forward: dropping the column would lose the nutrition households typed.
select 1;
