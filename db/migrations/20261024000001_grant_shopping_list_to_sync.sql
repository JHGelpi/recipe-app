-- migrate:up
-- The sync service reads every table it replicates (rule 6); the shopping
-- list migration added both tables to the publication without this grant.
-- Runs as app_owner.
grant select on public.shopping_items, public.aisle_choices to powersync_repl;

-- migrate:down
revoke select on public.shopping_items, public.aisle_choices from powersync_repl;
