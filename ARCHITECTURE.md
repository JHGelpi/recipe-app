# Architecture

> Status: **Proposed v0.1** · Last updated: 2026-10-12
> Structured per the [C4 model](https://c4model.com): System Context → Containers → Components, plus Dynamic and Deployment diagrams. Level 4 (Code) diagrams are intentionally omitted; the code is the source of truth at that level.
>
> Requirements live in [`docs/SPEC.md`](docs/SPEC.md). Decisions and their trade-offs live in [`docs/adr/`](docs/adr/). Requirement IDs (FR-x, NFR-x) are referenced throughout.

Diagrams use Mermaid's C4 syntax, which GitHub renders natively.

---

## 0. Architectural drivers

The requirements that shape the architecture most:

| Driver | Source | Consequence |
|---|---|---|
| iOS + Android from one codebase, desktop later | Platform decision | Cross-platform framework (ADR-0002) |
| Offline-first: read, search, create, edit with no signal | FR-20, FR-28, NFR-4 | Local database on device is the primary store; cloud is the sync hub (ADR-0004) |
| Household tenancy with strict isolation | §2, NFR-1 | Every row carries `household_id`; isolation enforced by Postgres Row-Level Security (ADR-0006) |
| AI parsing & substitutions, no keys on device | FR-10, FR-24, NFR-3 | AI calls only from a server-side function (ADR-0005) |
| Last save wins | FR-30 | Row-level last-write-wins; no CRDTs |
| Small team, family-scale load, low cost | — | Managed backend (BaaS) over self-hosted services (ADR-0003) |

## 1. Level 1 — System Context

Who uses the system, and what external systems it depends on.

```mermaid
C4Context
  title System Context — Recipe App

  Person(admin, "Household Admin", "Manages household members and roles; full recipe access")
  Person(member, "Household Member", "Imports, edits, searches, cooks")
  Person(viewer, "Household Viewer", "Browses, searches, cooks; read-only")
  Person_Ext(recipient, "Recipient", "Receives a shared recipe; may or may not have an account")

  System(recipeApp, "Recipe App", "Stores, imports, searches, and helps cook a household's recipes; AI-assisted")

  System_Ext(llm, "LLM Provider (Anthropic Claude API)", "Parses recipes from images/text/HTML; suggests substitutions")
  System_Ext(recipeSites, "Recipe Websites", "Third-party pages imported by URL")
  System_Ext(email, "Email Delivery", "Sends sign-in and invite emails")
  System_Ext(stores, "App Stores", "Apple App Store / Google Play distribution")
  System_Ext(osShare, "Phone OS Share Sheet", "Messages, Mail, etc. for sending PDF/text")

  Rel(admin, recipeApp, "Manages household, recipes")
  Rel(member, recipeApp, "Imports, edits, cooks")
  Rel(viewer, recipeApp, "Searches, cooks")
  Rel(recipeApp, osShare, "Hands off PDF / text / import link")
  Rel(osShare, recipient, "Delivers via text or email")
  Rel(recipient, recipeApp, "Opens import link; saves copy")
  Rel(recipeApp, llm, "Parse & substitution requests", "HTTPS")
  Rel(recipeApp, recipeSites, "Fetches recipe pages", "HTTPS")
  Rel(recipeApp, email, "Sends invites / magic links")
  Rel(stores, admin, "Installs app")
```

## 2. Level 2 — Containers

The deployable/runnable units inside the Recipe App boundary.

```mermaid
C4Container
  title Container Diagram — Recipe App

  Person(user, "Household User", "Admin / Member / Viewer")
  Person_Ext(recipient, "Recipient")

  System_Boundary(sys, "Recipe App") {
    Container(mobile, "Mobile App", "Expo / React Native, TypeScript", "UI, cook mode, local search, PDF generation, offline queue")
    ContainerDb(localDb, "On-device Database", "SQLite (via PowerSync SDK)", "Household's recipes; full-text index; pending-upload queue")
    Container(syncSvc, "Sync Service", "PowerSync (managed)", "Streams household-scoped changes between Postgres and devices")
    Container(api, "Edge Functions API", "Supabase Edge Functions, Deno/TypeScript", "Import pipeline, AI calls, invites, share links, upload of local writes")
    Container(auth, "Auth", "Supabase Auth", "Sign-in (email magic link, Apple, Google); issues JWTs with household claim")
    ContainerDb(db, "Cloud Database", "PostgreSQL (Supabase) with RLS", "System of record: households, users, recipes, shares, AI usage")
    ContainerDb(blob, "Object Storage", "Supabase Storage", "Original import photos, recipe photos, generated share PDFs")
    Container(shareWeb, "Share Landing Page", "Static page + Edge Function", "Renders a shared recipe; deep-links into the app to import")
  }

  System_Ext(llm, "Claude API")
  System_Ext(sites, "Recipe Websites")
  System_Ext(email, "Email Delivery")

  Rel(user, mobile, "Uses")
  Rel(mobile, localDb, "Reads/writes (always local-first)")
  Rel(localDb, syncSvc, "Bidirectional sync", "WebSocket/HTTPS")
  Rel(syncSvc, db, "Replicates household-scoped data", "Postgres logical replication")
  Rel(mobile, api, "Import, substitutions, invites, shares; uploads queued writes", "HTTPS + JWT")
  Rel(mobile, auth, "Sign in", "HTTPS")
  Rel(mobile, blob, "Uploads photos", "HTTPS signed URL")
  Rel(api, db, "Reads/writes as user (RLS applies)")
  Rel(api, blob, "Reads originals; writes PDFs")
  Rel(api, llm, "Parse / substitute", "HTTPS")
  Rel(api, sites, "Fetch page HTML", "HTTPS")
  Rel(auth, email, "Magic links, invites")
  Rel(recipient, shareWeb, "Opens shared link")
  Rel(shareWeb, mobile, "Deep link to import")
```

### Container responsibilities

| Container | Owns | Notes |
|---|---|---|
| **Mobile App** | All UI; cook mode; scaling & unit conversion (pure functions, offline); PDF/text rendering for sharing (FR-26); offline import queue (FR-29) | Never holds AI or service-role keys (NFR-3) |
| **On-device DB** | Local copy of the household's data; FTS index for search (FR-19/20) | Writes go here first, then upload queue → API |
| **Sync Service** | Change streaming, per-household sync rules | Sync rules mirror RLS; a device only receives its household's rows |
| **Edge Functions API** | Business logic that must be server-side: import pipeline, AI, invites, share tokens, write validation | Stateless; all functions verify JWT and role |
| **Auth** | Identity; JWT custom claims `household_id`, `role` | Sign in with Apple required on iOS (NFR-12) |
| **Cloud DB** | System of record; RLS on every tenant table | Point-in-time recovery (NFR-9) |
| **Object Storage** | Binary files under `households/{household_id}/...` | Bucket policies mirror RLS |
| **Share Landing Page** | Public, read-only render of a share snapshot | Exposes only the snapshot, never the live recipe (NFR-2) |

## 3. Level 3 — Components

### 3a. Mobile App

```mermaid
C4Component
  title Component Diagram — Mobile App

  Container_Boundary(mobile, "Mobile App") {
    Component(nav, "Navigation & Screens", "Expo Router", "Library, Recipe detail, Edit, Import review, Cook mode, Household settings")
    Component(capture, "Capture Module", "expo-camera / image-picker / share intent", "Collects photos, URLs, pasted text; enqueues import jobs")
    Component(importQ, "Import Queue", "TypeScript", "Persists pending imports; retries when online (FR-29)")
    Component(repo, "Recipe Repository", "TypeScript over PowerSync", "CRUD on local DB; soft delete/trash; role checks for UI")
    Component(search, "Search", "SQLite FTS5", "Title/ingredient/tag search + filters, offline (FR-19/20)")
    Component(cook, "Cook Engine", "Pure TS", "Scaling, unit conversion, step state, keep-awake (FR-21–23)")
    Component(shareOut, "Share Builder", "expo-print / expo-sharing", "Formats PDF/text; requests share links (FR-26/27)")
    Component(apiClient, "API Client", "Supabase JS", "Typed calls to Edge Functions; attaches JWT")
    Component(authC, "Session", "Supabase Auth SDK", "Sign-in, token refresh, household/role claims")
  }

  ContainerDb(localDb, "On-device DB", "SQLite")
  Container(api, "Edge Functions API")

  Rel(nav, capture, "Starts import")
  Rel(capture, importQ, "Enqueues")
  Rel(importQ, apiClient, "Submits when online")
  Rel(nav, repo, "Reads/writes recipes")
  Rel(nav, search, "Queries")
  Rel(nav, cook, "Cook mode")
  Rel(nav, shareOut, "Share")
  Rel(repo, localDb, "SQL")
  Rel(search, localDb, "FTS queries")
  Rel(apiClient, api, "HTTPS + JWT")
  Rel(shareOut, apiClient, "Create share token")
```

### 3b. Edge Functions API

```mermaid
C4Component
  title Component Diagram — Edge Functions API

  Container_Boundary(api, "Edge Functions API") {
    Component(guard, "Auth Guard", "Middleware", "Verifies JWT; resolves household_id and role; rejects Viewer writes")
    Component(importFn, "Import Orchestrator", "Function: /import", "Routes by source type; stores original; returns draft for review")
    Component(urlX, "URL Extractor", "Module", "Fetches HTML; uses schema.org Recipe JSON-LD when present; else cleaned text → LLM")
    Component(parser, "AI Parser", "Module", "Prompts LLM with image(s)/text; validates against Recipe JSON schema; flags low-confidence fields (FR-10/11)")
    Component(subFn, "Substitution Service", "Function: /substitute", "Ingredient + recipe context → options with amounts & effects (FR-24)")
    Component(quota, "AI Usage Meter", "Module", "Records tokens per household; enforces quota (NFR-7)")
    Component(llmGw, "LLM Gateway", "Module", "Single place for model choice, retries, timeouts, prompt versions")
    Component(writeFn, "Write Upload Handler", "Function: /upload", "Applies queued local writes; last-write-wins on updated_at (FR-30)")
    Component(inviteFn, "Invite Service", "Function: /invites", "Household invites & new-household invites (FR-3, FR-6)")
    Component(shareFn, "Share Service", "Function: /shares", "Creates snapshot + token; imports snapshot into recipient household (FR-27)")
  }

  ContainerDb(db, "Cloud DB")
  ContainerDb(blob, "Object Storage")
  System_Ext(llm, "Claude API")
  System_Ext(sites, "Recipe Websites")

  Rel(guard, importFn, "")
  Rel(guard, subFn, "")
  Rel(guard, writeFn, "")
  Rel(guard, inviteFn, "")
  Rel(guard, shareFn, "")
  Rel(importFn, urlX, "URL source")
  Rel(importFn, parser, "Photo/text source")
  Rel(urlX, parser, "Fallback")
  Rel(urlX, sites, "GET")
  Rel(parser, llmGw, "")
  Rel(subFn, llmGw, "")
  Rel(llmGw, quota, "Check & record")
  Rel(llmGw, llm, "HTTPS")
  Rel(importFn, blob, "Store original")
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
  participant Q as Import Queue (local)
  participant S as Object Storage
  participant F as /import
  participant L as Claude API
  participant D as Local DB → Sync → Postgres

  U->>M: Take 1..n photos
  M->>Q: Enqueue job (photos on device)
  alt Offline
    Q-->>U: "Queued — will parse when online"
  end
  Q->>S: Upload originals (signed URL)
  Q->>F: POST /import {type: photo, paths}
  F->>F: Auth guard, quota check
  F->>L: Images + extraction prompt + JSON schema
  L-->>F: Structured recipe + confidence
  F->>F: Validate schema, flag low-confidence
  F-->>M: Draft recipe
  M-->>U: Review screen (highlights uncertain fields)
  U->>M: Edit & Save
  M->>D: Write locally, sync up
```

URL import follows the same flow, with the URL Extractor trying schema.org `Recipe` JSON-LD first and calling the LLM only when structured data is missing or incomplete. That keeps cost down and accuracy up.

## 5. Deployment diagram

```mermaid
C4Deployment
  title Deployment — Production

  Deployment_Node(phone, "User's phone", "iOS 17+ / Android 10+") {
    Container(mobile, "Mobile App", "Expo build via EAS")
    ContainerDb(localDb, "SQLite", "On-device")
  }

  Deployment_Node(supa, "Supabase (managed, US region)", "") {
    Container(api, "Edge Functions", "Deno")
    Container(auth, "Auth", "GoTrue")
    ContainerDb(db, "PostgreSQL", "RLS, PITR backups")
    ContainerDb(blob, "Storage", "S3-compatible")
    Container(shareWeb, "Share Landing", "Edge Function serving HTML")
  }

  Deployment_Node(ps, "PowerSync Cloud", "Managed") {
    Container(sync, "Sync Service", "")
  }

  Deployment_Node(anth, "Anthropic", "") {
    Container(llm, "Claude API", "")
  }

  Rel(mobile, api, "HTTPS")
  Rel(localDb, sync, "WebSocket")
  Rel(sync, db, "Logical replication")
  Rel(api, llm, "HTTPS")
```

**Environments:** `local` (Supabase CLI in Docker + Expo dev client), `staging`, `production`. Each is a separate Supabase project and PowerSync instance. Builds and OTA updates ship through EAS.

## 6. Data model (conceptual)

```mermaid
erDiagram
  HOUSEHOLD ||--o{ MEMBERSHIP : has
  USER ||--|| MEMBERSHIP : "belongs to (v1: one)"
  HOUSEHOLD ||--o{ RECIPE : owns
  RECIPE ||--o{ INGREDIENT : lists
  RECIPE ||--o{ STEP : has
  RECIPE ||--o{ RECIPE_TAG : tagged
  TAG ||--o{ RECIPE_TAG : ""
  HOUSEHOLD ||--o{ TAG : defines
  RECIPE ||--o{ SOURCE : "imported from"
  RECIPE ||--o{ PHOTO : has
  RECIPE ||--o{ NOTE : has
  USER ||--o{ FAVORITE : marks
  RECIPE ||--o{ SHARE : "shared as"
  HOUSEHOLD ||--o{ INVITE : issues
  HOUSEHOLD ||--o{ AI_USAGE : accrues
```

Conventions for every tenant table:
- `id` as a UUID, generated on the device so it works offline
- `household_id` (NOT NULL, indexed); RLS policy `household_id = auth.jwt() ->> 'household_id'`
- `created_at`, `updated_at`, `updated_by`, `deleted_at` (soft delete → 30-day trash, FR-18)
- Ingredients are stored structured (`quantity`, `unit`, `item`, `prep_note`, `raw_text`) so scaling, search, and the Phase 2 shopping list can use them

`SHARE` stores an immutable JSON **snapshot** of the recipe. Recipients import from the snapshot, never from the sender's live row.

## 7. Cross-cutting concerns

| Concern | Approach | NFR |
|---|---|---|
| **Tenant isolation** | RLS on every table and storage bucket; sync rules scoped by `household_id`; Edge Functions use the user's JWT, never the service role, except in the share-import path, which is audited; an automated test suite tries cross-household reads and writes | NFR-1 |
| **Roles** | `role` claim in the JWT; RLS write policies exclude `viewer`; UI hides edit affordances | FR-4 |
| **Conflicts** | Row-level LWW on `updated_at` (server clock on upload). Ingredients and steps are child rows, saved as a set with the recipe | FR-30 |
| **AI** | All prompts versioned in `supabase/functions/_shared/prompts/`; output validated against a JSON schema; usage metered per household | NFR-3, NFR-7 |
| **Secrets** | Only the Supabase anon key ships in the app. Claude API key and service role key live in Edge Function secrets | NFR-3 |
| **Observability** | Structured logs in Edge Functions; Sentry for app crashes; AI latency/cost dashboard from `ai_usage` | NFR-6, NFR-7 |
| **Backups** | Supabase PITR; household JSON export | NFR-9, NFR-10 |
| **Accessibility** | Dynamic type, screen-reader labels, contrast checks in review | NFR-11 |

## 8. Future evolution

- **Phase 2 shopping list:** new tables (`shopping_list`, `shopping_item`) synced like recipes; ingredient normalization reuses the structured ingredient model.
- **Phase 3 meal planning:** `meal_plan`, `meal_plan_entry` referencing recipes; generates shopping items.
- **Desktop:** Expo/React Native for web or Tauri reusing the TS domain packages; PowerSync has a web SDK.
- **Semantic search:** `pgvector` embeddings server-side, with keyword search kept as the offline fallback.

## 9. Decision log

See [`docs/adr/`](docs/adr/). Current: ADR-0001 through ADR-0006.
