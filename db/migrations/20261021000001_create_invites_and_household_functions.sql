-- migrate:up
-- Roles and invites, part 2 (FR-3, FR-5, FR-6; ADR-0015). Runs as app_owner.
-- Every cross-household change goes through one of these security definer
-- functions. None takes a household id from the caller: each reads the
-- caller's own membership, checks every rule, and raises a key on refusal.

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id),
  role public.household_role not null,
  token_hash bytea not null unique, -- sha256 of the link's code; the code is never stored
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  deleted_at timestamptz -- set when cancelled
);
create index invites_household_id_idx on public.invites (household_id);

create trigger invites_stamp before insert or update on public.invites
for each row execute function public.stamp_row();

grant select on public.invites to authenticated;
alter table public.invites enable row level security;

create policy invites_select on public.invites
for select to authenticated
using (
  household_id = (select public.auth_household_id())
  and (select public.auth_household_role()) = 'admin'
);

-- ---------------------------------------------------------------- helpers

create function public.household_refuse(key text) returns void
language plpgsql immutable as $$
begin
  raise exception '%', key using errcode = 'P0001';
end;
$$;

-- The caller's membership, locked with every membership of their household,
-- so counting Admins and changing roles cannot interleave (Review Focus 2).
create function public.lock_my_household(out household uuid, out my_role public.household_role)
language plpgsql security definer set search_path = '' as $$
begin
  select m.household_id into household from public.memberships m
  where m.user_id = public.auth_user_id() and m.deleted_at is null;
  if household is null then perform public.household_refuse('forbidden'); end if;
  perform 1 from public.memberships m where m.household_id = household for update;
  select m.role into my_role from public.memberships m
  where m.user_id = public.auth_user_id() and m.deleted_at is null;
end;
$$;

-- A new household for a person leaving or removed; their membership moves
-- there as Admin, and their favorites of the old household's recipes go.
create function public.move_to_new_household(target uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  old uuid;
  new_home uuid;
  mail text;
begin
  select m.household_id, m.email into old, mail from public.memberships m where m.user_id = target;
  insert into public.households (name, updated_by)
  values (coalesce(nullif(split_part(mail, '@', 1), ''), 'My') || ' household', target)
  returning id into new_home;
  update public.favorites set deleted_at = now()
  where user_id = target and household_id = old and deleted_at is null;
  update public.memberships set household_id = new_home, role = 'admin' where user_id = target;
end;
$$;

-- ---------------------------------------------------------------- invites

create function public.create_invite(invite_role public.household_role)
returns table (id uuid, token text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  home uuid;
  my_role public.household_role;
  code text;
  new_id uuid;
  new_expiry timestamptz;
begin
  select l.household, l.my_role into home, my_role from public.lock_my_household() l;
  if my_role <> 'admin' then perform public.household_refuse('forbidden'); end if;
  if (select count(*) from public.invites i
      where i.household_id = home and i.deleted_at is null and i.accepted_at is null
        and i.expires_at > now()) >= 20 then
    perform public.household_refuse('too_many_invites');
  end if;
  -- 32 bytes from two random UUIDs (244 random bits), as base64url.
  code := translate(rtrim(encode(decode(
    replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'hex'), 'base64'), '='), '+/', '-_');
  insert into public.invites (household_id, role, token_hash, expires_at)
  values (home, invite_role, sha256(convert_to(code, 'UTF8')), now() + interval '7 days')
  returning invites.id, invites.expires_at into new_id, new_expiry;
  return query select new_id, code, new_expiry;
end;
$$;

create function public.cancel_invite(invite_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  home uuid;
  my_role public.household_role;
begin
  select l.household, l.my_role into home, my_role from public.lock_my_household() l;
  if my_role <> 'admin' then perform public.household_refuse('forbidden'); end if;
  update public.invites set deleted_at = now()
  where invites.id = invite_id and household_id = home and accepted_at is null and deleted_at is null;
  if not found then perform public.household_refuse('invite_unknown'); end if;
end;
$$;

create function public.preview_invite(code text)
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

create function public.accept_invite(code text)
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
  end if;

  update public.memberships m
  set household_id = inv.household_id, role = inv.role, email = coalesce(mail, m.email)
  where m.user_id = public.auth_user_id();
  update public.invites i set accepted_at = now(), accepted_by = public.auth_user_id() where i.id = inv.id;
  return query select inv.household_id, home, recipes_moved, photos_moved;
end;
$$;

-- ---------------------------------------------------------------- members

create function public.set_member_role(target uuid, new_role public.household_role) returns void
language plpgsql security definer set search_path = '' as $$
declare
  home uuid;
  my_role public.household_role;
  target_role public.household_role;
begin
  select l.household, l.my_role into home, my_role from public.lock_my_household() l;
  if my_role <> 'admin' then perform public.household_refuse('forbidden'); end if;
  select m.role into target_role from public.memberships m where m.user_id = target and m.household_id = home;
  if target_role is null then perform public.household_refuse('not_member'); end if;
  if target_role = 'admin' and new_role <> 'admin' and (
       select count(*) from public.memberships m where m.household_id = home and m.role = 'admin') <= 1 then
    perform public.household_refuse('last_admin');
  end if;
  update public.memberships set role = new_role where user_id = target;
end;
$$;

create function public.remove_member(target uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  home uuid;
  my_role public.household_role;
begin
  select l.household, l.my_role into home, my_role from public.lock_my_household() l;
  if my_role <> 'admin' then perform public.household_refuse('forbidden'); end if;
  if target = public.auth_user_id() then perform public.household_refuse('forbidden'); end if;
  if not exists (select 1 from public.memberships m where m.user_id = target and m.household_id = home) then
    perform public.household_refuse('not_member');
  end if;
  perform public.move_to_new_household(target);
end;
$$;

create function public.leave_household() returns void
language plpgsql security definer set search_path = '' as $$
declare
  home uuid;
  my_role public.household_role;
begin
  select l.household, l.my_role into home, my_role from public.lock_my_household() l;
  if not exists (select 1 from public.memberships m
                 where m.household_id = home and m.user_id <> public.auth_user_id()) then
    perform public.household_refuse('alone');
  end if;
  if my_role = 'admin' and not exists (
       select 1 from public.memberships m
       where m.household_id = home and m.role = 'admin' and m.user_id <> public.auth_user_id()) then
    perform public.household_refuse('only_admin');
  end if;
  perform public.move_to_new_household(public.auth_user_id());
end;
$$;

-- ---------------------------------------------------------------- grants

revoke execute on function public.household_refuse(text), public.lock_my_household(),
  public.move_to_new_household(uuid) from public;
revoke execute on function public.create_invite(public.household_role), public.cancel_invite(uuid),
  public.preview_invite(text), public.accept_invite(text), public.set_member_role(uuid, public.household_role),
  public.remove_member(uuid), public.leave_household() from public;
grant execute on function public.create_invite(public.household_role), public.cancel_invite(uuid),
  public.preview_invite(text), public.accept_invite(text), public.set_member_role(uuid, public.household_role),
  public.remove_member(uuid), public.leave_household() to authenticated;

-- migrate:down
drop function public.leave_household();
drop function public.remove_member(uuid);
drop function public.set_member_role(uuid, public.household_role);
drop function public.accept_invite(text);
drop function public.preview_invite(text);
drop function public.cancel_invite(uuid);
drop function public.create_invite(public.household_role);
drop function public.move_to_new_household(uuid);
drop function public.lock_my_household();
drop function public.household_refuse(text);
drop table public.invites;
