-- migrate:up
-- Final review 1: a person alone who had shared a link could not join a
-- household, because their shares stayed behind while the recipes moved and
-- the deferred foreign key failed at commit.

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
    -- Links follow their recipes, live or stopped, and keep working (FR-27).
    update public.shares sh set household_id = inv.household_id where sh.household_id = home;
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
-- Roll forward: the earlier body left shares behind.
select 1;
