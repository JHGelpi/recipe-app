# 0004. Offline-first sync with PowerSync, last-write-wins

- **Status:** Accepted, amended by 0008
- **Date:** 2026-10-12

## Context
Users must view, search, create, and edit with no connectivity (FR-28, NFR-4), and changes must reach other household devices (FR-30). The product owner accepted "last save wins" for conflicts.

## Decision
Use **PowerSync** to sync Postgres ↔ on-device SQLite. Writes go to local SQLite first and are uploaded through our API's `/api/upload` endpoint, which applies **row-level last-write-wins** by `updated_at`. Sync rules scope each device to its own `household_id`. IDs are client-generated UUIDs.

## Alternatives considered
- **WatermelonDB + custom sync endpoints:** mature, but we'd build and maintain the sync protocol.
- **ElectricSQL:** promising Postgres sync, less proven for mobile write paths.
- **Online-only with cache:** fails FR-28.
- **CRDTs (Automerge/Yjs):** solves merge conflicts we've chosen not to care about; added complexity.

## Consequences
- Local SQLite gives us offline full-text search for free (FTS5).
- Simultaneous offline edits to the same recipe: one silently wins. Acceptable per spec; revisit if users complain.
- The PowerSync service runs as a container in our own stack (ADR-0008).
- Sync rules must stay in lockstep with RLS policies; CI checks both.
