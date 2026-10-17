-- migrate:up
-- Roles and invites, part 1 (FR-4, FR-5, NFR-1; ADR-0015). Runs as app_owner.

-- ---------------------------------------------------------------- live role checks

-- A role or household change must bind at once, not when the caller's
-- token expires. The helpers read the caller's membership instead of the
-- token's claims. Security definer, because memberships' own policy calls
-- them (reading memberships under RLS here would recurse). They return only
-- the caller's own household and role.
create or replace function public.auth_household_id() returns uuid
language sql stable security definer set search_path = ''
as $$
  select m.household_id from public.memberships m
  where m.user_id = public.auth_user_id() and m.deleted_at is null
$$;

create or replace function public.auth_household_role() returns public.household_role
language sql stable security definer set search_path = ''
as $$
  select m.role from public.memberships m
  where m.user_id = public.auth_user_id() and m.deleted_at is null
$$;

-- ---------------------------------------------------------------- member emails

alter table public.memberships add column email text check (char_length(email) <= 320);

-- A user always reads their own row (the my_membership stream), and the
-- rows of their household (household_members).
drop policy memberships_select on public.memberships;
create policy memberships_select on public.memberships
for select to authenticated
using (
  household_id = (select public.auth_household_id())
  or (user_id = (select public.auth_user_id()) and deleted_at is null)
);

-- FR-2 unchanged, plus the email for the Household screen.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  new_household_id uuid;
begin
  insert into public.households (name, updated_by)
  values (coalesce(nullif(split_part(new.email, '@', 1), ''), 'My') || ' household', new.id)
  returning id into new_household_id;

  insert into public.memberships (household_id, user_id, role, email, updated_by)
  values (new_household_id, new.id, 'admin', new.email, new.id);

  return new;
end;
$$;

-- The token hook also records the email it is given, so members who signed
-- up before this migration get one at their next token. A failure there must
-- never stop a sign-in.
create or replace function public.custom_access_token_hook(event jsonb) returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  claims jsonb := event -> 'claims';
  membership record;
begin
  select m.household_id, m.role, m.email into membership
  from public.memberships m
  where m.user_id = (event ->> 'user_id')::uuid and m.deleted_at is null;

  if found then
    claims := jsonb_set(claims, '{household_id}', to_jsonb(membership.household_id::text));
    claims := jsonb_set(claims, '{household_role}', to_jsonb(membership.role::text));
    if claims ->> 'email' is not null and membership.email is distinct from claims ->> 'email' then
      begin
        update public.memberships set email = claims ->> 'email'
        where user_id = (event ->> 'user_id')::uuid;
      exception when others then
        null;
      end;
    end if;
  end if;

  return jsonb_build_object('claims', claims);
end;
$$;

-- ---------------------------------------------------------------- deferrable keys

-- Moving a person's data between households (accept_invite) changes
-- household_id table by table; these checks wait for the end of that
-- transaction. Everywhere else they stay immediate.
alter table public.photos alter constraint photos_import_id_household_id_fkey deferrable initially immediate;
alter table public.photos alter constraint photos_recipe_id_household_id_fkey deferrable initially immediate;
alter table public.recipes alter constraint recipes_photo_fkey deferrable initially immediate;
alter table public.substitutions alter constraint substitutions_recipe_id_household_id_fkey deferrable initially immediate;

-- ---------------------------------------------------------------- sync

-- Mirrored by powersync/sync-config.yaml (household_members, my_membership,
-- household_info). Change both together.
alter publication powersync add table public.memberships, public.households;
grant select on public.memberships, public.households to powersync_repl;

-- migrate:down
alter publication powersync drop table public.memberships, public.households;
alter table public.substitutions alter constraint substitutions_recipe_id_household_id_fkey not deferrable;
alter table public.recipes alter constraint recipes_photo_fkey not deferrable;
alter table public.photos alter constraint photos_recipe_id_household_id_fkey not deferrable;
alter table public.photos alter constraint photos_import_id_household_id_fkey not deferrable;
drop policy memberships_select on public.memberships;
create policy memberships_select on public.memberships
for select to authenticated
using (household_id = (select public.auth_household_id()));
alter table public.memberships drop column email;
