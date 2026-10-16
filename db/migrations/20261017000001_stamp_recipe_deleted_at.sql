-- migrate:up
-- FR-18: the server decides when a recipe went to the Trash. The 30-day purge
-- is irreversible, so its clock must not be a device's: a wrong device clock,
-- or a back-dated upload, would otherwise delete a recipe at once.
-- Runs as app_owner.

create function public.stamp_deleted_at() returns trigger
language plpgsql
as $$
begin
  -- Only client writes (asUser switches to "authenticated") are stamped.
  -- The owner and maintenance or test arrangements keep the value they set.
  if current_user <> 'authenticated' then
    return new;
  end if;

  if new.deleted_at is null then
    return new; -- not trashed, or restored
  end if;

  if tg_op = 'UPDATE' and old.deleted_at is not null then
    new.deleted_at := old.deleted_at; -- already trashed: keep the original time
  else
    new.deleted_at := now(); -- newly trashed: the server's time
  end if;
  return new;
end;
$$;

create trigger recipes_stamp_deleted_at before insert or update of deleted_at on public.recipes
for each row execute function public.stamp_deleted_at();

-- migrate:down
drop trigger recipes_stamp_deleted_at on public.recipes;
drop function public.stamp_deleted_at();
