# Recipe App *(working name)*

One home for every recipe your family cares about. Snap a cookbook page, share a link, or paste some text, and AI turns it into a clean, searchable recipe your whole household can cook from, even offline.

> **Status:** Pre-alpha. Spec and architecture drafted; no code yet.

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

## Tech stack (proposed)
Expo / React Native (TypeScript) · PowerSync (SQLite offline sync) · Supabase (Postgres + RLS, Auth, Storage, Edge Functions) · Anthropic Claude API

## Repo layout (planned)
```
apps/mobile/          Expo app
packages/domain/      Shared recipe schema, scaling, units
supabase/
  migrations/         SQL schema + RLS policies
  functions/          Edge Functions (import, substitute, upload, invites, shares)
  seed.sql
docs/
  SPEC.md
  adr/
```

## Getting started
*Coming with the scaffolding PR.* Prerequisites will be Node 22+, pnpm, Docker, the Supabase CLI, and an Expo dev client on a device or simulator. Copy `.env.example` to `.env` and fill in values.

## License
Private. All rights reserved.
