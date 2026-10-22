-- migrate:up
-- Single-use invitation links (FR-42). Runs as app_owner.
-- Household invites (FR-3) already work once: accept_invite locks the row and
-- refuses a second use. Friend links (FR-6) now do too:
-- - a sign-up pass from a friend link reserves the link for that address, so
--   a second address is refused while the pass lives (24 hours);
-- - creating the account marks the link accepted, and it never works again.
-- An address that never signs up does not use the link up: its reservation
-- lapses with its pass.

alter table public.friend_links
  add column accepted_at timestamptz,
  add column accepted_by uuid references auth.users (id) on delete set null,
  add column accepted_email text check (char_length(accepted_email) <= 254);

-- Which friend link a pass came from. Passes from other links leave it null.
alter table public.signup_passes
  add column friend_link_id uuid references public.friend_links (id) on delete set null;
create index signup_passes_friend_link_id_idx on public.signup_passes (friend_link_id);

-- As 20261023000000, with the friend branch reserving the link.
create or replace function public.grant_signup_pass(link_kind text, link_code text, address text)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  who text := lower(btrim(coalesce(address, '')));
  hash bytea := sha256(convert_to(coalesce(link_code, ''), 'UTF8'));
  live boolean;
  link uuid;
begin
  delete from public.signup_passes p where p.expires_at <= now();
  if length(who) > 254 or who !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    return false;
  end if;
  if link_kind = 'friend' then
    -- Locked, so two addresses asking at once are served one at a time.
    select f.id into link from public.friend_links f
    join public.households h on h.id = f.household_id
    where f.token_hash = hash and f.deleted_at is null and f.expires_at > now()
      and f.accepted_at is null and h.deleted_at is null
    for update of f;
    if link is null then return false; end if;
    -- Someone with an account signs in whatever the pass says: no reservation.
    if exists (select 1 from public.memberships m where lower(m.email) = who) then
      link := null;
    -- Held for another address whose pass still lives: the first one wins.
    elsif exists (select 1 from public.signup_passes p
                  where p.friend_link_id = link and p.email <> who and p.expires_at > now()) then
      return false;
    end if;
    insert into public.signup_passes (email, expires_at, friend_link_id)
    values (who, now() + interval '24 hours', link)
    on conflict (email) do update
    set expires_at = excluded.expires_at, friend_link_id = excluded.friend_link_id;
    return true;
  end if;
  live := case link_kind
    when 'invite' then exists (
      select 1 from public.invites i
      where i.token_hash = hash and i.deleted_at is null and i.accepted_at is null
        and i.expires_at > now())
    when 'share' then coalesce((select r.status = 'ok' from public.read_share(link_code) r), false)
    else false
  end;
  if not live then return false; end if;
  -- A pass from another kind of link releases any friend link this address held.
  insert into public.signup_passes (email, expires_at) values (who, now() + interval '24 hours')
  on conflict (email) do update set expires_at = excluded.expires_at, friend_link_id = null;
  return true;
end;
$$;

-- As 20261021000000, plus: a new account made with a friend link's pass uses
-- that link up (FR-42).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  new_household_id uuid;
  who text := lower(btrim(coalesce(new.email, '')));
begin
  insert into public.households (name, updated_by)
  values (coalesce(nullif(split_part(new.email, '@', 1), ''), 'My') || ' household', new.id)
  returning id into new_household_id;

  insert into public.memberships (household_id, user_id, role, email, updated_by)
  values (new_household_id, new.id, 'admin', new.email, new.id);

  update public.friend_links f
  set accepted_at = now(), accepted_by = new.id, accepted_email = who
  from public.signup_passes p
  where p.email = who and p.friend_link_id = f.id and f.accepted_at is null;
  update public.signup_passes p set friend_link_id = null
  where p.email = who and p.friend_link_id is not null;

  return new;
end;
$$;

-- As 20261026000000, plus 'used' once a friend link was accepted.
create or replace function public.friend_link_status(link_code text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  link public.friend_links;
  open boolean;
begin
  select * into link from public.friend_links f
  where f.token_hash = sha256(convert_to(coalesce(link_code, ''), 'UTF8'));
  if not found then return 'unknown'; end if;
  if link.accepted_at is not null then return 'used'; end if;
  select h.deleted_at is null into open from public.households h where h.id = link.household_id;
  return case when link.deleted_at is null and link.expires_at > now() and open then 'live' else 'ended' end;
end;
$$;

-- As 20261026000000; an accepted link is history, not revocable.
create or replace function public.revoke_friend_link(link_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  home uuid;
begin
  select l.household into home from public.lock_my_household() l;
  update public.friend_links f set deleted_at = now()
  where f.id = link_id and f.household_id = home and f.deleted_at is null and f.expires_at > now()
    and f.accepted_at is null;
  if not found then perform public.household_refuse('link_unknown'); end if;
end;
$$;

-- As 20261023000000; accepted links no longer count toward the 50 pending.
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
  insert into public.friend_links (household_id, token_hash, expires_at)
  values (home, sha256(convert_to(code, 'UTF8')), now() + interval '30 days')
  returning friend_links.id, friend_links.expires_at into new_id, new_expiry;
  return query select new_id, code, new_expiry;
end;
$$;

-- migrate:down
-- Roll forward: the earlier bodies let a friend link be used any number of times.
select 1;
