# CLAUDE.md

Guidance for Claude Code (and other AI agents) working in this repo. Keep this file short; link out for detail.

## What this is
Offline-first, multi-tenant mobile recipe app (iOS + Android). Households store, import (photo → URL → text), search, and cook from recipes, with AI parsing and substitutions.

- **What to build:** `docs/SPEC.md` (requirement IDs FR-x / NFR-x)
- **How it's built:** `ARCHITECTURE.md` (C4) and `docs/adr/`
- Reference requirement IDs in commits, PRs, and tests (e.g. `feat(import): multi-page photo capture (FR-7)`).

## Stack
- `apps/mobile` — Expo / React Native, TypeScript, Expo Router, PowerSync SDK (SQLite)
- `supabase/` — migrations, RLS policies, seed data, Edge Functions (Deno/TypeScript)
- `packages/domain` — shared TS: recipe schema (zod), scaling, unit conversion. Pure functions, no I/O.
- AI: Claude API, called **only** from Edge Functions via `supabase/functions/_shared/llm/`

## Commands
```bash
pnpm install                 # install workspace
supabase start               # local Postgres/Auth/Storage/Functions (Docker)
supabase db reset            # re-apply migrations + seed
pnpm --filter mobile start   # Expo dev client
pnpm test                    # all unit tests
pnpm test:rls                # tenant isolation suite (requires supabase start)
pnpm lint && pnpm typecheck
```
*(Scaffolding not yet created. Update these when it is.)*

## Non-negotiable rules
1. **Tenant isolation.** Every tenant table has `household_id NOT NULL` + RLS enabled + policies in the same migration. Add the table to the RLS test suite in the same PR. Never use the service-role key outside the audited share-import path.
2. **No secrets on device.** The app ships only the Supabase anon key. AI and service keys live in Edge Function secrets.
3. **Offline-first.** UI reads/writes the local DB, never the network directly. Features needing the network (AI, import) must queue or degrade gracefully with a clear message.
4. **Viewers can't write.** Enforce in RLS *and* hide controls in the UI.
5. **IDs are client-generated UUIDs.** Every tenant row has `created_at`, `updated_at`, `updated_by`, `deleted_at`. Delete = soft delete.
6. **Sync rules mirror RLS.** Changing one means changing the other.
7. **AI output is untrusted.** Validate against the zod schema in `packages/domain`; never write raw LLM output to the DB. Prompts live in versioned files, not inline strings.
8. **Keep the original.** Imports always store the source photo/URL/text (FR-12).

## Conventions
- TypeScript strict mode everywhere. No `any` without a comment explaining why.
- Domain logic goes in `packages/domain` with unit tests; screens stay thin.
- Migrations: `supabase/migrations/<timestamp>_<verb>_<thing>.sql`; never edit an applied migration.
- Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `test:`).
- New dependency or cross-cutting pattern → new ADR in `docs/adr/`.

## Working style
- Prefer small PRs scoped to one FR.
- Before large changes, propose a plan and wait for approval.
- If a requirement is ambiguous, check `docs/SPEC.md` §7 (open questions) and ask rather than guessing.
- Update `ARCHITECTURE.md` when a container or component changes.
