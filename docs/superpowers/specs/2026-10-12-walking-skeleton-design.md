# Walking Skeleton — Design

> Status: **Draft for review** · Date: 2026-10-12
> Sub-project 1 of 7 for Phase 1. Requirements: `docs/SPEC.md`. Architecture: `ARCHITECTURE.md`, `docs/adr/`.

## 1. Purpose

Get from documents to running code by exercising every container in `ARCHITECTURE.md` once, with the least possible in each. The goal is to surface integration problems (auth claims, RLS, sync rules, offline writes, sharing the domain package with Deno, PowerSync's web SDK under Expo) while they are cheap to fix. Feature depth comes in later sub-projects.

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

A small hosting sub-project (staging environment, service worker, first run on an iPhone) follows this one, before sub-project 2 or alongside it.

## 2. Decisions made during design

| Decision | Choice | Reason |
|---|---|---|
| Delivery platform | **Web first via Expo web**; native iOS/Android later from the same codebase | No paid Apple Developer membership; iOS builds cannot be made from Windows/WSL. Amends ADR-0002 (new ADR-0007). |
| Where the skeleton runs | **Local only**, desktop browser at `localhost` | Browser offline storage needs HTTPS or `localhost`; hosting is a follow-up sub-project. |
| Sign-in | **Email one-time code** (6 digits) | Magic links open in Safari, not the home-screen app, and the two do not share a session on iOS. |
| Households per user | One (SPEC §7 Q1 assumption, enforced by a unique constraint) | Spec assumption; unchanged. |
| Write path | Through a minimal **`/upload` Edge Function**, per ADR-0004 | Proves Edge Functions locally and sharing `packages/domain` with Deno. |
| Local sync service | **PowerSync self-hosted in Docker** | No accounts or cost; PowerSync Cloud arrives with hosting. |

### Known consequences of web-first

- FR-8's "share a URL into the app from the OS share sheet" is not possible in an iOS web app. Paste-a-link still works. Share-sheet import becomes native-only.
- NFR-12 (App Store compliance, Sign in with Apple) does not apply until a native build exists.
- Users should add the app to the home screen; Safari can clear storage for sites that go unused.

## 3. Repo layout and tooling

```
apps/mobile/            Expo app, web target, Expo Router
packages/domain/        zod recipe schema; pure functions, no I/O
supabase/
  config.toml           local config: OTP email, access-token hook enabled
  migrations/           SQL migrations (tables, RLS, triggers, token hook, publication)
  functions/upload/     the /upload Edge Function
  functions/_shared/    auth guard, shared helpers
  tests/rls/            tenant isolation suite
  tests/functions/      /upload HTTP tests
  seed.sql              two households for local dev and tests
powersync/
  config.yaml           service config for local Docker
  sync-rules.yaml       household-scoped sync rules
e2e/                    Playwright specs
docker-compose.yml      PowerSync service and its storage database
.github/workflows/ci.yml
```

- **pnpm workspaces**, one shared strict TypeScript config, ESLint, Prettier. No build orchestrator.
- **Vitest** for unit, isolation, and function tests. **Playwright** for end-to-end.
- **Supabase CLI** as a dev dependency (`pnpm supabase ...`), not a global install.
- **Deno** is used only inside the Supabase CLI's function runtime.
- One-time machine setup: enable pnpm through corepack. Node 22 and Docker are already present.

### Commands

```
pnpm install
pnpm dev:backend       # supabase start + docker compose up (PowerSync)
pnpm dev:web           # Expo web dev server at localhost
pnpm test              # unit tests
pnpm test:rls          # isolation suite (needs dev:backend)
pnpm test:functions    # /upload tests (needs dev:backend)
pnpm test:e2e          # Playwright (needs dev:backend)
pnpm lint && pnpm typecheck
```

### Environment note

The repo is on the Windows drive (`/mnt/d`) and accessed from WSL, where file I/O is slow and file watching is unreliable. The dev server may need polling enabled. Moving the repo into the Linux filesystem would fix this; it is the owner's choice and does not block the work.

## 4. Data model and tenancy

All of the following ships in one migration, with RLS enabled and policies defined in the same file (CLAUDE.md rule 1).

### Tables

| Table | Columns beyond the standard set | Purpose |
|---|---|---|
| `households` | `name text not null` | The tenant. Its `id` is the `household_id` used everywhere else. |
| `memberships` | `household_id uuid not null` → `households`, `user_id uuid not null unique` → `auth.users`, `role` enum (`admin`, `member`, `viewer`) | Links a user to their one household. |
| `recipes` | `household_id uuid not null` → `households` (indexed), `title text not null` | The single tenant data table for the skeleton. |

Standard set on every table: `id uuid primary key`, `created_at`, `updated_at`, `updated_by`, `deleted_at`. `recipes.id` is generated on the client. Delete means setting `deleted_at`; no table has a delete policy.

`households` is the tenant root, so it has no `household_id` column of its own; its `id` plays that role.

### Sign-up creates a household (FR-2)

A trigger on insert into `auth.users` runs a `security definer` function that, in the same transaction, creates a household (default name derived from the email's local part) and an `admin` membership for the new user. The app does nothing special. Sub-project 6 will change this function to join an existing household when the user was invited.

### Claims in the token

A Supabase custom access-token hook (a Postgres function executable only by `supabase_auth_admin`) looks up the user's membership and adds top-level `household_id` and `role` claims to every JWT. RLS, sync rules, and the Edge Function read only those two claims.

Two SQL helpers, `auth_household_id()` and `auth_role()`, read the claims from `auth.jwt()` and are used by all policies.

**Recorded limitation:** a role change takes effect only at the next token refresh (up to an hour by default). Nothing changes roles in the skeleton; sub-project 6 must handle it.

### RLS policies

| Table | Select | Insert / update | Delete |
|---|---|---|---|
| `recipes` | `household_id = auth_household_id()` | `household_id = auth_household_id()` and `auth_role() in ('admin','member')`, as both `using` and `with check` | none |
| `households` | `id = auth_household_id()` | update only, `id = auth_household_id()` and `auth_role() = 'admin'` | none |
| `memberships` | `household_id = auth_household_id()` | none from clients | none |

Because `with check` applies to the row after the change, a recipe cannot be moved to another household by editing `household_id`.

### Server-owned fields

A `before insert or update` trigger on `recipes` sets `updated_at = now()` and `updated_by = auth.uid()`, ignoring client values. On insert it also sets `created_at = now()`. This yields last-write-wins by arrival time at the server (FR-30) and stops a device with a wrong clock from winning conflicts.

### Service-role key

Not used anywhere: not in the app, not in the Edge Function, not in tests. The sign-up trigger and token hook are database functions with rights scoped to those jobs.

### Seed data

Two households. Household A: an admin, a member, a viewer. Household B: an admin. Used by local development and by every test suite.

## 5. Sync

### Sync rules (`powersync/sync-rules.yaml`)

One bucket per household, parameterised on the token's `household_id` claim, selecting that household's `recipes` rows (all standard columns plus `title`), including soft-deleted rows.

**RLS ↔ sync-rule mirror (rule 6):**

| | Condition |
|---|---|
| `recipes` select policy | `household_id = auth_household_id()` |
| `recipes` sync bucket | `household_id = <token household_id claim>` |

`households` and `memberships` are not synced in the skeleton; the app reads `household_id` and `role` from the session token.

The migration creates a logical replication publication containing `recipes`. The local PowerSync service connects to the local Supabase Postgres and verifies Supabase-issued JWTs.

## 6. The app (`apps/mobile`)

| Unit | Does | Depends on |
|---|---|---|
| **Session** | Email-code sign-in, token refresh, sign-out; exposes `household_id` and `role` from the token | Supabase auth SDK |
| **Database** | Opens the local SQLite database and declares its schema. The one platform-specific file: `.web.ts` now, `.native.ts` later. | PowerSync web SDK |
| **Connector** | Supplies PowerSync with the current token; sends queued local writes to `/upload` | Session, Database |
| **Recipe Repository** | `watchRecipes()` (live list, excluding soft-deleted) and `createRecipe(title)`; generates the UUID and stamps `household_id` from the session | Database, Session |
| **Screens** | Sign-in (email, then code); recipe list with add form, sync status line, and sign-out | Session, Repository |

Rules applied:

- Screens talk only to the Repository and Session, never to Supabase data APIs or the network directly (rule 3).
- The add form is not rendered when `role` is `viewer` (rule 4).
- The status line shows online/offline and the count of unsynced changes.
- Sign-out disconnects sync and wipes the local database, so the next user on the same browser cannot see the previous household's data.
- The app bundle contains only the Supabase URL, anon key, and PowerSync URL (rule 2).

### Scope limits

- **Offline means "keeps working after it is loaded."** With the network off, the open app reads, writes, and queues. Cold-starting with no network needs a service worker and a production build; that belongs to the hosting sub-project.
- **Browser storage uses the PowerSync web SDK's default.** Safari-specific storage options are evaluated in the hosting sub-project.

## 7. The `/upload` Edge Function

Request: `POST /functions/v1/upload` with the user's JWT and a JSON body `{ "ops": [ { "op": "put" | "patch" | "delete", "table": string, "id": uuid, "data": object } ] }`.

Behaviour:

1. Rejects a missing or invalid token with `401`.
2. Creates a database client carrying the caller's token, so RLS governs every statement.
3. For each op, in order:
   - `table` must be on the allow-list (`recipes` only); otherwise the op is rejected.
   - `delete` is rejected; the app soft-deletes with a `patch` to `deleted_at`.
   - `put` validates `data` against the full recipe schema from `packages/domain` and upserts by `id`.
   - `patch` validates against the partial schema and updates by `id`.
4. Returns `200` with a per-op result: `{ "results": [ { "id", "status": "applied" | "rejected", "reason"? } ] }`. An RLS refusal or validation failure is a `rejected` result, not an HTTP error.
5. Unexpected failures (database unreachable, unhandled exception) return `5xx`.

### Client handling in the Connector

| Outcome | Client action |
|---|---|
| Network error or `5xx` | Leave the change queued; PowerSync retries. |
| `applied` | Mark the change complete. |
| `rejected` | Mark the change complete (dropping it) and log the reason. The next sync restores the server's version locally. |
| `401` | Refresh the session and retry; if refresh fails, sign out. |

Dropping rejected changes prevents one bad change from blocking the queue. Showing the user a message for a rejected change is deferred to sub-project 2.

### `packages/domain`

Exports the zod schema for a recipe as it exists in the skeleton (`id`, `household_id`, `title` of 1 to 200 characters after trimming, `deleted_at` nullable; unknown keys rejected) and its partial form. It depends only on zod. The Edge Function imports it through the functions' Deno import map; the app imports it as a workspace package.

## 8. Testing

Implementation is test-first: each piece gets a failing test before its code.

| Layer | Command | Proves |
|---|---|---|
| Domain unit | `pnpm test` | Schema accepts a valid recipe; rejects empty title, title over 200 characters, unknown fields. |
| Tenant isolation | `pnpm test:rls` | Cases below. |
| `/upload` | `pnpm test:functions` | Valid batch applied; invalid data, viewer write, off-list table, and hard delete each rejected; no token returns `401`. |
| End-to-end | `pnpm test:e2e` | Acceptance criteria in §9; also the check that sync rules match RLS. |

### Isolation suite cases

Tests sign in as seeded users through the real email-code flow, reading codes from the local mail catcher. This exercises the token hook and needs no service-role key.

1. A household B user reads none of household A's `recipes`, `households`, or `memberships` rows.
2. A household B user cannot insert a recipe into household A, update one of A's recipes, or move a recipe into A.
3. A viewer can select recipes but cannot insert or update; a member can do all three.
4. No role can hard-delete a row from any table.
5. Client-supplied `updated_at` and `updated_by` are overwritten by the server.
6. No client can insert, update, or delete in `memberships`.
7. A brand-new sign-up has a household, an `admin` membership, and both claims in its token.
8. **Coverage guard:** the suite reads the list of tables in the `public` schema and fails if any has RLS disabled or is not named in the suite's table registry.

## 9. Acceptance criteria

Automated in the Playwright spec with separate browser contexts.

1. A new email signs in with a code and lands on an empty recipe list.
2. Two sessions in the same household: a recipe added in one appears in the other within 10 seconds (NFR-5).
3. A session in a second household never sees that recipe.
4. With the network off, adding a recipe works and shows as unsynced; when the network returns, it appears in the other session.
5. A viewer sees the list and no add form.
6. After sign-out, the local database contains no recipes.

## 10. CI

GitHub Actions, on pull requests and pushes to `main`. All jobs required.

| Job | Runs |
|---|---|
| `static` | lint, typecheck, domain unit tests |
| `backend` | start Supabase, apply migrations and seed, isolation suite, `/upload` tests |
| `e2e` | start Supabase and PowerSync, build the web app, Playwright |

The `e2e` job starts the whole stack and is the most likely to be slow or flaky on shared runners. If it proves unreliable, that is raised with the owner and fixed; it is not silently made optional.

## 11. Documentation changes in this sub-project

- **ADR-0007** "Web-first delivery via Expo web" (amends ADR-0002). Also records the new dependencies: PowerSync web SDK, Vitest, Playwright.
- **`docs/SPEC.md`:** platforms become web first with native iOS/Android later; FR-8 share-sheet import marked native-only; FR-1 records email one-time code; NFR-12 marked as applying to native builds.
- **`ARCHITECTURE.md`:** on-device database becomes SQLite in the browser via the PowerSync web SDK; deployment section adds the local self-hosted PowerSync; auth container lists email one-time code.
- **`CLAUDE.md`:** command list replaced with §3's; the "scaffolding not yet created" note removed.
- **`.env.example`:** unchanged keys; `EXPO_PUBLIC_POWERSYNC_URL` given its local default.

## 12. Out of scope

Recipe fields beyond title; editing and deleting recipes in the UI; search; any AI call; photo or URL import; invites and role changes; sharing; hosting, service worker, and PWA manifest; native builds; user-facing messages for rejected uploads; syncing `households` and `memberships` to the device.

## 13. Risks

| Risk | Mitigation |
|---|---|
| PowerSync web SDK does not bundle cleanly under Expo's web build (unverified) | Tackle it first in the plan. Fallback: a plain Vite + React web shell with the same backend, which would need the owner's approval and a revised ADR-0007. |
| Sharing `packages/domain` with the Deno function runtime is awkward | Keep the package dependency-light (zod only); prove the import early with a trivial function test. |
| Local PowerSync against Supabase's local Postgres needs replication and JWT settings that differ from the docs' hosted examples | Isolated in `powersync/config.yaml` and `docker-compose.yml`; covered by the e2e spec. |
| Slow or unreliable file watching on `/mnt/d` | Enable polling; recommend moving the repo into the Linux filesystem. |
