-- migrate:up
-- Review fixes for roles and invites (ADR-0015).
-- 1. lock_my_household re-checks, after waiting for the lock, that the caller
--    is still in the household it locked; if another change moved them, it
--    starts again from where they are now. Rows are locked in user order.
-- 2. A closed household's pending invites are cancelled with it, and an
--    invite to a closed household is refused.
-- 3. Joining from a shared household clears favorites of the recipes left behind.

create or replace function public.lock_my_household(out household uuid, out my_role public.household_role)
language plpgsql security definer set search_path = '' as $$
begin
  loop
    select m.household_id into household from public.memberships m
    where m.user_id = public.auth_user_id() and m.deleted_at is null;
    if household is null then perform public.household_refuse('forbidden'); end if;
    perform 1 from public.memberships m where m.household_id = household order by m.user_id for update;
    -- A fresh statement: sees any change committed while this waited.
    select m.role into my_role from public.memberships m
    where m.user_id = public.auth_user_id() and m.household_id = household and m.deleted_at is null;
    exit when my_role is not null;
  end loop;
end;
$$;

create or replace function public.preview_invite(code text)
returns table (status text, household_name text, role public.household_role, moving_recipes int, blocker text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  inv public.invites;
  home uuid;
  my_role public.household_role;
  others int;
begin
  select * into inv from public.invites i where i.token_hash = sha256(convert_to(code, 'UTF8'));
  if not found then return query select 'unknown'::text, null::text, null::public.household_role, 0, null::text; return; end if;
  if inv.deleted_at is not null then return query select 'cancelled'::text, null::text, inv.role, 0, null::text; return; end if;
  if inv.accepted_at is not null then return query select 'used'::text, null::text, inv.role, 0, null::text; return; end if;
  if inv.expires_at <= now() then return query select 'expired'::text, null::text, inv.role, 0, null::text; return; end if;
  -- A household closed by its last member joining elsewhere takes no one in.
  if exists (select 1 from public.households h where h.id = inv.household_id and h.deleted_at is not null) then
    return query select 'cancelled'::text, null::text, inv.role, 0, null::text; return;
  end if;

  select m.household_id, m.role into home, my_role from public.memberships m
  where m.user_id = public.auth_user_id() and m.deleted_at is null;
  if home = inv.household_id then
    return query select 'already_member'::text, h.name, inv.role, 0, null::text
      from public.households h where h.id = inv.household_id;
    return;
  end if;
  select count(*) into others from public.memberships m
  where m.household_id = home and m.user_id <> public.auth_user_id();
  return query select
    'ok'::text,
    h.name,
    inv.role,
    case when others = 0 then (select count(*)::int from public.recipes r
                               where r.household_id = home and r.deleted_at is null) else 0 end,
    case when others > 0 and my_role = 'admin' and not exists (
           select 1 from public.memberships m
           where m.household_id = home and m.role = 'admin' and m.user_id <> public.auth_user_id())
         then 'only_admin'::text end
  from public.households h where h.id = inv.household_id;
end;
$$;


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
  -- The target must still be open, and stay open while this runs (Important 2).
  perform 1 from public.households h where h.id = inv.household_id and h.deleted_at is null for update;
  if not found then perform public.household_refuse('invite_cancelled'); end if;

  select l.household, l.my_role into home, my_role from public.lock_my_household() l;
  if home = inv.household_id then perform public.household_refuse('already_member'); end if;
  select count(*) into others from public.memberships m
  where m.household_id = home and m.user_id <> public.auth_user_id();
  if others > 0 and my_role = 'admin' and not exists (
       select 1 from public.memberships m
       where m.household_id = home and m.role = 'admin' and m.user_id <> public.auth_user_id()) then
    perform public.household_refuse('only_admin');
  end if;

  if others = 0 then
    -- Alone: everything of the old household comes along (spec §4).
    set constraints all deferred;
    photos_moved := array(select p.id from public.photos p where p.household_id = home);
    update public.recipes r set household_id = inv.household_id where r.household_id = home;
    get diagnostics recipes_moved = row_count;
    update public.photos p set household_id = inv.household_id where p.household_id = home;
    update public.imports i set household_id = inv.household_id where i.household_id = home;
    update public.substitutions s set household_id = inv.household_id where s.household_id = home;
    update public.favorites f set household_id = inv.household_id where f.household_id = home;
    update public.households h set deleted_at = now() where h.id = home;
    -- Its pending invites close with it.
    update public.invites i set deleted_at = now()
    where i.household_id = home and i.accepted_at is null and i.deleted_at is null;
  else
    -- From a shared household: favorites of the recipes left behind go (Important 4).
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


-- migrate:down
-- Roll forward: the earlier bodies had the races fixed above.
select 1;
