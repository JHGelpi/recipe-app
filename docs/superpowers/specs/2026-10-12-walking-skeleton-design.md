# Walking Skeleton — Design

> Status: **Draft for review (revision 2)** · Date: 2026-10-12 · Revised: 2026-10-13
> Sub-project 1 of 7 for Phase 1. Requirements: `docs/SPEC.md`. Architecture: `ARCHITECTURE.md`, `docs/adr/`.
>
> Revision 2 replaces the Supabase platform and PowerSync Cloud with our own containers in one Docker Compose stack, self-hosted on the owner's hardware. Sections 2, 3, 4, 7, 8, 10, 11 and 13 changed; the data model, policies, sync config, `/upload` contract and acceptance criteria did not.

## 1. Purpose

Get from documents to running code by exercising every container in the architecture once, with the least possible in each. The goal is to surface integration problems (auth claims, RLS, sync rules, offline writes, running RLS from our own API, PowerSync's web SDK under Expo) while they are cheap to fix. Feature depth comes in later sub-projects.

**Covers:** FR-1, FR-2, FR-28 and FR-30 (thin: one table, title only), NFR-1, NFR-3, NFR-5.

### Phase 1 decomposition (for context)

| # | Sub-project | Covers |
|---|---|---|
| **1** | **Walking skeleton (this spec)** | FR-1, FR-2, FR-28, FR-30 (thin), NFR-1 |
| 2 | Recipe model and management | FR-15, FR-16, FR-18 |
| 3 | Search | FR-19, FR-20 |
| 4 | Import and AI parsing | FR-7 to FR-12, FR-29, NFR-7 |
| 5 | Cook mode and substitutions | FR-21, FR-22, FR-24 |
| 6 | Roles and invites | FR-3 to FR-6 |
| 7 | Sharing out | FR-26, FR-27 |

A small hosting sub-project (the stack on the owner's server with a domain and HTTPS, off-site backups, service worker, first run on an iPhone) follows this one, before sub-project 2 or alongside it.

## 2. Decisions made during design

| Decision | Choice | Reason |
|---|---|---|
| Delivery platform | **Web first via Expo web**; native iOS/Android later from the same codebase | No paid Apple Developer membership; iOS builds cannot be made from Windows/WSL. Amends ADR-0002 (new ADR-0007). |
| Backend platform | **Our own containers in one Docker Compose stack; no Supabase platform, no PowerSync Cloud** | Owner decision (2026-10-12, reconfirmed 2026-10-13): lowest fixed cost and portability. Supersedes ADR-0003 (new ADR-0008). |
| Production host | **The owner's own hardware** | Owner decision. A single GCP VM running the same Compose file is the fallback; GCP managed services were rejected on cost. |
| Portability | **The stack must move to another host unchanged** | This app is a proving ground for a later app that will be hosted elsewhere. Images are configured by environment only. |
| Auth | **GoTrue as a standalone container** | Open source, no fee; already does email codes, Apple/Google sign-in, and custom claims through a Postgres function. Least security code of our own. |
| API | **Node/TypeScript service** | The workspace is already Node 22 and pnpm, so the API imports `packages/domain` as a normal workspace package. PostgREST alone cannot validate with zod; Deno would add a second runtime. |
| Sync service storage | **A second database on the same Postgres server** | Avoids a MongoDB container. Supported on Postgres 14+; PowerSync labels Postgres storage Beta. |
| Where the skeleton runs | **Local only**, desktop browser at `localhost` | Browser offline storage needs HTTPS or `localhost`; hosting is the follow-up sub-project. |
| Sign-in | **Email one-time code** (6 digits) | Magic links open in Safari, not the home-screen app, and the two do not share a session on iOS. |
| Households per user | One (SPEC §7 Q1 assumption, enforced by a unique constraint) | Spec assumption; unchanged. |
| Write path | Through a minimal **`/upload` endpoint on the API**, per ADR-0004 | Proves the API, its as-user database access, and the shared domain package. |

### Known consequences of web-first

- FR-8's "share a URL into the app from the OS share sheet" is not possible in an iOS web app. Paste-a-link still works. Share-sheet import becomes native-only.
- NFR-12 (App Store compliance, Sign in with Apple) does not apply until a native build exists.
- Users should add the app to the home screen; Safari can clear storage for sites that go unused.

### Known consequences of self-hosting

- We own uptime, patching, and backups. NFR-8 (99.5%) and NFR-9 (daily backups with point-in-time recovery) are not met by the skeleton; the hosting sub-project must address them, including off-site backups.
- File storage for photos is not decided. Nothing in the skeleton needs it; it is chosen in sub-project 4.

## 3. Containers, repo layout and tooling

### Containers

All defined in one `docker-compose.yml`.

| Service | Image | Job |
|---|---|---|
| `proxy` | Caddy, built with the exported web app inside | The single entry point. Serves the web app at `/`; routes `/api/*` to `api`, `/auth/*` to `auth`, `/sync/*` to `sync`. |
| `api` | Built from `apps/api` | `/upload`. Stateless. |
| `auth` | GoTrue | Email-code sign-in; issues JWTs carrying the household claims. Owns the `auth` schema. |
| `db` | Postgres 17, `wal_level=logical` | System of record with RLS. Also hosts the `powersync_storage` database. |
| `migrate` | dbmate | One-shot job: applies `db/migrations`, then exits. |
| `sync` | PowerSync service | Streams household-scoped rows to devices; replicates from `db`. |
| `mail` | Mailpit | Catches sign-in emails. Local development, tests and CI only (Compose profile `dev`). |

**Startup order**, enforced with health checks and `depends_on` conditions: `db` (its init script creates roles, the empty `auth` schema, and the `powersync_storage` database) → `auth` (runs its own migrations) → `migrate` (runs to completion) → `api` and `sync` → `proxy`.

**Configuration:** every service reads environment variables from `.env`; no image contains a host name, key, or password. The web app calls same-origin relative paths (`/api`, `/auth`, `/sync`), so the `proxy` image is identical on every host. Locally the proxy listens on plain HTTP at `localhost:8080`; a domain and automatic HTTPS are switched on by environment values in the hosting sub-project.

### Repo layout

```
apps/mobile/            Expo app, web target, Expo Router
apps/api/               Node API (Hono), Dockerfile, tests
packages/domain/        zod recipe schema; pure functions, no I/O
db/
  init/                 first-boot script: roles, auth schema, storage database
  migrations/           SQL migrations (tables, RLS, triggers, token hook, publication)
  seed.sql              two households for local dev and tests
powersync/
  service.yaml          service config
  sync-config.yaml      household-scoped sync config (Sync Streams)
deploy/
  Caddyfile
  proxy.Dockerfile      builds the web app and copies it into the Caddy image
test-support/           mailbox reader and sign-in helper shared by test suites
e2e/                    Playwright specs
docker-compose.yml      the whole stack
.github/workflows/ci.yml
```

The `supabase/` directory and the Supabase CLI dependency are removed.

- **pnpm workspaces**, one shared strict TypeScript config, ESLint, Prettier. No build orchestrator.
- **Vitest** for unit, isolation, and API tests. **Playwright** for end-to-end.
- **API libraries:** Hono (HTTP), `postgres` (database driver), `jose` (token verification).
- One-time machine setup: enable pnpm through corepack. Node 22 and Docker are already present.

### Commands

```
pnpm install
pnpm dev:backend       # docker compose --profile dev up -d --wait
pnpm dev:web           # Expo web dev server at localhost, pointed at the proxy
pnpm db:reset          # drop app data, re-apply migrations and seed
pnpm test              # unit tests
pnpm test:rls          # isolation suite (needs dev:backend)
pnpm test:api          # /upload tests (needs dev:backend)
pnpm test:e2e          # Playwright against the proxy (needs dev:backend)
pnpm lint && pnpm typecheck
```

`pnpm dev:web` runs on a different origin from the proxy, so the proxy answers cross-origin requests for one dev origin set by environment variable (`CORS_DEV_ORIGIN`), in front of the API, auth and sync services alike. The built app served by the proxy is same-origin and needs no CORS.

### Environment note

The repo is on the Windows drive (`/mnt/d`) and accessed from WSL, where file I/O is slow and file watching is unreliable. The dev server may need polling enabled. WSL is capped at 2 GB of memory; this stack is far lighter than the Supabase CLI stack, but running it with Chromium for the end-to-end tests needs the cap raised to at least 6 GB.

## 4. Data model and tenancy

All tables ship in one migration, with RLS enabled and policies defined in the same file (CLAUDE.md rule 1).

### Tables

| Table | Columns beyond the standard set | Purpose |
|---|---|---|
| `households` | `name text not null` | The tenant. Its `id` is the `household_id` used everywhere else. |
| `memberships` | `household_id uuid not null` → `households`, `user_id uuid not null unique` → `auth.users`, `role` enum (`admin`, `member`, `viewer`) | Links a user to their one household. |
| `recipes` | `household_id uuid not null` → `households` (indexed), `title text not null` | The single tenant data table for the skeleton. |

Standard set on every table: `id uuid primary key`, `created_at`, `updated_at`, `updated_by`, `deleted_at`. `recipes.id` is generated on the client. Delete means setting `deleted_at`; no table has a delete policy.

`households` is the tenant root, so it has no `household_id` column of its own; its `id` plays that role.

### Database roles

| Role | Used by | Rights |
|---|---|---|
| `app_owner` | `migrate` | Owns the `public` schema objects. Never used at request time. |
| `authenticated` | (no login) | The role every user statement runs as. Table grants plus RLS apply to it. |
| `api_login` | `api` | Login only. Owns nothing, no `BYPASSRLS`, `NOINHERIT`; may `SET ROLE authenticated` and nothing else. |
| `supabase_auth_admin` | `auth` | Owns the `auth` schema. May execute the token hook. The name is fixed by GoTrue. |
| `powersync_repl` | `sync` | `REPLICATION` and `BYPASSRLS`, read-only on published tables. What reaches a device is limited by the sync config (rule 6). |
| `powersync_storage` | `sync` | Owns the separate `powersync_storage` database; no access to the app database. |

`powersync_repl` is the only role that bypasses RLS at runtime. It replaces the "service-role key" in CLAUDE.md rule 1: no application code path may connect as a role that owns tables or bypasses RLS.

### How a request runs as the user

The API has one helper, `asUser(token, fn)`:

1. Verifies the token's signature, expiry, and audience. Failure throws; nothing reaches the database.
2. Opens a transaction as `api_login`.
3. Runs `SET LOCAL ROLE authenticated` and stores the verified claims in the transaction-local setting `request.jwt.claims`.
4. Runs `fn` inside that transaction, then commits.

Three SQL helpers read that setting and are the only way policies and triggers see the caller: `auth_user_id()`, `auth_household_id()`, `auth_household_role()`. With no claims set they return null, so every policy denies.

### Sign-up creates a household (FR-2)

A trigger on insert into `auth.users` runs a `security definer` function owned by `app_owner` that, in the same transaction, creates a household (default name derived from the email's local part) and an `admin` membership for the new user. The app does nothing special. Sub-project 6 will change this function to join an existing household when the user was invited.

### Claims in the token

GoTrue's custom access-token hook is enabled by environment variable and points at a Postgres function, executable only by `supabase_auth_admin`, that looks up the user's membership and adds top-level `household_id` and `household_role` claims to every JWT. RLS, the sync config, and the app read only those two claims.

The role claim is named `household_role`, not `role`: GoTrue uses the JWT's `role` claim itself. This corrects the wording in ADR-0006.

**Token signing:** GoTrue signs with an asymmetric key and publishes the public key; `api` and `sync` verify against it and hold no secret. If standalone GoTrue cannot do this, the fallback is one HS256 secret shared by `auth`, `api`, and `sync` through `.env`. The plan settles which before any other backend work (§13).

**Recorded limitation:** a role change takes effect only at the next token refresh (up to an hour by default). Nothing changes roles in the skeleton; sub-project 6 must handle it.

### RLS policies

| Table | Select | Insert / update | Delete |
|---|---|---|---|
| `recipes` | `household_id = auth_household_id()` | `household_id = auth_household_id()` and `auth_household_role() in ('admin','member')`, as both `using` and `with check` | none |
| `households` | `id = auth_household_id()` | update only, `id = auth_household_id()` and `auth_household_role() = 'admin'` | none |
| `memberships` | `household_id = auth_household_id()` | none from clients | none |

Because `with check` applies to the row after the change, a recipe cannot be moved to another household by editing `household_id`.

### Server-owned fields

A `before insert or update` trigger on `recipes` sets `updated_at = now()` and `updated_by = auth_user_id()`, ignoring client values. On insert it also sets `created_at = now()`. This yields last-write-wins by arrival time at the server (FR-30) and stops a device with a wrong clock from winning conflicts.

### Seed data

Two households. Household A: an admin, a member, a viewer. Household B: an admin. Used by local development and by every test suite.

## 5. Sync

### Sync config (`powersync/sync-config.yaml`)

Written as PowerSync **Sync Streams**, which PowerSync now recommends over the older Sync Rules format. One auto-subscribed stream filtered on the token's `household_id` claim, selecting that household's `recipes` rows (all standard columns plus `title`), including soft-deleted rows.

**RLS ↔ sync mirror (rule 6):**

| | Condition |
|---|---|
| `recipes` select policy | `household_id = auth_household_id()` |
| `recipes` stream query | `household_id = auth.parameter('household_id')` |

`households` and `memberships` are not synced in the skeleton; the app reads `household_id` and `household_role` from the session token.

The migration creates a logical replication publication containing `recipes`. The `sync` container connects to `db` as `powersync_repl`, stores its buckets in the `powersync_storage` database, and verifies GoTrue-issued JWTs.

## 6. The app (`apps/mobile`)

| Unit | Does | Depends on |
|---|---|---|
| **Session** | Email-code sign-in, token refresh, sign-out; exposes `household_id` and `role` from the token | `@supabase/auth-js`, pointed at `/auth` |
| **Database** | Opens the local SQLite database and declares its schema. The one platform-specific file: `.web.ts` now, `.native.ts` later. | PowerSync web SDK |
| **Connector** | Supplies PowerSync with the current token; sends queued local writes to `/api/upload` | Session, Database |
| **Recipe Repository** | `useRecipes()` (live list, excluding soft-deleted) and `createRecipe(title)`; generates the UUID and stamps `household_id` from the session. Never writes server-owned fields (`created_at`, `updated_at`, `updated_by`). | Database, Session |
| **Screens** | Sign-in (email, then code); recipe list with add form, sync status line, and sign-out | Session, Repository |

Rules applied:

- Screens talk only to the Repository and Session, never to the API or the network directly (rule 3).
- The add form is not rendered when `household_role` is `viewer` (rule 4).
- A signed-in user whose token has no household claims sees a message saying so, not an empty list.
- The status line shows online/offline and the count of unsynced changes.
- Sign-out disconnects sync and wipes the local database, so the next user on the same browser cannot see the previous household's data.
- The app bundle contains no keys at all, only relative service paths (rule 2).

### Scope limits

- **Offline means "keeps working after it is loaded."** With the network off, the open app reads, writes, and queues. Cold-starting with no network needs a service worker; that belongs to the hosting sub-project.
- **Browser storage uses the PowerSync web SDK's default.** Safari-specific storage options are evaluated in the hosting sub-project.

## 7. The `/upload` endpoint (`apps/api`)

Request: `POST /api/upload` with the user's JWT and a JSON body `{ "ops": [ { "op": "put" | "patch" | "delete", "table": string, "id": uuid, "data": object } ] }`, at most 500 ops.

Behaviour:

1. Rejects a missing or invalid token with `401` (checked before the body is read), a malformed body or more than 500 ops with `400`, and a body over 1 MB with `413` (nothing applied in any of these).
2. Runs the batch through `asUser`, so RLS governs every statement.
3. For each op, in order, inside its own savepoint so one refusal does not undo the others:
   - `table` must be on the allow-list (`recipes` only); otherwise the op is rejected.
   - `delete` is rejected; the app soft-deletes with a `patch` to `deleted_at`.
   - `put` validates `data` against the full recipe schema from `packages/domain` and upserts by `id`.
   - `patch` validates against the partial schema and updates by `id`.
4. Returns `200` with a per-op result: `{ "results": [ { "id", "status": "applied" | "rejected", "reason"? } ] }`. An RLS refusal or validation failure is a `rejected` result, not an HTTP error.
5. Unexpected failures (database unreachable, unhandled exception) return `5xx` and apply nothing.

The API also exposes `GET /api/health` for the Compose health check.

### Client handling in the Connector

| Outcome | Client action |
|---|---|
| Network error or `5xx` | Leave the change queued; PowerSync retries. |
| `applied` | Mark the change complete. |
| `rejected` | Mark the change complete (dropping it) and log the reason. The next sync restores the server's version locally. |
| `401` | Refresh the session and retry; if refresh fails, sign out. |
| Any other `4xx` | The server will never accept the batch: mark it complete (dropping it) and log. |

The Connector sends only client-owned fields (`household_id`, `title`, `deleted_at`); server-owned fields never leave the device.

Dropping rejected changes prevents one bad change from blocking the queue. Showing the user a message for a rejected change is deferred to sub-project 2.

### `packages/domain`

Exports the zod schema for a recipe as it exists in the skeleton (`id`, `household_id`, `title` of 1 to 200 characters after trimming, `deleted_at` nullable; unknown keys rejected) and its partial form. It depends only on zod. Both the API and the app import it as a workspace package.

## 8. Testing

Implementation is test-first: each piece gets a failing test before its code.

| Layer | Command | Proves |
|---|---|---|
| Domain unit | `pnpm test` | Schema accepts a valid recipe; rejects empty title, title over 200 characters, unknown fields. |
| Tenant isolation | `pnpm test:rls` | Cases below. |
| `/upload` | `pnpm test:api` | Valid batch applied; invalid data, viewer write, off-list table, and hard delete each rejected; no token returns `401`. |
| End-to-end | `pnpm test:e2e` | Acceptance criteria in §9; also the check that sync rules match RLS. |

### Isolation suite cases

Tests sign in as seeded users through the real email-code flow, reading codes from Mailpit, then query through the API's own `asUser` helper. This exercises the token hook and the exact database path production uses.

1. A household B user reads none of household A's `recipes`, `households`, or `memberships` rows.
2. A household B user cannot insert a recipe into household A, update one of A's recipes, or move a recipe into A.
3. A viewer can select recipes but cannot insert or update; a member can do all three.
4. No role can hard-delete a row from any table.
5. Client-supplied `updated_at` and `updated_by` are overwritten by the server.
6. No client can insert, update, or delete in `memberships`.
7. A brand-new sign-up has a household, an `admin` membership, and both claims in its token.
8. **Coverage guard:** the suite reads the list of tables in the `public` schema and fails if any has RLS disabled or is not named in the suite's table registry.
9. **Role guard:** `api_login` owns no tables and lacks `BYPASSRLS` and superuser; the only non-superuser role with `BYPASSRLS` is `powersync_repl`.
10. `asUser` refuses a token with a bad signature, an expired token, and a token with the wrong audience; a connection as `api_login` with no claims set reads zero rows from every table.

## 9. Acceptance criteria

Automated in the Playwright spec with separate browser contexts, run against the built app served by `proxy`.

1. A new email signs in with a code and lands on an empty recipe list.
2. Two sessions in the same household: a recipe added in one appears in the other within 10 seconds (NFR-5).
3. A session in a second household never sees that recipe.
4. With the network off, adding a recipe works and shows as unsynced; when the network returns, it appears in the other session.
5. A viewer sees the list and no add form.
6. After sign-out, the local database contains no recipes.
7. From a clean checkout with only `.env` created, `docker compose --profile dev up -d --wait` brings every service to healthy with no manual steps.

## 10. CI

GitHub Actions, on pull requests and pushes to `main`. All jobs required.

| Job | Runs |
|---|---|
| `static` | lint, typecheck, domain unit tests |
| `backend` | build images, start the stack, apply seed, isolation suite, `/upload` tests |
| `e2e` | build images, start the stack, Playwright |

Building the images in CI means a broken Dockerfile fails the pull request.

The `e2e` job starts the whole stack and is the most likely to be slow or flaky on shared runners. If it proves unreliable, that is raised with the owner and fixed; it is not silently made optional.

## 11. Documentation changes in this sub-project

- **ADR-0007** "Web-first delivery via Expo web" (amends ADR-0002). Also records the PowerSync web SDK, Vitest, and Playwright.
- **ADR-0008** "Self-hosted, containerized backend" (supersedes ADR-0003; amends the "managed service" wording in ADR-0004 and the claim name in ADR-0006). Records GoTrue, Hono, `postgres`, `jose`, dbmate, Caddy, and Mailpit, and the GCP options considered.
- **`docs/SPEC.md`:** platforms become web first with native iOS/Android later; FR-8 share-sheet import marked native-only; FR-1 records email one-time code; NFR-12 marked as applying to native builds.
- **`ARCHITECTURE.md`:** driver row "managed backend" replaced; container and deployment diagrams redrawn for the Compose stack; on-device database becomes SQLite in the browser via the PowerSync web SDK; cross-cutting rows for secrets, backups, and tenant isolation reworded.
- **`CLAUDE.md`:** stack and command lists replaced; rule 1 names the database roles in place of the service-role key; rule 2 says the app ships no keys; rule 7 and the AI line point at the API's paths in place of `supabase/functions/`; migration path convention becomes `db/migrations/`; the "scaffolding not yet created" note removed.
- **`.env.example`:** rewritten for the Compose stack (database passwords, token key settings, SMTP settings, CORS dev origin).

## 12. Out of scope

Recipe fields beyond title; editing and deleting recipes in the UI; search; any AI call; photo or URL import; file storage; invites and role changes; sharing; deploying to the owner's server, domain and HTTPS, backups, service worker, and PWA manifest; native builds; user-facing messages for rejected uploads; syncing `households` and `memberships` to the device.

## 13. Risks

| Risk | Mitigation |
|---|---|
| Standalone GoTrue needs roles or schemas that the Supabase Postgres image normally provides, or cannot sign with an asymmetric key | First backend task in the plan: bring up `db` and `auth` alone, sign in with a code, and inspect the token. Missing roles go in `db/init`; if asymmetric signing is unavailable, use the shared-secret fallback in §4. |
| PowerSync's Postgres bucket storage is Beta | Used at family scale only. Fallback: add a MongoDB container, which changes `powersync/service.yaml` and the Compose file and nothing else. |
| `SET LOCAL ROLE` plus transaction-local claims is easy to get subtly wrong (for example a query escaping the transaction) | One helper, `asUser`, is the only database entry point in the API; isolation cases 9 and 10 test it directly; lint forbids importing the database driver outside that module. |
| PowerSync web SDK does not bundle cleanly under Expo's web build | Already proven in Task 2 (commit `9b396a3`). |
| Slow or unreliable file watching on `/mnt/d`; WSL memory cap | Enable polling; raise the WSL cap before running the end-to-end suite. |

## 14. What carries over from work already done

- Tasks 1 and 2 (workspace, domain schema, Expo web shell with the PowerSync browser database) stand unchanged.
- The Task 3 WIP commit (`bc1420d`) is superseded. Its Supabase config is deleted; its mailbox reader, sign-in helper, table registry, and isolation test cases are adapted to GoTrue and `asUser`.
- The implementation plan's Tasks 3 to 7 are rewritten against this revision before execution resumes.
