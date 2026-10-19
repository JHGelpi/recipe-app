# CLAUDE.md

Guidance for Claude Code (and other AI agents) working in this repo. Keep this file short; link out for detail.

## What this is
Offline-first, multi-tenant recipe app: web first, iOS + Android later from the same codebase (ADR-0007). Households store, import (photo → URL → text), search, and cook from recipes, with AI parsing and substitutions.

- **What to build:** `docs/SPEC.md` (requirement IDs FR-x / NFR-x)
- **How it's built:** `ARCHITECTURE.md` (C4) and `docs/adr/`
- Reference requirement IDs in commits, PRs, and tests (e.g. `feat(import): multi-page photo capture (FR-7)`).

## Stack
- `apps/mobile` — Expo / React Native Web (web first, ADR-0007), TypeScript, Expo Router, PowerSync web SDK (SQLite in the browser)
- `apps/api` — Node/TypeScript API (Hono). All database access goes through `asUser` in `src/db/asUser.ts`
- `db/` — SQL migrations (dbmate), first-boot role script, seed data
- `packages/domain` — shared TS: recipe schema (zod), scaling, unit conversion. Pure functions, no I/O.
- `docker-compose.yml` — the whole backend: Caddy proxy, API, GoTrue auth, Postgres, PowerSync (ADR-0008)
- Photo files: the `photos` volume behind `PUT`/`GET /api/photos/:id` (ADR-0013); back it up with the database
- AI: Claude API, called **only** from the API via `apps/api/src/llm/`

## Commands
```bash
pnpm install                 # install workspace
pnpm dev:backend             # creates .env if missing; builds and starts the Compose stack
pnpm db:reset                # fresh database volume, migrations, and seed
pnpm dev:web                 # Expo web dev server at http://localhost:8081
pnpm test                    # unit tests
pnpm test:stack              # auth and token checks (needs dev:backend)
pnpm test:rls                # tenant isolation suite (needs dev:backend + seed)
pnpm dev:backend:test        # stack with the fake Claude and fixture pages; test:api and test:e2e need it
pnpm test:api                # upload and import tests (needs dev:backend:test + seed)
pnpm test:e2e                # Playwright against the built app at PUBLIC_URL; starts test mode itself
pnpm eval:import             # parse eval against the real Claude API (needs ANTHROPIC_API_KEY; manual)
pnpm photos:samples          # regenerate the photo fixtures and eval samples (Playwright's Chromium)
pnpm test:backup             # backup → restore drill round trip against the test stack (local folder for GCS)
pnpm test:prod-config        # the production overlay publishes no ports; drills never start the tunnel
# Production: only `pnpm prod:*` (init, deploy, status, logs, stop, start, allow, disallow, allowed, gate,
# backup-now, restore, restore-test) touches it; see docs/RUNBOOK.md.
# After test runs, `pnpm dev:backend` switches the stack back to the real AI service.
# After changing powersync/sync-config.yaml, restart sync: `docker compose restart sync` (it reads the file only at start).
pnpm lint && pnpm typecheck
```

## Non-negotiable rules
1. **Tenant isolation.** Every tenant table has `household_id NOT NULL` + RLS enabled + policies in the same migration. Add the table to the RLS test suite in the same PR. The API connects only as `api_login` and only through `asUser` (or `asClaims`, with claims verified earlier in the same request: for background work, and for routes that verify the token themselves; ADR-0012); cross-household changes go only through the `SECURITY DEFINER` household functions of ADR-0015, which check the caller themselves; signed-out share links are read only through `asAnonymous` and the ADR-0016 functions; no code path may use a role that owns tables or bypasses RLS. New tables must also be added to `apps/api/tests/rls/registry.ts`; the coverage guard fails otherwise.
2. **No secrets on device.** The web app ships no keys at all, only relative service paths. Database passwords, the signing key, and AI keys live in .env on the server.
3. **Offline-first.** UI reads/writes the local DB, never the network directly. Features needing the network (AI, import) must queue or degrade gracefully with a clear message.
4. **Viewers can't change household data.** Enforce in RLS *and* hide controls in the UI. Their own favorites are the exception.
5. **IDs are client-generated UUIDs.** Every tenant row has `created_at`, `updated_at`, `updated_by`, `deleted_at`. Delete = soft delete. The only hard delete is the 30-day trash purge (`recipes_purge` policy, `POST /api/trash/purge`).
6. **Sync rules mirror RLS.** Changing one means changing the other. RLS lives in `db/migrations/`, sync config in `powersync/sync-config.yaml`.
7. **AI output is untrusted.** Validate against the zod schema in `packages/domain`; never write raw LLM output to the DB. Prompts live in versioned files, not inline strings.
8. **Keep the original.** Imports always store the source photo/URL/text (FR-12).
9. **Production is off-limits to dev and tests.** Never run test, seed or reset commands against the `dishkept` project; `scripts/guard.mjs` refuses them. Only `pnpm prod:*` touches production (ADR-0018).

## Conventions
- TypeScript strict mode everywhere. No `any` without a comment explaining why.
- Domain logic goes in `packages/domain` with unit tests; screens stay thin.
- UI: screens use `apps/mobile/src/ui` and `src/theme` (ADR-0017); no color literals, and no `react-native` `Text`/`TextInput` outside `src/ui`.
- Migrations: `db/migrations/<timestamp>_<verb>_<thing>.sql` with dbmate's `-- migrate:up` marker; never edit an applied migration.
- Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `test:`).
- New dependency or cross-cutting pattern → new ADR in `docs/adr/`.

## Working style
- Prefer small PRs scoped to one FR.
- Before large changes, propose a plan and wait for approval.
- If a requirement is ambiguous, check `docs/SPEC.md` §7 (open questions) and ask rather than guessing.
- Update `ARCHITECTURE.md` when a container or component changes.

<!-- rtk-instructions v2 -->
# RTK (Rust Token Killer) - Token-Optimized Commands

## Golden Rule

**Always prefix commands with `rtk`**. If RTK has a dedicated filter, it uses it. If not, it passes through unchanged. This means RTK is always safe to use.

**Important**: Even in command chains with `&&`, use `rtk`:
```bash
# ❌ Wrong
git add . && git commit -m "msg" && git push

# ✅ Correct
rtk git add . && rtk git commit -m "msg" && rtk git push
```

## RTK Commands by Workflow

### Build & Compile (80-90% savings)
```bash
rtk cargo build         # Cargo build output
rtk cargo check         # Cargo check output
rtk cargo clippy        # Clippy warnings grouped by file (80%)
rtk tsc                 # TypeScript errors grouped by file/code (83%)
rtk lint                # ESLint/Biome violations grouped (84%)
rtk prettier --check    # Files needing format only (70%)
rtk next build          # Next.js build with route metrics (87%)
```

### Test (90-99% savings)
```bash
rtk cargo test          # Cargo test failures only (90%)
rtk vitest run          # Vitest failures only (99.5%)
rtk playwright test     # Playwright failures only (94%)
rtk test <cmd>          # Generic test wrapper - failures only
```

### Git (59-80% savings)
```bash
rtk git status          # Compact status
rtk git log             # Compact log (works with all git flags)
rtk git diff            # Compact diff (80%)
rtk git show            # Compact show (80%)
rtk git add             # Ultra-compact confirmations (59%)
rtk git commit          # Ultra-compact confirmations (59%)
rtk git push            # Ultra-compact confirmations
rtk git pull            # Ultra-compact confirmations
rtk git branch          # Compact branch list
rtk git fetch           # Compact fetch
rtk git stash           # Compact stash
rtk git worktree        # Compact worktree
```

Note: Git passthrough works for ALL subcommands, even those not explicitly listed.

### GitHub (26-87% savings)
```bash
rtk gh pr view <num>    # Compact PR view (87%)
rtk gh pr checks        # Compact PR checks (79%)
rtk gh run list         # Compact workflow runs (82%)
rtk gh issue list       # Compact issue list (80%)
rtk gh api              # Compact API responses (26%)
```

### JavaScript/TypeScript Tooling (70-90% savings)
```bash
rtk pnpm list           # Compact dependency tree (70%)
rtk pnpm outdated       # Compact outdated packages (80%)
rtk pnpm install        # Compact install output (90%)
rtk npm run <script>    # Compact npm script output
rtk npx <cmd>           # Compact npx command output
rtk prisma              # Prisma without ASCII art (88%)
```

### Files & Search (60-75% savings)
```bash
rtk ls <path>           # Tree format, compact (65%)
rtk read <file>         # Code reading with filtering (60%)
rtk grep <pattern>      # Search grouped by file (75%)
rtk find <pattern>      # Find grouped by directory (70%)
```

### Analysis & Debug (70-90% savings)
```bash
rtk err <cmd>           # Filter errors only from any command
rtk log <file>          # Deduplicated logs with counts
rtk json <file>         # JSON structure without values
rtk deps                # Dependency overview
rtk env                 # Environment variables compact
rtk summary <cmd>       # Smart summary of command output
rtk diff                # Ultra-compact diffs
```

### Infrastructure (85% savings)
```bash
rtk docker ps           # Compact container list
rtk docker images       # Compact image list
rtk docker logs <c>     # Deduplicated logs
rtk kubectl get         # Compact resource list
rtk kubectl logs        # Deduplicated pod logs
```

### Network (65-70% savings)
```bash
rtk curl <url>          # Compact HTTP responses (70%)
rtk wget <url>          # Compact download output (65%)
```

### Meta Commands
```bash
rtk gain                # View token savings statistics
rtk gain --history      # View command history with savings
rtk discover            # Analyze Claude Code sessions for missed RTK usage
rtk proxy <cmd>         # Run command without filtering (for debugging)
rtk init                # Add RTK instructions to CLAUDE.md
rtk init --global       # Add RTK to ~/.claude/CLAUDE.md
```

## Token Savings Overview

| Category | Commands | Typical Savings |
|----------|----------|-----------------|
| Tests | vitest, playwright, cargo test | 90-99% |
| Build | next, tsc, lint, prettier | 70-87% |
| Git | status, log, diff, add, commit | 59-80% |
| GitHub | gh pr, gh run, gh issue | 26-87% |
| Package Managers | pnpm, npm, npx | 70-90% |
| Files | ls, read, grep, find | 60-75% |
| Infrastructure | docker, kubectl | 85% |
| Network | curl, wget | 65-70% |

Overall average: **60-90% token reduction** on common development operations.
<!-- /rtk-instructions -->