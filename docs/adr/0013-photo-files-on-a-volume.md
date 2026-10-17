# 13. Photo files on a volume behind RLS-checked endpoints

Date: 2026-10-17 · Status: Accepted

## Context

Photo import (FR-7), the originals kept on a recipe (FR-12) and a dish photo per recipe (FR-15) need file storage. ADR-0008 left the choice to this sub-project. Photos are private to the household (NFR-2), the stack is self-hosted at family scale, and phones must take photos offline and show dish photos offline (FR-29).

## Decision

- A synced `photos` table describes each photo (kind, import and position, recipe, size, `uploaded_at`), with RLS like every tenant table. The bytes live on a Docker volume, `photos`, mounted into the API at `/data/photos/<household_id>/<id>.jpg`.
- `PUT /api/photos/:id` stores a file only when the photo's row is visible to the user as an admin or member, the bytes are a JPEG whose size matches the row, and the body is at most 3 MB; then it sets `uploaded_at`. `GET /api/photos/:id` reads the row as the user first, so RLS decides who sees a file. Files are written aside and renamed. A dismissed photo answers 410 so phones stop retrying.
- The 30-day purge deletes expired photo rows through RLS (`photos_purge`), then their files.
- On the phone, PowerSync's `AttachmentQueue` with the IndexedDB adapter keeps each new file until it is uploaded, and downloads every live recipe's dish photo. Page photos are fetched when opened and kept in Cache Storage. Both are cleared on sign-out. The queue is marked experimental by PowerSync, so `src/photos/queue.ts` is the only module that uses its API.
- Photos are resized on the phone (pages 1568 px, dish photos 1200 px, JPEG) before they are stored or sent.

## Alternatives considered

- **Bytes in Postgres:** one backup and RLS on the bytes themselves, but the database grows by gigabytes and backups and restores get heavy.
- **An S3-style container (Garage, SeaweedFS) with signed links:** closest to cloud hosting, but one more service to run, configure and back up. `PhotoStore` is an interface, so an adapter can replace the disk later.
- **Every photo offline:** several times the phone storage, on an iOS Safari quota that can be evicted.

## Consequences

- **Backups must include the `photos` volume** alongside Postgres (NFR-9). A restore of one without the other leaves rows without files (served as 404) or files without rows (never served).
- Viewers can see photos; only admins and members add, change or remove them.
- A future `PhotoStore` adapter (S3) changes only `apps/api/src/photos/store.ts` and the wiring.
- If PowerSync changes the attachment queue's API, only `src/photos/queue.ts` changes.
