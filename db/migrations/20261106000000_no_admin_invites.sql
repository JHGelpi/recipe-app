-- migrate:up
-- Issue #71: an invite is a bearer link; whoever opens it first joins at its
-- role. An Admin invite forwarded or previewed by the wrong person handed over
-- the household. Invites now make only Members and Viewers; an Admin promotes
-- someone after they join (set_member_role). Pending Admin invites are
-- cancelled, so their links say the invite was cancelled.

-- As 20261021000001, refusing the Admin role.
create or replace function public.create_invite(invite_role public.household_role)
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
  if invite_role is null or invite_role = 'admin' then perform public.household_refuse('forbidden'); end if;
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

update public.invites set deleted_at = now()
where role = 'admin' and accepted_at is null and deleted_at is null;

-- migrate:down
-- Roll forward: the earlier body issued Admin invites.
select 1;
