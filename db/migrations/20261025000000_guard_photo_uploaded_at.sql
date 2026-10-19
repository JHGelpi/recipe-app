-- migrate:up
-- Spec §3: uploaded_at is stamped once, by the API at upload. A policy cannot
-- see the old row, so a trigger guards it.
create function public.photos_guard_uploaded_at() returns trigger
language plpgsql as $$
begin
  if new.uploaded_at is distinct from old.uploaded_at
     and not (old.uploaded_at is null and new.uploaded_at = now()) then
    raise exception 'uploaded_at is set only at upload';
  end if;
  return new;
end $$;

create trigger photos_guard_uploaded_at before update on public.photos
for each row execute function public.photos_guard_uploaded_at();

-- migrate:down
drop trigger photos_guard_uploaded_at on public.photos;
drop function public.photos_guard_uploaded_at();
