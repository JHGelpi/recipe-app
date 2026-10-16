# Recipe App *(working name)*

One home for every recipe your family cares about. Snap a cookbook page, share a link, or paste some text, and AI turns it into a clean, searchable recipe your whole household can cook from, even offline.

> **Status:** Pre-alpha. Walking skeleton: sign-in, a household recipe list, offline writes, and sync, on the web.

## Why
Recipes end up scattered across Google Drive, iCloud, the Notes app, bookmarks, and cookbook shelves. This app consolidates them, structures them automatically, and makes them easy to find ("show me all chicken recipes") and cook from.

## Features (v1)
- **Import** from phone photos (multi-page, handwriting), websites, and pasted text
- **AI parsing** into title, structured ingredients, steps, times, and tags, with a review step
- **Search** by title, ingredient, and tag, working offline
- **Cook mode**: screen stays on, step-by-step, scaling, AI ingredient substitutions
- **Households** with Admin / Member / Viewer roles
- **Share** a recipe as a PDF or text, or as a link the recipient can import into their own app
- **Offline-first** with cloud sync across devices

**Roadmap:** Phase 2 shopping list → Phase 3 weekly meal planning → desktop app.

## Docs
| Doc | Purpose |
|---|---|
| [`docs/SPEC.md`](docs/SPEC.md) | Product requirements (functional & non-functional) |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | C4 architecture: context, containers, components, deployment |
| [`docs/adr/`](docs/adr/) | Architecture decision records |
| [`CLAUDE.md`](CLAUDE.md) | Rules and context for AI coding agents |

## Tech stack
Expo / React Native Web (TypeScript, web first) · PowerSync (SQLite offline sync, self-hosted) · Node API (Hono) · GoTrue auth · Postgres 17 with RLS · Caddy · Docker Compose · Anthropic Claude API (later)

## Repo layout
```
apps/mobile/          Expo app (web build served by the proxy)
apps/api/             Node API: /api/upload, asUser, RLS and stack tests
packages/domain/      Shared recipe schema, scaling, units
db/
  migrations/         SQL schema + RLS policies (dbmate)
  init/               First-boot database roles
  seed.sql            Two seeded households
powersync/            Sync service config and sync streams
deploy/               Proxy (Caddy) image and config
e2e/                  Playwright tests against the built app
docs/
  SPEC.md
  adr/
docker-compose.yml    The whole backend
```

## Getting started
Prerequisites: Node 22, Docker with Compose, `corepack enable` (for pnpm), and 6 GB or more of memory available to Docker.

```bash
pnpm install
pnpm dev:backend   # creates .env if missing; builds and starts the stack
pnpm db:seed       # two households and four users
```

Then open http://localhost:8080 and sign in with one of the seeded emails:

| Email | Household | Role |
|---|---|---|
| `admin-a@example.test` | A | Admin |
| `member-a@example.test` | A | Member |
| `viewer-a@example.test` | A | Viewer |
| `admin-b@example.test` | B | Admin |

Sign-in codes arrive in the local mail catcher at http://127.0.0.1:8025. See [`CLAUDE.md`](CLAUDE.md) for the test commands.

## License
Private. All rights reserved.
