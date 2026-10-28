-- migrate:up
-- Sign-up through links is bounded (issue #62). Runs as app_owner.
-- - A recipe share link makes at most one account, the way a friend link does
--   (FR-42): a pass from it holds the share for that address for 24 hours,
--   and the account made with that pass uses the share's sign-up up. The share
--   itself keeps working for reading and for people who already have accounts.
-- - A person may have at most 10 pending friend links (the household's 50
--   stays): every link can make an account, so one person can't mint many.

-- Which share made an account. A system table, not a column on shares: shares
-- syncs to devices, and who signed up through a link is not household data.
create table public.share_signups (
  share_id uuid primary key references public.shares (id) on delete cascade,
  accepted_at timestamptz not null default now(),
  accepted_by uuid references auth.users (id) on delete set null
);
-- RLS on and no policies or grants, like the signup_* tables: only the
-- functions below and the postgres login reach these rows.
alter table public.share_signups enable row level security;
revoke all on public.share_signups from public;

-- Which share a pass came from. Passes from other links leave it null.
alter table public.signup_passes
  add column share_id uuid references public.shares (id) on delete set null;
create index signup_passes_share_id_idx on public.signup_passes (share_id);

-- As 20261028000000, plus the share branch holding the share like a friend link.
create or replace function public.grant_signup_pass(link_kind text, link_code text, address text)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  who text := lower(btrim(coalesce(address, '')));
  hash bytea := sha256(convert_to(coalesce(link_code, ''), 'UTF8'));
  live boolean;
  link uuid;
  has_account boolean;
begin
  delete from public.signup_passes p where p.expires_at <= now();
  if length(who) > 254 or who !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    return false;
  end if;
  -- Someone with an account signs in whatever the pass says: no link is held.
  has_account := exists (select 1 from public.memberships m where lower(m.email) = who);
  if link_kind = 'friend' then
    -- Locked, so two addresses asking at once are served one at a time.
    select f.id into link from public.friend_links f
    join public.households h on h.id = f.household_id
    where f.token_hash = hash and f.deleted_at is null and f.expires_at > now()
      and f.accepted_at is null and h.deleted_at is null
    for update of f;
    if link is null then return false; end if;
    if has_account then
      link := null;
    -- Held for another address whose pass still lives: the first one wins.
    elsif exists (select 1 from public.signup_passes p
                  where p.friend_link_id = link and p.email <> who and p.expires_at > now()) then
      return false;
    end if;
    insert into public.signup_passes (email, expires_at, friend_link_id)
    values (who, now() + interval '24 hours', link)
    on conflict (email) do update
    set expires_at = excluded.expires_at, friend_link_id = excluded.friend_link_id, share_id = null;
    return true;
  end if;
  if link_kind = 'share' then
    if not coalesce((select r.status = 'ok' from public.read_share(link_code) r), false) then
      return false;
    end if;
    -- Locked as for friend links.
    select s.id into link from public.shares s where s.token_hash = hash for update;
    if link is null then return false; end if;
    if has_account then
      link := null;
    -- Already made its one account.
    elsif exists (select 1 from public.share_signups u where u.share_id = link) then
      return false;
    elsif exists (select 1 from public.signup_passes p
                  where p.share_id = link and p.email <> who and p.expires_at > now()) then
      return false;
    end if;
    insert into public.signup_passes (email, expires_at, share_id)
    values (who, now() + interval '24 hours', link)
    on conflict (email) do update
    set expires_at = excluded.expires_at, share_id = excluded.share_id, friend_link_id = null;
    return true;
  end if;
  live := case link_kind
    when 'invite' then exists (
      select 1 from public.invites i
      where i.token_hash = hash and i.deleted_at is null and i.accepted_at is null
        and i.expires_at > now())
    else false
  end;
  if not live then return false; end if;
  -- A pass from an invite releases any friend link or share this address held.
  insert into public.signup_passes (email, expires_at) values (who, now() + interval '24 hours')
  on conflict (email) do update
  set expires_at = excluded.expires_at, friend_link_id = null, share_id = null;
  return true;
end;
$$;

-- As 20261028000000, plus: a new account made with a share's pass uses that
-- share's sign-up up.
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
  insert into public.share_signups (share_id, accepted_by)
  select p.share_id, new.id from public.signup_passes p
  where p.email = who and p.share_id is not null
  on conflict (share_id) do nothing;
  update public.signup_passes p set friend_link_id = null, share_id = null
  where p.email = who and (p.friend_link_id is not null or p.share_id is not null);

  return new;
end;
$$;

-- As 20261030000000, plus at most 10 pending links per person.
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
        and f.accepted_at is null) >= 50
     or (select count(*) from public.friend_links f
         where f.household_id = home and f.created_by = public.auth_user_id()
           and f.deleted_at is null and f.expires_at > now() and f.accepted_at is null) >= 10 then
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

-- migrate:down
-- Roll forward: the earlier bodies let a share link mint passes for any number of emails.
select 1;
