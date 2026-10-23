-- migrate:up
-- A person alone who joins another household brings their shopping list and
-- aisle choices too (issue #36), like everything else (spec §4). Runs as
-- app_owner. Also recovers lists left behind by earlier joins.

-- As 20261027000000, plus shopping_items and aisle_choices in the "alone" branch.
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


-- Recovery. Only accept_invite closes a household, and it stamps the invite's
-- accepted_at and the household's deleted_at with the same now(), as the same
-- person (updated_by). That pair names exactly where each closed household's
-- person went. Lists move there if that household is still open; aisle choices
-- only where it has none for the item. Nothing is deleted.
do $$
declare
  moved_items int;
  moved_choices int;
begin
  create temporary table joins on commit drop as
    select h.id as old_home, i.household_id as new_home
    from public.households h
    join public.invites i on i.accepted_at = h.deleted_at and i.accepted_by = h.updated_by
    join public.households t on t.id = i.household_id and t.deleted_at is null
    where h.deleted_at is not null and i.household_id <> h.id;

  update public.shopping_items s set household_id = j.new_home
  from joins j where s.household_id = j.old_home;
  get diagnostics moved_items = row_count;

  update public.aisle_choices a set household_id = j.new_home
  from joins j
  where a.household_id = j.old_home
    and not exists (select 1 from public.aisle_choices t
                    where t.household_id = j.new_home and t.item_key = a.item_key);
  get diagnostics moved_choices = row_count;

  raise notice 'issue #36 recovery: % list rows and % aisle choices moved', moved_items, moved_choices;
end $$;

-- migrate:down
-- Roll forward: the earlier body left a joiner's list in the closed household.
select 1;
