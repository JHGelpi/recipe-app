-- migrate:up
-- Bug batch §4 (ADR-0016): Link hands out the recipe's live link again rather
-- than making a new one each tap, so a link's code is kept. Not synced; read
-- by the household through the API, which can make links anyway. Links made
-- before this have no kept code and are never reused.
alter table public.shares add column kept_code text;

create or replace function public.create_share(share_id uuid, recipe uuid, snap jsonb)
returns table (id uuid, token text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  home uuid := public.auth_household_id();
  existing public.shares;
  new_code text;
begin
  if home is null or not exists (
       select 1 from public.recipes r where r.id = recipe and r.household_id = home and r.deleted_at is null) then
    perform public.household_refuse('forbidden');
  end if;
  select * into existing from public.shares s where s.id = share_id for update;
  if found then
    -- Only this recipe's own live link, whose code was kept, is reused.
    if existing.household_id <> home or existing.recipe_id <> recipe
       or existing.deleted_at is not null or existing.kept_code is null then
      perform public.household_refuse('forbidden');
    end if;
    update public.shares s set snapshot = snap where s.id = share_id;
    return query select share_id, existing.kept_code;
    return;
  end if;
  new_code := translate(rtrim(encode(decode(
    replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'hex'), 'base64'), '='), '+/', '-_');
  insert into public.shares (id, household_id, recipe_id, token_hash, snapshot, kept_code)
  values (share_id, home, recipe, sha256(convert_to(new_code, 'UTF8')), snap, new_code);
  return query select share_id, new_code;
end;
$$;

-- migrate:down
-- Roll forward: the earlier body made a new link on every call.
select 1;
