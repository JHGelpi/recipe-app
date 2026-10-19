-- migrate:up
-- Bug batch §4 (ADR-0015). Runs as app_owner.
-- 1. A removed (soft-deleted) membership no longer counts as an Admin or as
--    another person in the household.
-- 2. Friend links are listed to everyone who can make one, and can be revoked.

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
  where m.household_id = home and m.user_id <> public.auth_user_id() and m.deleted_at is null;
  return query select
    'ok'::text,
    h.name,
    inv.role,
    case when others = 0 then (select count(*)::int from public.recipes r
                               where r.household_id = home and r.deleted_at is null) else 0 end,
    case when others > 0 and my_role = 'admin' and not exists (
           select 1 from public.memberships m
           where m.household_id = home and m.role = 'admin' and m.user_id <> public.auth_user_id()
             and m.deleted_at is null)
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

create or replace function public.set_member_role(target uuid, new_role public.household_role) returns void
language plpgsql security definer set search_path = '' as $$
declare
  home uuid;
  my_role public.household_role;
  target_role public.household_role;
begin
  select l.household, l.my_role into home, my_role from public.lock_my_household() l;
  if my_role <> 'admin' then perform public.household_refuse('forbidden'); end if;
  select m.role into target_role from public.memberships m
  where m.user_id = target and m.household_id = home and m.deleted_at is null;
  if target_role is null then perform public.household_refuse('not_member'); end if;
  if target_role = 'admin' and new_role <> 'admin' and (
       select count(*) from public.memberships m
       where m.household_id = home and m.role = 'admin' and m.deleted_at is null) <= 1 then
    perform public.household_refuse('last_admin');
  end if;
  update public.memberships set role = new_role where user_id = target;
end;
$$;

create or replace function public.remove_member(target uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  home uuid;
  my_role public.household_role;
begin
  select l.household, l.my_role into home, my_role from public.lock_my_household() l;
  if my_role <> 'admin' then perform public.household_refuse('forbidden'); end if;
  if target = public.auth_user_id() then perform public.household_refuse('forbidden'); end if;
  if not exists (select 1 from public.memberships m
                 where m.user_id = target and m.household_id = home and m.deleted_at is null) then
    perform public.household_refuse('not_member');
  end if;
  perform public.move_to_new_household(target);
end;
$$;

create or replace function public.leave_household() returns void
language plpgsql security definer set search_path = '' as $$
declare
  home uuid;
  my_role public.household_role;
begin
  select l.household, l.my_role into home, my_role from public.lock_my_household() l;
  if not exists (select 1 from public.memberships m
                 where m.household_id = home and m.user_id <> public.auth_user_id()
                   and m.deleted_at is null) then
    perform public.household_refuse('alone');
  end if;
  if my_role = 'admin' and not exists (
       select 1 from public.memberships m
       where m.household_id = home and m.role = 'admin' and m.user_id <> public.auth_user_id()
         and m.deleted_at is null) then
    perform public.household_refuse('only_admin');
  end if;
  perform public.move_to_new_household(public.auth_user_id());
end;
$$;

-- Everyone who can make a friend link sees the household's links (FR-6).
drop policy friend_links_select on public.friend_links;
create policy friend_links_select on public.friend_links
for select to authenticated
using (household_id = (select public.auth_household_id()));

-- Any member of the household, viewers too, ends one of its live links at once.
create function public.revoke_friend_link(link_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  home uuid;
begin
  select l.household into home from public.lock_my_household() l;
  update public.friend_links f set deleted_at = now()
  where f.id = link_id and f.household_id = home and f.deleted_at is null and f.expires_at > now();
  if not found then perform public.household_refuse('link_unknown'); end if;
end;
$$;

-- Called signed out (asAnonymous) by the /welcome page. Says only live, ended or unknown.
create function public.friend_link_status(link_code text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  link public.friend_links;
  open boolean;
begin
  select * into link from public.friend_links f
  where f.token_hash = sha256(convert_to(coalesce(link_code, ''), 'UTF8'));
  if not found then return 'unknown'; end if;
  select h.deleted_at is null into open from public.households h where h.id = link.household_id;
  return case when link.deleted_at is null and link.expires_at > now() and open then 'live' else 'ended' end;
end;
$$;

revoke execute on function public.revoke_friend_link(uuid), public.friend_link_status(text) from public;
grant execute on function public.revoke_friend_link(uuid), public.friend_link_status(text) to authenticated;

-- migrate:down
-- Roll forward: the earlier bodies counted removed memberships.
select 1;
