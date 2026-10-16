# 0008. Self-hosted, containerized backend

- **Status:** Accepted
- **Date:** 2026-10-13
- **Supersedes:** ADR-0003
- **Amends:** ADR-0004 (the sync service is self-hosted, not managed), ADR-0006 (claim names)

## Context
ADR-0003 chose the Supabase platform and ADR-0004 assumed PowerSync Cloud. The owner rejected both on recurring cost and wants production containerized and portable: this app is also a proving ground for a later app that will be hosted somewhere other than the owner's own machine. Load is family-scale.

## Decision
Run the backend as **our own containers in one Docker Compose file**, self-hosted on the owner's hardware. The same file runs locally and in production; only `.env` differs.

| Container | Software |
|---|---|
| `proxy` | Caddy: single entry point, serves the built web app, routes `/auth`, `/api`, `/sync` |
| `api` | Our Node/TypeScript service (Hono, `postgres` driver, `jose`), bundled with esbuild |
| `auth` | GoTrue, standalone (the open-source auth server Supabase maintains) |
| `db` | Postgres 17 with RLS and logical replication |
| `migrate` | dbmate, one-shot, plain SQL migrations in `db/migrations/` |
| `sync` | PowerSync service, bucket storage in a second database on the same Postgres |
| `mail` | Mailpit, local development and tests only |

Tenant isolation without a platform: the API logs in as `api_login`, a role that owns nothing and cannot bypass RLS, and reaches the database only through `asUser`, which verifies the token and runs one transaction as the role `authenticated` with the verified claims set. Policies read those claims through `auth_user_id()`, `auth_household_id()`, and `auth_household_role()`. `powersync_repl` is the only non-superuser role that bypasses RLS; what it replicates is scoped by the sync config.

GoTrue signs tokens with an asymmetric key (ES256) and publishes the public half; `api` and `sync` verify against it and hold no signing secret.

The built web app calls same-origin relative paths, so no image contains a host name, key, or password.

## Alternatives considered
- **Supabase platform (ADR-0003):** least code, but a recurring fee, and the full self-hosted Supabase stack is far heavier than this app needs.
- **One GCP VM running the same Compose file:** datacentre uptime for roughly $13 to $25 a month. Kept as the fallback; moving is a database restore and a DNS change.
- **GCP managed services (Cloud Run, Cloud SQL, Cloud Storage):** managed backups and least operations, but the highest cost, a sync service that cannot scale to zero, and production no longer matching local.
- **Our own auth in the API:** fewest containers, but we would own security-sensitive code (code expiry, rate limiting, refresh) and Apple/Google sign-in later.
- **Keycloak or Zitadel:** vendor-neutral and reusable, but heavy for this app.
- **PostgREST in place of an API:** cannot validate with the shared zod schema, and import and AI need real code later.
- **Deno for the API:** a second runtime and an import-map workaround for the shared domain package.

## Consequences
- No platform fee and no accounts. The stack moves to another host by copying `.env` and the database.
- We own uptime, patching, and backups. NFR-8 (99.5%) and NFR-9 (daily backups with point-in-time recovery) are not met yet; the hosting sub-project must add off-site backups and decide how the server is reached from the internet.
- A real email provider is needed in production; GoTrue takes SMTP settings from `.env`.
- File storage for photos is undecided; it is chosen in the import sub-project.
- PowerSync's Postgres bucket storage is labelled Beta. Fallback: add a MongoDB container; only `powersync/service.yaml` and the Compose file change.
- `db/init/00-roles.sh` runs only when the database volume is first created. A later change to roles needs a migration or a manual statement on existing hosts.
- The custom role claim is `household_role`, not `role`: GoTrue uses `role` itself. This corrects ADR-0006's wording.
- With the access-token hook enabled, GoTrue issues the first tokens after it starts with `aud` as `["authenticated"]` rather than `"authenticated"`. Verifiers must accept both forms (`jose` and PowerSync do).
- The API image installs with esbuild's postinstall script disabled (`allowBuilds` in `pnpm-workspace.yaml`); esbuild's platform binary comes from its optional dependency, so the script is not needed and pnpm would otherwise refuse the install.
- New dependencies: GoTrue, `@supabase/auth-js`, Hono, `@hono/node-server`, `postgres`, `jose`, esbuild, dbmate, Caddy, Mailpit.
