# Architecture

> Status: **Current: v1 in production** · Last updated: 2026-10-22
> Dishkept runs at `https://dishkept.geltech.dev` on the owner's PC, behind Cloudflare Tunnel (ADR-0018).
> Structured per the [C4 model](https://c4model.com): System Context → Containers → Components, plus Dynamic and Deployment diagrams. Level 4 (Code) diagrams are intentionally omitted; the code is the source of truth at that level.
>
> Requirements live in [`docs/SPEC.md`](docs/SPEC.md). Decisions and their trade-offs live in [`docs/adr/`](docs/adr/). Requirement IDs (FR-x, NFR-x) are referenced throughout.

Diagrams use Mermaid's C4 syntax, which GitHub renders natively.

---

## 0. Architectural drivers

The requirements that shape the architecture most:

| Driver | Source | Consequence |
|---|---|---|
| Web first; iOS + Android later from one codebase | Platform decision | Cross-platform framework with a web target (ADR-0002, ADR-0007) |
| Offline-first: read, search, create, edit with no signal | FR-20, FR-28, NFR-4 | Local database on device is the primary store; cloud is the sync hub (ADR-0004) |
| Household tenancy with strict isolation | §2, NFR-1 | Every row carries `household_id`; isolation enforced by Postgres Row-Level Security (ADR-0006) |
| AI parsing & substitutions, no keys on device | FR-10, FR-24, NFR-3 | AI calls only from a server-side function (ADR-0005) |
| Last save wins | FR-30 | Row-level last-write-wins; no CRDTs |
| Small team, family-scale load, lowest fixed cost, portable | — | Our own containers in one Compose stack, self-hosted (ADR-0008) |

## 1. Level 1 — System Context

Who uses the system, and what external systems it depends on.

```mermaid
C4Context
  title System Context — Dishkept

  Person(admin, "Household Admin", "Manages household members and roles; full recipe access")
  Person(member, "Household Member", "Imports, edits, searches, cooks")
  Person(viewer, "Household Viewer", "Browses, searches, cooks; read-only")
  Person_Ext(recipient, "Recipient", "Receives a shared recipe; may or may not have an account")

  System(dishkept, "Dishkept", "Stores, imports, searches, and helps cook a household's recipes; AI-assisted")

  System_Ext(llm, "LLM Provider (Anthropic Claude API)", "Parses recipes from images/text/HTML; suggests substitutions")
  System_Ext(recipeSites, "Recipe Websites", "Third-party pages imported by URL")
  System_Ext(email, "Email Delivery (Zoho SMTP)", "Sends sign-in codes and backup-failure alerts")
  System_Ext(stores, "App Stores (later)", "Apple App Store / Google Play, for the native builds (ADR-0007)")
  System_Ext(cloudflare, "Cloudflare", "DNS for geltech.dev; the tunnel's public edge")
  System_Ext(gcs, "Google Cloud Storage", "Encrypted off-site backups")
  System_Ext(osShare, "Phone OS Share Sheet", "Messages, Mail, etc. for sending PDF/text")

  Rel(admin, dishkept, "Manages household, recipes")
  Rel(member, dishkept, "Imports, edits, cooks")
  Rel(viewer, dishkept, "Searches, cooks")
  Rel(dishkept, osShare, "Hands off PDF / text / import link")
  Rel(osShare, recipient, "Delivers via text or email")
  Rel(recipient, dishkept, "Opens import link; saves copy")
  Rel(dishkept, llm, "Parse & substitution requests", "HTTPS")
  Rel(dishkept, recipeSites, "Fetches recipe pages", "HTTPS")
  Rel(dishkept, email, "Sign-in codes; backup alerts")
  Rel(dishkept, cloudflare, "Served through an outbound tunnel")
  Rel(dishkept, gcs, "Nightly encrypted backups")
  Rel(stores, admin, "Installs the native app (later); today the web app installs from the browser")
```

## 2. Level 2 — Containers

The deployable/runnable units inside the Dishkept boundary.

```mermaid
C4Container
  title Container Diagram — Dishkept

  Person(user, "Household User", "Admin / Member / Viewer")

  System_Boundary(sys, "Dishkept") {
    Container(mobile, "Web App", "Expo / React Native Web, TypeScript; Workbox service worker", "UI, cook mode, local search, PDF generation, offline queue; installable, opens offline (ADR-0009)")
    ContainerDb(localDb, "On-device Database", "SQLite in the browser (OPFS, via PowerSync web SDK)", "Household's recipes; full-text index; pending-upload queue")
    Container(proxy, "Proxy", "Caddy", "Single entry point; serves the built web app; routes /auth, /api, /sync")
    Container(syncSvc, "Sync Service", "PowerSync service (self-hosted container)", "Streams household-scoped changes between Postgres and devices")
    Container(api, "API", "Node / TypeScript (Hono)", "Upload of local writes; import pipeline and AI calls (ADR-0012); photos; households, invites and friend links (ADR-0015); share links (ADR-0016); sign-up passes (ADR-0018)")
    Container(auth, "Auth", "GoTrue (self-hosted container)", "Sign-in (email one-time code); issues JWTs with household_id and household_role claims")
    ContainerDb(db, "Database", "PostgreSQL 17 with RLS", "System of record: households, users, recipes; also holds the sync service's storage database")
    Container(tunnel, "Tunnel", "cloudflared (production only)", "Dials out to Cloudflare; the public address reaches the proxy without open ports (ADR-0018)")
    Container(backup, "Backup", "pg_dump, age, rclone", "Nightly encrypted database and photo backups to Google Cloud Storage (ADR-0018)")
  }

  System_Ext(llm, "Claude API")
  System_Ext(sites, "Recipe Websites")
  System_Ext(email, "Email Delivery (Zoho SMTP)")
  System_Ext(gcs, "Google Cloud Storage")

  Rel(user, mobile, "Uses")
  Rel(mobile, localDb, "Reads/writes (always local-first)")
  Rel(mobile, proxy, "All network traffic", "HTTPS (through the tunnel in production)")
  Rel(tunnel, proxy, "Forwards dishkept.geltech.dev")
  Rel(backup, db, "Nightly dump")
  Rel(backup, gcs, "Encrypted upload", "HTTPS")
  Rel(backup, email, "Failure alerts", "SMTP")
  Rel(proxy, auth, "/auth")
  Rel(proxy, api, "/api")
  Rel(proxy, syncSvc, "/sync", "HTTP streaming / WebSocket")
  Rel(syncSvc, db, "Replicates household-scoped data", "Postgres logical replication")
  Rel(api, db, "Reads/writes as the user (RLS applies)")
  Rel(auth, db, "Users, sessions; reads memberships for claims")
  Rel(api, llm, "Parse imports; suggest substitutions", "HTTPS")
  Rel(api, sites, "Fetch page HTML", "HTTPS")
  Rel(auth, email, "Sign-in codes", "SMTP")
```

Photo files live on the API's `photos` volume, served only after an RLS check on their row (ADR-0013); the share landing page (`/s/<code>`) reads a snapshot through `read_share` (ADR-0016).

### Container responsibilities

| Container | Owns | Notes |
|---|---|---|
| **Web App** (`apps/mobile`) | All UI; cook mode; scaling & unit conversion (pure functions, offline); PDF/text rendering for sharing (FR-26); offline import queue (FR-29) | Never holds AI or service-role keys (NFR-3); a service worker precaches the app's files so it opens offline (ADR-0009) |
| **On-device DB** | Local copy of the household's data; source for the in-memory search index (FR-19/20, ADR-0011) | Writes go here first, then upload queue → API |
| **Sync Service** | Change streaming, per-household sync rules | Sync rules mirror RLS; a device only receives its household's rows |
| **API** | Business logic that must be server-side: import pipeline, AI and its monthly cap, photo files, invites and friend links, share links, sign-up passes, write validation, the trash purge | Stateless; verifies the JWT, then runs every statement as the user through asUser |
| **Auth** | Identity; JWT custom claims `household_id`, `household_role` (added by an access-token hook); the sign-up gate (`before_user_created` hook: allowed emails and 24-hour passes from live links, ADR-0018) | Sign in with Apple required on iOS (NFR-12) |
| **Database** | System of record; RLS on every tenant table | Backed up nightly by the Backup container (NFR-9, ADR-0018) |
| **Proxy** | Routing, static web app; TLS locally (Cloudflare terminates it in production) | Only container with a published port in dev; none in production, where the tunnel reaches it |
| **Tunnel** | The public address `dishkept.geltech.dev` | Production only (`docker-compose.prod.yml`, profile `tunnel`); never in a restore drill |
| **Backup** | Nightly `age`-encrypted dump of `app` plus the `photos` volume, uploaded to GCS (30 days), 7 local copies; email on failure; restore and drill | Profile `backup`; connects as `postgres` (operations only); `pnpm test:backup` runs it in CI |

## 3. Level 3 — Components

### 3a. Mobile App

```mermaid
C4Component
  title Component Diagram — Mobile App

  Container_Boundary(mobile, "Mobile App") {
    Component(nav, "Navigation & Screens", "Expo Router + tab bar", "Recipes, Favorites, + (New recipe / Import), List, Household; recipe, edit, import review, cook mode, shopping list, household")
    Component(ui, "Design system", "src/theme + src/ui", "Dishkept tokens and building blocks, including ChipBar (sideways chips with ‹ › buttons, wheel and fade); screens use only these (ADR-0017)")
    Component(capture, "Capture Module", "Import screen", "Photos (FR-7), pasted text and links (FR-8, FR-9); writes an imports row, and a photos row per page")
    Component(cook, "Cook Mode", "Screen", "Step-by-step view, wake lock, scaling and units on the phone; recipes open in the device's units preference (FR-21–23)")
    Component(household, "Household", "Screen", "Members, roles, invites; follows membership changes (FR-3–6)")
    Component(importQ, "Import Queue", "imports table + kicker", "The synced imports table; the kicker asks the server to read waiting imports when online (FR-29, ADR-0012)")
    Component(repo, "Recipe Repository", "TypeScript over PowerSync", "CRUD on local DB; soft delete/trash; favorites (a heart) and your own rating (FR-17, FR-44); role checks for UI")
    Component(search, "Search", "In-memory index over the local DB (ADR-0011)", "Title/ingredient/tag search + tag filters, offline (FR-19/20)")
    Component(cookEngine, "Cook Engine", "Pure TS (packages/domain)", "Scaling, unit conversion, step state (FR-21–23)")
    Component(shopping, "Shopping List", "Screen + shoppingLines", "Adds a recipe's ingredients at the viewed servings; merges lines; aisles (FR-31–35, ADR-0019)")
    Component(cookLog, "Cook Diary", "Screens + cook_logs", "I cooked this on a recipe and at the end of cook mode; entries with a day, notes and up to 8 photos; diary filtered by recipe; cook history on the recipe (FR-37–41)")
    Component(theme, "Appearance", "CSS variables + useAppearance", "System, light or dark, per device (ADR-0020)")
    Component(sharing, "Sharing", "Share menu, PDF, /s page", "Text and PDF on the phone; links read snapshots anonymously (FR-26, FR-27)")
    Component(apiClient, "API Client", "fetch", "Typed calls to the API; attaches JWT")
    Component(authC, "Session", "@supabase/auth-js against GoTrue", "Sign-in, token refresh, household/role claims")
  }

  ContainerDb(localDb, "On-device DB", "SQLite")
  Container(api, "API")

  Rel(nav, ui, "Built from")
  Rel(nav, capture, "Starts import")
  Rel(capture, importQ, "Enqueues")
  Rel(importQ, apiClient, "Submits when online")
  Rel(nav, repo, "Reads/writes recipes")
  Rel(nav, search, "Queries")
  Rel(nav, cook, "Cook mode")
  Rel(cook, cookEngine, "Scales and converts")
  Rel(nav, shopping, "Shopping list")
  Rel(shopping, repo, "Reads recipes; writes shopping rows")
  Rel(nav, cookLog, "Cook diary")
  Rel(cookLog, localDb, "Writes cook_logs and cook photos")
  Rel(ui, theme, "Colors from")
  Rel(nav, sharing, "Share")
  Rel(repo, localDb, "SQL")
  Rel(search, localDb, "Reads rows to build the index")
  Rel(apiClient, api, "HTTPS + JWT")
  Rel(sharing, apiClient, "Create, stop, read and save share links")
```

### 3b. API

```mermaid
C4Component
  title Component Diagram — API

  Container_Boundary(api, "API") {
    Component(guard, "Auth Guard", "Middleware", "Verifies JWT; resolves household_id and role; rejects Viewer writes")
    Component(importFn, "Import Orchestrator", "Route: /api/imports/:id/parse", "Claims the import as the user; reads JSON-LD or asks the AI parser; writes the draft to the row (ADR-0012)")
    Component(urlX, "URL Extractor", "Module", "Fetches HTML with address checks after DNS and on redirects; schema.org Recipe JSON-LD when present; else cleaned text → LLM")
    Component(parser, "AI Parser", "Module", "Prompts LLM with image(s)/text; validates against Recipe JSON schema; flags low-confidence fields (FR-10/11)")
    Component(subs, "Substitutions", "POST /api/substitutions", "Asks Claude per ingredient; remembers answers in substitutions (FR-24)")
    Component(invites, "Household API", "/api/invites, /api/members, /api/household, /api/friend-links", "Invites (create, preview, accept, cancel), friend links, removing members, leaving; calls the household definer functions (ADR-0015) (FR-3–6)")
    Component(quota, "AI Usage Meter", "ai_usage table", "Records spend per household per month; enforces the cap (NFR-7)")
    Component(llmGw, "LLM Gateway", "Module", "Single place for model choice, retries, timeouts, prompt versions")
    Component(writeFn, "Write Upload Handler", "Route: /api/upload", "Applies queued local writes; last-write-wins on updated_at (FR-30)")
    Component(photosFn, "Photos", "PUT/GET /api/photos/:id", "Stores page and dish photos on the volume; serves them after an RLS check on the row (ADR-0013)")
    Component(signupFn, "Sign-up passes", "/api/signup-pass, /api/friend-links/status", "Turns a live invite, friend or share link into a 24-hour pass for the sign-up gate (ADR-0018)")
    Component(purgeFn, "Trash purge", "POST /api/trash/purge", "Hard-deletes rows 30 days in the trash, and their photo files (FR-18)")
    Component(shareFn, "Share Service", "/api/shares", "Creates and stops links; serves snapshots to signed-out visitors through asAnonymous; saves a copy into the recipient household (FR-27, ADR-0016)")
  }

  ContainerDb(db, "Cloud DB")
  ContainerDb(blob, "Photo files (API volume, ADR-0013)")
  System_Ext(llm, "Claude API")
  System_Ext(sites, "Recipe Websites")

  Rel(guard, importFn, "")
  Rel(guard, subs, "")
  Rel(guard, writeFn, "")
  Rel(guard, invites, "")
  Rel(guard, photosFn, "")
  Rel(guard, purgeFn, "")
  Rel(guard, shareFn, "")
  Rel(importFn, urlX, "URL source")
  Rel(importFn, parser, "Photo/text source")
  Rel(urlX, parser, "Fallback")
  Rel(urlX, sites, "GET")
  Rel(parser, llmGw, "")
  Rel(subs, llmGw, "")
  Rel(llmGw, quota, "Check & record")
  Rel(llmGw, llm, "HTTPS")
  Rel(importFn, blob, "Reads the pages")
  Rel(photosFn, blob, "Files")
  Rel(invites, db, "Definer functions")
  Rel(signupFn, db, "Pass rows")
  Rel(writeFn, db, "Upsert as user")
  Rel(shareFn, db, "Snapshot / copy")
  Rel(quota, db, "Usage rows")
```

## 4. Dynamic diagram — Import from photo (FR-7, FR-10–12, FR-29)

```mermaid
sequenceDiagram
  autonumber
  actor U as Member
  participant M as Mobile App
  participant Q as Attachment queue (IndexedDB)
  participant D as Local DB → Sync → Postgres
  participant A as API
  participant V as photos volume
  participant L as Claude API

  U->>M: Take or pick 1–8 pages
  M->>M: Resize to 1568 px, re-encode JPEG
  M->>D: imports row (photo) + a photos row per page
  M->>Q: Keep each file until uploaded
  alt Offline
    M-->>U: "Saved. It'll be read when you're back online."
  end
  D->>A: Rows upload (/api/upload)
  Q->>A: PUT /api/photos/:id per page
  A->>V: Store file, set uploaded_at
  M->>A: POST /api/imports/:id/parse
  A-->>M: 409 photos_pending until every page is uploaded, then 202
  A->>V: Read pages
  A->>L: Pages as images + photo prompt + record_recipe tool
  L-->>A: Draft + low-confidence fields
  A->>D: Validated draft on the import (syncs back)
  M-->>U: Review screen (pages beside the draft)
  U->>M: Save (pages stay as originals; optional dish photo)
```

URL import follows the same flow, with the URL Extractor trying schema.org `Recipe` JSON-LD first and calling the LLM only when structured data is missing or incomplete. That keeps cost down and accuracy up.

## 5. Deployment diagram

```mermaid
C4Deployment
  title Deployment — Production

  Deployment_Node(phone, "User's browser or installed web app", "Phone or computer; any current browser") {
    Container(mobile, "Web App", "Expo web build + Workbox service worker")
    ContainerDb(localDb, "SQLite", "On the device (OPFS or IndexedDB)")
  }

  Deployment_Node(host, "Owner's Windows PC", "Docker Desktop on WSL; Compose project dishkept") {
    Container(tunnel, "cloudflared", "Cloudflare Tunnel")
    Container(backupSvc, "backup", "pg_dump, age, rclone")
    Container(proxy, "proxy", "Caddy")
    Container(api, "api", "Node")
    Container(auth, "auth", "GoTrue")
    Container(sync, "sync", "PowerSync service")
    ContainerDb(db, "db", "PostgreSQL 17")
  }

  Deployment_Node(cf, "Cloudflare", "DNS for geltech.dev; tunnel edge") {
    Container(edge, "dishkept.geltech.dev", "HTTPS")
  }

  Deployment_Node(gcp, "Google Cloud", "") {
    ContainerDb(bucket, "Backup bucket", "GCS, 30-day lifecycle")
  }

  Deployment_Node(anth, "Anthropic", "") {
    Container(llm, "Claude API", "")
  }

  Deployment_Node(zoho, "Zoho Mail", "") {
    Container(smtp, "smtp.zoho.com", "Sender noreply@geltech.dev")
  }

  Rel(mobile, edge, "HTTPS")
  Rel(tunnel, edge, "Outbound tunnel")
  Rel(tunnel, proxy, "HTTP")
  Rel(backupSvc, bucket, "Nightly, encrypted")
  Rel(proxy, api, "")
  Rel(proxy, auth, "")
  Rel(proxy, sync, "")
  Rel(sync, db, "Logical replication")
  Rel(api, db, "")
  Rel(api, llm, "HTTPS")
  Rel(auth, smtp, "Sign-in codes")
  Rel(backupSvc, smtp, "Failure alerts")
```

**Environments:**
- **Local:** Compose project `recipe-app` with `.env` and the dev profile, which adds a mail catcher; the Expo web dev server, or the built app from the proxy.
- **Production:** project `dishkept` on the owner's PC, using the same Compose file plus `docker-compose.prod.yml` and `.env.production`, run only through `pnpm prod:*`, from a dedicated clone on the Linux disk (`~/dishkept`), never the development checkout. It is reached at `https://dishkept.geltech.dev` through Cloudflare Tunnel (ADR-0018). `scripts/guard.mjs` keeps dev and test commands away from it.
- **Fallback:** a single GCP VM running the same files (ADR-0008); moving is a restore. The steps are in `docs/RUNBOOK.md`. The VM is off by default (`-var vm=true` creates it). An e2-micro (free tier) runs the stack, but not a restore drill beside it, which needs an e2-small; a trial on 2026-10-21 passed on an e2-small, and the VM was then removed.
- **How it is built:**
  - OpenTofu (`infra/tofu`) creates the Cloudflare zone, tunnel and DNS record, the backup bucket and its service account, and the optional VM;
  - Ansible (`infra/ansible`) sets up the PC or the VM, writes the secrets from an Ansible Vault file, and runs `pnpm prod:*` (ADR-0021).

## 6. Data model (conceptual)

```mermaid
erDiagram
  HOUSEHOLD ||--o{ MEMBERSHIP : has
  USER ||--|| MEMBERSHIP : "belongs to (v1: one)"
  HOUSEHOLD ||--o{ RECIPE : owns
  RECIPE ||--o{ SOURCE : "imported from"
  RECIPE ||--o{ PHOTO : has
  RECIPE ||--o{ SUBSTITUTION : "remembered for"
  IMPORT ||--o{ PHOTO : pages
  HOUSEHOLD ||--o{ IMPORT : queues
  USER ||--o{ FAVORITE : marks
  RECIPE ||--o{ FAVORITE : "hearted as"
  USER ||--o{ RECIPE_RATING : gives
  RECIPE ||--o{ RECIPE_RATING : "rated by"
  RECIPE ||--o| RECIPE_RATING_TOTALS : "averaged in"
  RECIPE ||--o{ SHARE : "shared as"
  HOUSEHOLD ||--o{ INVITE : issues
  HOUSEHOLD ||--o{ AI_USAGE : accrues
  HOUSEHOLD ||--o{ FRIEND_LINK : issues
  HOUSEHOLD ||--o{ SHOPPING_ITEM : lists
  HOUSEHOLD ||--o{ AISLE_CHOICE : remembers
```

Conventions for every tenant table:
- `id` as a UUID, generated on the device so it works offline
- `household_id` (NOT NULL, indexed); RLS policy `household_id = auth_household_id()`
- `created_at`, `updated_at`, `updated_by`, `deleted_at` (soft delete → 30-day trash, FR-18)
- Nutrition per serving (FR-43) is an optional `nutrition` jsonb object on the recipe row (`calories`, `protein_g`, `carbs_g`, `fat_g`; null when none), checked by `valid_nutrition` with the same limits as the domain schema; the phone reads it apart from the rest of the row, so a value it cannot read never hides the recipe
- Ingredients and steps are JSON arrays on the recipe row (ADR-0010), each element with a stable id; ingredients keep the typed line (`raw`) plus parsed `quantity`, `quantity_max`, `unit`, `item`, `note`, so scaling, search, and the Phase 2 shopping list can use them
- Favorites are a per-user table (`favorites`), synced only to that user
- `RECIPE_RATING` (`recipe_ratings`, FR-44): one row per person and recipe, `stars` 1–5, cleared by `deleted_at`; read and written only by its owner (any role) and synced only to them (`user_ratings`). `RECIPE_RATING_TOTALS` (`recipe_rating_totals`): each rated recipe's `stars_total` and `ratings_count`, kept by a definer trigger that recounts the recipe's live ratings; read by the household (`household_ratings`), written by no client, `updated_by` always null (ADR-0022)
- `INVITE` (`invites`): role, sha256 of the link's code, expiry, accepted and cancelled times; read by the household's Admins only and written only by the ADR-0015 functions. Roles are checked live from `memberships`, which syncs to phones (`household_members`, `my_membership`)
- `SHOPPING_ITEM` (`shopping_items`): one row per added ingredient or typed item: `item`, `item_key` (the merge key), scaled `quantity`, `quantity_max`, `unit`, `note`, `aisle`, `recipe_id` and a copied `recipe_title` (no foreign key), `checked_at`. Merged into lines on screen by `shoppingLines` (ADR-0019); cleared rows are purged after 30 days. Rows and aisle choices move with a person alone who joins another household (an aisle choice only where that household has none for the item)
- `AISLE_CHOICE` (`aisle_choices`): the household's aisle for an `item_key`, unique per household and upserted on it; beats the built-in word list
- `SHARE` (`shares`): `recipe_id`, the validated `snapshot` (with its dish photo's size), sha256 of the link's code, the kept code (`kept_code`, not synced) so Link reuses a live link, `deleted_at` when stopped; read by the household, written only by the ADR-0016 functions; a stopped share and its photo copy go in the 30-day purge
- `COOK_LOG` (`cook_logs`): one meal: `recipe_id` (composite key to the household's recipe, set null when the recipe is purged) and a copied `recipe_title`, `cooked_on` (a day), `cooked_by` (stamped by a trigger: the person who logged it, never changed), `notes`. Trashed entries sync for the Trash; they and their photos are purged after 30 days. Moves with the household when a person alone joins another (ADR-0015)
- `PHOTO` (`photos`): `kind` (page, dish or cook), `import_id` and `position` for pages, `cook_log_id` and `position` for a meal's photos (never a `recipe_id`, so a recipe purge keeps them), `recipe_id`, `media_type`, `bytes`, `width`, `height`, `uploaded_at`; the bytes are on the `photos` volume. A recipe's dish photo is `recipes.photo_id` (ADR-0013)

- `FRIEND_LINK` (`friend_links`): sha256 of a `/welcome/<code>` link's code and a 30-day expiry; made by `create_friend_link` (which records `created_by`), seen and revoked (`revoke_friend_link`) by the household's Admins and the person who made it, its status (live, ended, used) read signed out through `friend_link_status`, not synced. Single-use (FR-42): the sign-up pass it grants (`signup_passes.friend_link_id`) holds it for one address, and `handle_new_user` marks it accepted (`accepted_at`, `accepted_by`, `accepted_email`) when that account is made
- The sign-up gate's `signup_settings`, `signup_allowed` and `signup_passes` hold no household data: RLS on, no policies, no grants, not synced (ADR-0018)

`SHARE` stores an immutable JSON **snapshot** of the recipe. Recipients import from the snapshot, never from the sender's live row.

## 7. Cross-cutting concerns

| Concern | Approach | NFR |
|---|---|---|
| **Tenant isolation** | RLS on every table; the API reaches the database only through asUser, as a role that cannot bypass RLS; sync config scoped by `household_id`; an automated suite tries cross-household reads and writes and checks the roles themselves | NFR-1 |
| **Roles** | Checked live from `memberships` (ADR-0015), which syncs to the device; the JWT also carries a `household_role` claim. RLS write policies require admin or member; the UI hides edit controls from Viewers | FR-4 |
| **Conflicts** | Row-level LWW on `updated_at` (server clock on upload). Ingredients and steps are JSON arrays on the recipe row (ADR-0010), so a recipe saves as one unit | FR-30 |
| **AI** | All prompts versioned in `apps/api/src/llm/prompts/`; output validated against a JSON schema; usage metered per household | NFR-3, NFR-7 |
| **Secrets** | The web app ships no keys. Database passwords, the token signing key, and the Claude API key live in .env on the server | NFR-3 |
| **Observability** | Structured JSON logs from the API and the services, read with `pnpm prod:logs`; `pnpm prod:status` shows health, the deployed build and the last backup; the backup container emails `OWNER_EMAIL` when a backup fails; AI spend per household in `ai_usage`. No crash reporting yet | NFR-6, NFR-7 |
| **Backups** | Nightly `age`-encrypted dumps of the database and the `photos` volume to GCS, kept 30 days, by a service account that cannot delete; a monthly restore drill (ADR-0018). Household JSON export later | NFR-9, NFR-10 |
| **Accessibility** | Dynamic type, screen-reader labels, contrast checks in review | NFR-11 |

## 8. Future evolution

- **Phase 2 shopping list (built, ADR-0019; listed here for history):** `shopping_items` and `aisle_choices`, synced like recipes; added rows are merged on screen by item, reusing the structured ingredient model and the unit converter.
- **Phase 3 meal planning:** `meal_plan`, `meal_plan_entry` referencing recipes; generates shopping items.
- **Desktop:** Expo/React Native for web or Tauri reusing the TS domain packages; PowerSync has a web SDK.
- **Semantic search:** `pgvector` embeddings server-side, with keyword search kept as the offline fallback.

## 9. Decision log

See [`docs/adr/`](docs/adr/README.md). Current: ADR-0001 through ADR-0021. The most recent:

- ADR-0018: production on a home PC, behind Cloudflare Tunnel, with GCS backups
- ADR-0019: the shopping list
- ADR-0020: light mode with CSS variables
- ADR-0021: infrastructure as code (OpenTofu and Ansible)
