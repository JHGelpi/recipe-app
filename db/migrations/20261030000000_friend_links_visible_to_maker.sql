-- migrate:up
-- Friend links are seen and revoked only by Admins and the person who made
-- each one (FR-6, issue #33). Runs as app_owner. Household invites (FR-3) are
-- unchanged: already Admin-only.

-- Who made the link. updated_by can't serve: a revoke or acceptance overwrites it.
alter table public.friend_links
  add column created_by uuid references auth.users (id) on delete set null;

-- Existing links: a row never updated since it was made still carries its
-- maker in updated_by (stamp_row sets both times from one transaction). Others
-- (revoked or used) keep no maker and are visible to Admins only.
update public.friend_links set created_by = updated_by
where updated_at = created_at and updated_by is not null;

drop policy friend_links_select on public.friend_links;
create policy friend_links_select on public.friend_links
for select to authenticated
using (
  household_id = (select public.auth_household_id())
  and (
    (select public.auth_household_role()) = 'admin'
    or created_by = (select public.auth_user_id())
  )
);

-- As 20261028000000, plus created_by.
create or replace function public.create_friend_link()
returns table (id uuid, token text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  home uuid;
  code text;
  new_id uuid;
  new_expiry timestamptz;
begin
  -- Any member may invite a friend to start their own household: it adds
  -- nothing to this one, so viewers may too.
  select l.household into home from public.lock_my_household() l;
  if (select count(*) from public.friend_links f
      where f.household_id = home and f.deleted_at is null and f.expires_at > now()
        and f.accepted_at is null) >= 50 then
    perform public.household_refuse('too_many_invites');
  end if;
  code := translate(rtrim(encode(decode(
    replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'hex'), 'base64'), '='), '+/', '-_');
  insert into public.friend_links (household_id, token_hash, expires_at, created_by)
  values (home, sha256(convert_to(code, 'UTF8')), now() + interval '30 days', public.auth_user_id())
  returning friend_links.id, friend_links.expires_at into new_id, new_expiry;
  return query select new_id, code, new_expiry;
end;
$$;

-- As 20261028000000, limited to Admins and the link's maker. Anyone else gets
-- link_unknown, so the answer doesn't say the link exists. The role is read
-- live under the household lock (ADR-0015).
create or replace function public.revoke_friend_link(link_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  home uuid;
  my_role public.household_role;
begin
  select l.household, l.my_role into home, my_role from public.lock_my_household() l;
  update public.friend_links f set deleted_at = now()
  where f.id = link_id and f.household_id = home and f.deleted_at is null and f.expires_at > now()
    and f.accepted_at is null
    and (my_role = 'admin' or f.created_by = public.auth_user_id());
  if not found then perform public.household_refuse('link_unknown'); end if;
end;
$$;

-- migrate:down
-- Roll forward: the earlier policy showed every link to the whole household.
select 1;
