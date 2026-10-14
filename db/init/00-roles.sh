#!/bin/sh
# Runs once, when the database volume is first created.
# Creates the roles of spec §4, the schema GoTrue migrates into, and the
# separate database PowerSync keeps its buckets in.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v app_owner_pw="$APP_OWNER_PASSWORD" \
  -v api_login_pw="$API_LOGIN_PASSWORD" \
  -v auth_db_pw="$AUTH_DB_PASSWORD" \
  -v ps_repl_pw="$POWERSYNC_REPL_PASSWORD" \
  -v ps_storage_pw="$POWERSYNC_STORAGE_PASSWORD" <<'SQL'
-- Owns every object in the public schema. Used only by the migrate job.
create role app_owner login password :'app_owner_pw';

-- The role every user statement runs as. Nobody logs in as it.
create role authenticated nologin;

-- The API's login. Owns nothing, cannot bypass RLS, and can only switch to
-- "authenticated" (noinherit: it holds no table rights until it does).
create role api_login login noinherit password :'api_login_pw';
grant authenticated to api_login;

-- GoTrue. The role name is fixed by GoTrue's own migrations.
create role supabase_auth_admin login noinherit createrole password :'auth_db_pw';

-- PowerSync reads the replication stream and takes the initial snapshot, so it
-- must see every row. What reaches a device is limited by the sync config.
create role powersync_repl login replication bypassrls password :'ps_repl_pw';

-- PowerSync's own storage lives in a separate database.
create role powersync_storage login password :'ps_storage_pw';
create database powersync_storage owner powersync_storage;

-- Only the roles that need the app database may connect to it.
revoke connect on database app from public;
grant connect on database app to app_owner, api_login, supabase_auth_admin, powersync_repl;

create schema auth authorization supabase_auth_admin;
alter role supabase_auth_admin set search_path = auth;
grant create on database app to supabase_auth_admin;

alter schema public owner to app_owner;
-- create on database: needed to create the replication publication.
grant create on database app to app_owner;
create schema dbmate authorization app_owner;

-- Our migration references auth.users and puts the sign-up trigger on it.
-- GoTrue creates that table later, so grant through default privileges.
grant usage on schema auth to app_owner;
alter default privileges for role supabase_auth_admin in schema auth
  grant references, trigger on tables to app_owner;
SQL
