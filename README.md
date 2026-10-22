# Dishkept

One home for every recipe your household cares about. Snap a cookbook page, paste a link, or paste some text, and AI turns it into a clean, searchable recipe that everyone in your household can cook from, even offline.

> **Status:** in production at **https://dishkept.geltech.dev**, invite-only. Web first, installable as an app on phones and desktops. Native iOS and Android builds come later from the same code (ADR-0007).

## Why

Recipes end up scattered across Google Drive, iCloud, the Notes app, bookmarks and cookbook shelves. Dishkept gathers them in one place, structures them automatically, and makes them easy to find ("all chicken recipes") and to cook from on a phone.

## What it does

**Households and people**
- Sign in with a one-time code sent by email; no passwords.
- Each person belongs to one household, with Admin, Member and Viewer roles. Viewers can browse, search, cook and share, but not change anything.
- Admins invite people into the household with a link, change roles and remove members.
- Anyone can send a friend link that lets someone start their own household.
- Sign-up is invite-only: an allowed list plus invite, friend and share links (ADR-0018).

**Capturing recipes**
- Import from photos (up to 8 pages, including handwriting), from a web address, or from pasted text such as a social media comment.
- Claude parses each one into title, ingredients (amount, unit, item, preparation), steps, servings, times and suggested tags. You review it before saving, with uncertain fields highlighted.
- The original photos, link or text are kept with the recipe.
- Imports made offline wait in a queue and are parsed once the device is back online.

**Your collection**
- Edit everything; add notes, tags and one dish photo per recipe.
- Personal favorites.
- A 30-day trash.
- Search by title, ingredient and tag, combined with tag filters. Search runs on the device, so it works offline.

**Cooking**
- Cook mode keeps the screen awake and shows large text, one step at a time, with ingredients to tick off.
- Scale the servings.
- AI substitutions for any ingredient, with amounts and how they change the dish.

**Sharing and shopping**
- Share a recipe as a formatted PDF or as text, or send a link that lets the recipient save a copy to their own household.
- A shared household shopping list: add a recipe's ingredients at the servings you're viewing, with duplicates merged, items grouped by aisle, and ticking off as you shop.

**Everywhere**
- Offline-first. Everything is read from and written to a database on the device, and synced across the household's devices; the last save wins.
- Installable web app that opens with no connection, and offers a reload when a new version is ready.
- Light and dark themes, following the device setting or your choice.

**Roadmap:** weekly meal planning that feeds the shopping list, then native iOS and Android apps, a desktop app, and natural-language search. See [`docs/SPEC.md`](docs/SPEC.md) §3.

## How it works

```
 Browser / installed app                     One Docker Compose stack
┌───────────────────────────┐              ┌──────────────────────────────────────────┐
│ Expo (React Native Web)   │   HTTPS      │ Caddy proxy ── serves the web app        │
│ PowerSync: SQLite on the  │ ───────────▶ │   ├─ /api   → Node API (Hono) ─▶ Claude  │
│ device; reads and writes  │              │   ├─ /auth  → GoTrue (email codes)       │
│ locally, syncs when online│              │   └─ /sync  → PowerSync service          │
└───────────────────────────┘              │ Postgres 17 with row-level security      │
                                           │ Backup loop → encrypted (age) → GCS      │
                                           └──────────────────────────────────────────┘
```

- **Tenant isolation is enforced by the database.** Every household table has row-level security, and the API only ever connects as a restricted role through `asUser` (ADR-0006, ADR-0012). The sync rules mirror those policies.
- **No secrets on the device.** The app ships no keys. Claude is called only by the API, and its output is validated against a shared schema before anything is saved (ADR-0005).
- **Production** is the same stack on a home PC. A Cloudflare Tunnel connects out to Cloudflare, which serves `dishkept.geltech.dev`, so no port is opened on the PC or router. Backups run nightly to Google Cloud Storage, encrypted, and are kept for 30 days (ADR-0018). The cloud resources are defined in OpenTofu, and the machine is set up with Ansible; either the PC or a GCP VM can be the host (ADR-0021).

Details: [`ARCHITECTURE.md`](ARCHITECTURE.md), with C4 diagrams.

## Documentation

| Doc | What it covers |
|---|---|
| [`docs/SPEC.md`](docs/SPEC.md) | Product requirements: functional (FR-x) and non-functional (NFR-x) |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | C4 architecture: context, containers, components, deployment |
| [`docs/adr/`](docs/adr/README.md) | Architecture decision records (ADR-0001 to ADR-0021) |
| [`docs/RUNBOOK.md`](docs/RUNBOOK.md) | Running production: setup, deploys, backups, restores, rotations, moving to a VM |
| [`infra/README.md`](infra/README.md) | OpenTofu and Ansible commands, credentials, the Vault file, the VM trial |
| [`CLAUDE.md`](CLAUDE.md) | Rules and commands for AI coding agents, and a good summary of the project's non-negotiables |
| [`docs/superpowers/`](docs/superpowers/) | Design specs and implementation plans for each piece of work |

## Repository layout

```
apps/
  mobile/             Expo app: screens in app/, everything else in src/ (ui, theme, db, sync, …)
  api/                Node API (Hono): imports, photos, households, sharing, sign-up, Claude calls
packages/domain/      Shared TypeScript: recipe schema (zod), scaling, units. Pure, no I/O
db/
  migrations/         SQL schema and RLS policies (dbmate)
  init/               First-boot database roles
  seed.sql            Two households and four users, for development
powersync/            Sync service config and sync rules
deploy/               Caddy proxy and backup images; email templates
infra/
  tofu/               OpenTofu: Cloudflare zone, tunnel and DNS; GCS backups; the optional VM
  ansible/            Ansible: sets up and deploys the PC or the VM; encrypted Vault file
scripts/
  prod/               The pnpm prod:* commands
  backup/             Backup, restore and alert scripts run by the backup container
  infra/              infra:secrets and the infra checks
e2e/                  Playwright tests against the built app
test-support/         Fake Claude, fixture pages and helpers for the test stack
docs/                 SPEC, RUNBOOK, ADRs, specs and plans
docker-compose.yml    The whole backend; *.prod.yml and *.test.yml overlay it
```

## Developing locally

**Prerequisites:**
- Node 22;
- `corepack enable`, for pnpm;
- Docker with Compose, with 6 GB or more of memory available to Docker.

```bash
pnpm install
pnpm dev:backend   # creates .env if missing; builds and starts the stack
pnpm db:seed       # two households and four users
```

Open the `PUBLIC_URL` from `.env`, which defaults to http://localhost:8080. If another program already uses port 8080, change `PUBLIC_URL` and `PROXY_PORT` together, then run `pnpm dev:backend` again. Sign in with a seeded address:

| Email | Household | Role |
|---|---|---|
| `admin-a@example.test` | A | Admin |
| `member-a@example.test` | A | Member |
| `viewer-a@example.test` | A | Viewer |
| `admin-b@example.test` | B | Admin |

Sign-in codes arrive in the local mail catcher at http://127.0.0.1:8025.

**AI features** (imports and substitutions) need `ANTHROPIC_API_KEY` in `.env`. Everything else works without it. Each household's monthly AI spend is capped by `AI_MONTHLY_CAP_USD`, which defaults to $2.

**Day to day:**

| Command | Does |
|---|---|
| `pnpm dev:backend` | Rebuilds and restarts the stack after code changes |
| `pnpm dev:web` | Expo dev server with hot reload at http://localhost:8081 |
| `pnpm dev:backend:stop` | Stops the stack and keeps its data |
| `pnpm db:reset` | **Deletes the local database and photos**, then migrates and seeds again |
| `docker compose restart sync` | Needed after changing `powersync/sync-config.yaml` |

## Tests

| Command | What it checks | Needs |
|---|---|---|
| `pnpm test` | Unit tests | nothing |
| `pnpm lint && pnpm typecheck` | ESLint, Prettier, TypeScript (strict) | nothing |
| `pnpm test:stack` | Auth and token checks | `dev:backend` |
| `pnpm test:rls` | Tenant isolation, table by table | `dev:backend` and the seed |
| `pnpm test:api` | Upload, import, photos, households, sharing, sign-up | `dev:backend:test` and the seed |
| `pnpm test:e2e` | Playwright against the built app; starts test mode itself | Docker |
| `pnpm test:backup` | Backup, then restore drill, using a local folder for GCS | Docker |
| `pnpm test:prod-config` | The production overlay publishes no ports, and drills never start the tunnel | nothing |
| `pnpm test:infra` | `tofu fmt`/`validate`, Ansible syntax, ansible-lint, role checks; touches no cloud account | OpenTofu, Ansible |
| `pnpm eval:import` | Parse quality against the real Claude API (manual) | `ANTHROPIC_API_KEY` |

Test mode (`dev:backend:test`) swaps Claude for a fake and serves fixture pages. Afterwards, `pnpm dev:backend` switches the stack back. CI runs the static checks, the backend suites and the e2e suite on every pull request.

## Testing on a phone

The phone needs an HTTPS address, because browsers only allow the app's local database and workers on secure origins. The proxy serves one, signed by its own private certificate authority.

1. In `.env`, set `LAN_HTTPS_HOST` to the address the phone uses to reach this machine (on your LAN or VPN), then run `pnpm dev:backend`.
2. On the iPhone, trust the certificate authority:
   1. Open `https://<LAN_HTTPS_HOST>:8443/local-ca.crt` in Safari. It warns that the connection isn't private; choose **Show Details**, then **visit this website**, then allow the profile download.
   2. Install the profile in **Settings**, then **General**, then **VPN & Device Management**.
   3. Turn on full trust in **Settings**, then **General**, then **About**, then **Certificate Trust Settings**.
3. Open `https://<LAN_HTTPS_HOST>:8443` and sign in. Read the code from the mail catcher on this machine.

The certificate authority is kept in `.local/caddy/` (git-ignored), so `pnpm db:reset` keeps it and the phone stays trusted. Deleting that folder creates a new authority, which the phone must trust again.

To use it as an app, open the HTTPS address in Safari and choose **Share**, then **Add to Home Screen**. The home-screen app has its own storage, so sign in once more there. After the first load it opens with no connection, and a banner offers to reload when a new build is ready. The footer shows the build time and whether Safari granted persistent storage.

**Phone checklist:**
1. Add to Home Screen; the **Dishkept** icon appears.
2. Open it from the home screen: it's full screen, with no address bar. Sign in.
3. **Offline:**
   1. Turn airplane mode on, close the app fully, and reopen it. The recipes show, and the status says "Offline".
   2. Add a recipe; it shows as unsynced.
   3. Turn airplane mode off. The recipe syncs and appears on the PC.
4. **Updates:**
   1. Rebuild on the PC (`pnpm dev:backend`) and bring the app to the front. The banner appears.
   2. Tap **Reload**. The footer's build time changes.
5. Restart the phone and reopen the app: you're still signed in, and the data is there.
6. Reopen it after a few days: you're still signed in, and the data is there.

## Production

Production runs from its own clone in `~/dishkept` on the host, never from a development checkout. Only the `pnpm prod:*` commands touch it, and the test, seed and reset commands refuse to run against it (`scripts/guard.mjs`, ADR-0018).

| Task | How |
|---|---|
| Deploy what's on `main` | `cd infra/ansible && ansible-playbook site.yml -l pc --ask-vault-pass`, with the settings in [`infra/README.md`](infra/README.md) §2; a run with nothing new changes nothing |
| Health, last backup, deployed build | `pnpm prod:status` in `~/dishkept` |
| Logs | `pnpm prod:logs [service]` |
| Let someone sign up | `pnpm prod:allow name@example.com` (also `prod:allowed`, `prod:disallow`), or send an invite or friend link from the app |
| Back up now | `pnpm prod:backup-now` |
| Restore drill, then a full restore | `pnpm prod:restore-test`, `pnpm prod:restore`; both need the age secret key |
| Change a secret | `pnpm infra:secrets --edit`, then deploy |

Setting production up from nothing, rotating keys, restoring, and moving to a VM are all in [`docs/RUNBOOK.md`](docs/RUNBOOK.md). The infrastructure commands are in [`infra/README.md`](infra/README.md).

## Contributing

- Read [`CLAUDE.md`](CLAUDE.md) first. Its non-negotiable rules (tenant isolation, no secrets on device, offline-first, sync rules that mirror RLS, untrusted AI output) apply to every change.
- Keep pull requests small and scoped to one requirement. Reference the requirement ID in commits, pull requests and tests, for example `feat(import): multi-page photo capture (FR-7)`.
- Use Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `test:`).
- A new dependency or cross-cutting pattern needs a new ADR in `docs/adr/`. When a container or component changes, update `ARCHITECTURE.md`.

## License

Licensed under the [Apache License 2.0](LICENSE).
