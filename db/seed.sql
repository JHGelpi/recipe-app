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
