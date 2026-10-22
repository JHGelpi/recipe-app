-- Local development and test data. Applied only by `pnpm db:seed`, as the
-- superuser; never part of a production start.
-- Household A: admin, member, viewer. Household B: admin.

insert into public.households (id, name) values
  ('00000000-0000-0000-0000-00000000000a', 'Household A'),
  ('00000000-0000-0000-0000-00000000000b', 'Household B');

-- Inserting users fires handle_new_user, which gives each one a household of
-- their own. The statements after this block move them into A and B.
with seed_users (id, email) as (
  values
    ('00000000-0000-0000-0000-0000000000a1'::uuid, 'admin-a@example.test'),
    ('00000000-0000-0000-0000-0000000000a2'::uuid, 'member-a@example.test'),
    ('00000000-0000-0000-0000-0000000000a3'::uuid, 'viewer-a@example.test'),
    ('00000000-0000-0000-0000-0000000000b1'::uuid, 'admin-b@example.test')
),
inserted_users as (
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new
  )
  select
    '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', email, '',
    now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
  from seed_users
  returning id, email
)
insert into auth.identities (
  id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
)
select
  gen_random_uuid(), id, id::text,
  jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true),
  'email', now(), now(), now()
from inserted_users;

update public.memberships m
set household_id = s.household_id, role = s.role
from (
  values
    ('00000000-0000-0000-0000-0000000000a1'::uuid, '00000000-0000-0000-0000-00000000000a'::uuid, 'admin'::public.household_role),
    ('00000000-0000-0000-0000-0000000000a2'::uuid, '00000000-0000-0000-0000-00000000000a'::uuid, 'member'::public.household_role),
    ('00000000-0000-0000-0000-0000000000a3'::uuid, '00000000-0000-0000-0000-00000000000a'::uuid, 'viewer'::public.household_role),
    ('00000000-0000-0000-0000-0000000000b1'::uuid, '00000000-0000-0000-0000-00000000000b'::uuid, 'admin'::public.household_role)
) as s (user_id, household_id, role)
where m.user_id = s.user_id;

-- Remove the households the trigger created for the seed users.
delete from public.households h
where not exists (select 1 from public.memberships m where m.household_id = h.id);

insert into public.recipes (id, household_id, title) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000000a', 'Seed pancakes'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-00000000000b', 'Seed curry');

-- One favorite per household, so the isolation suite's favorites checks are
-- not vacuous: each household's admin has starred its seed recipe.
insert into public.favorites (id, household_id, user_id, recipe_id) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c2');

-- One import and one usage row per household, so the isolation suite's checks
-- on them are not vacuous. The imports are settled failures that cannot be
-- retried, so no device ever sends them for parsing.
insert into public.imports (id, household_id, source_type, source_text, status, error) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000000a', 'text', 'Seed note A', 'failed', 'not_a_recipe'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000000b', 'text', 'Seed note B', 'failed', 'not_a_recipe');

insert into public.ai_usage (household_id, month, spent_microusd) values
  ('00000000-0000-0000-0000-00000000000a', date_trunc('month', now() at time zone 'utc')::date, 0),
  ('00000000-0000-0000-0000-00000000000b', date_trunc('month', now() at time zone 'utc')::date, 0);

-- One photo row per household, so the isolation suite's photos checks are not
-- vacuous. Each is a dish photo of its household's seed recipe, but no recipe
-- uses it as its photo and no file exists, so no device ever downloads it.
insert into public.photos (id, household_id, kind, recipe_id, media_type, bytes, width, height) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000000a', 'dish', '00000000-0000-0000-0000-0000000000c1', 'image/jpeg', 1, 1, 1),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000000b', 'dish', '00000000-0000-0000-0000-0000000000c2', 'image/jpeg', 1, 1, 1);

-- One remembered substitution per household, so the isolation suite's
-- substitutions checks are not vacuous. The ingredient id matches no line,
-- so no screen shows them.
insert into public.substitutions (id, household_id, recipe_id, ingredient_id, ingredient_raw, options, note) values
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000e5', 'Seed line', '[]', 'Seed note'),
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000e6', 'Seed line', '[]', 'Seed note');

-- One invite per household, so the isolation suite's invites checks are not
-- vacuous. Both are already used, so no code can ever accept them.
insert into public.invites (id, household_id, role, token_hash, expires_at, accepted_at) values
  ('00000000-0000-0000-0000-0000000000e7', '00000000-0000-0000-0000-00000000000a', 'member', sha256(convert_to('seed invite a', 'UTF8')), now(), now()),
  ('00000000-0000-0000-0000-0000000000e8', '00000000-0000-0000-0000-00000000000b', 'member', sha256(convert_to('seed invite b', 'UTF8')), now(), now());

-- One stopped share per household, so the isolation suite's shares checks are
-- not vacuous. Both are stopped, so no link reads them.
insert into public.shares (id, household_id, recipe_id, token_hash, snapshot, deleted_at) values
  ('00000000-0000-0000-0000-0000000000e9', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c1', sha256(convert_to('seed share a', 'UTF8')), '{}', now()),
  ('00000000-0000-0000-0000-0000000000ea', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000c2', sha256(convert_to('seed share b', 'UTF8')), '{}', now());

-- One expired friend link per household, so the isolation suite's friend_links
-- checks are not vacuous. Both are expired, so no code grants a pass.
insert into public.friend_links (id, household_id, token_hash, expires_at) values
  ('00000000-0000-0000-0000-0000000000eb', '00000000-0000-0000-0000-00000000000a', sha256(convert_to('seed friend a', 'UTF8')), now()),
  ('00000000-0000-0000-0000-0000000000ec', '00000000-0000-0000-0000-00000000000b', sha256(convert_to('seed friend b', 'UTF8')), now());

-- One list row and one aisle choice per household, so the isolation suite's
-- checks of these tables are not vacuous.
insert into public.shopping_items (id, household_id, item, item_key, aisle) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-00000000000a', 'Seed onions', 'seed onion', 'produce'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-00000000000b', 'Seed onions', 'seed onion', 'produce');
insert into public.aisle_choices (id, household_id, item_key, aisle) values
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-00000000000a', 'seed onion', 'produce'),
  ('00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-00000000000b', 'seed onion', 'produce');

-- One cook log entry per household, so the isolation suite's cook_logs checks
-- are not vacuous.
insert into public.cook_logs (id, household_id, recipe_id, recipe_title, cooked_on, cooked_by) values
  ('00000000-0000-0000-0000-0000000000f5', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c1', 'Seed pancakes', '2026-10-20', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000f6', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000c2', 'Seed curry', '2026-10-20', '00000000-0000-0000-0000-0000000000b1');
