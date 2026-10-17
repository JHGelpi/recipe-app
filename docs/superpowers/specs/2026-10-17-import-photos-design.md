# Import from Photos and Dish Photos — Design

> Status: **Draft for review** · Date: 2026-10-17
> Sub-project 4b of Phase 1 (see `2026-10-12-walking-skeleton-design.md` §1). Builds on import from text and URL (`2026-10-17-import-text-url-design.md`, ADR-0012), whose imports queue, parse endpoint, LLM gateway, draft schema, review screen and kicker this reuses. Requirements: `docs/SPEC.md`. Architecture: `ARCHITECTURE.md`, `docs/adr/`.

## 1. Purpose

Let the owner photograph a cookbook page or a recipe card (one or more pages), have AI read it into a draft, review it and save. The original photos stay viewable on the recipe. Separately, any recipe can carry the owner's own photo of the finished dish. Photos taken offline wait on the phone and upload when it is back online.

**Covers:** FR-7 (photo import, camera or library, multiple pages), FR-10 and FR-11 for photos (AI parsing, review with low-confidence fields), FR-12 for photos (originals stored and viewable), FR-15's own photo (one dish photo per recipe), FR-29 (offline photo imports queued), NFR-2 (photos private to the household), NFR-6 (photo parse under 30 s p90), NFR-7 (photo parses count against the cap).

### Success criteria

1. On the iPhone, Import → Photo → Add page opens the camera or the photo library. Up to 8 pages can be added, removed and reordered before Import.
2. A 1–3 page recipe produces a draft for review in under 30 seconds once its photos are uploaded, with the same fields as a text import. Unsure fields are highlighted.
3. Pages taken offline are kept on the phone, upload when online, and are then read automatically. The import list shows upload progress.
4. A saved photo-import recipe shows its original pages; tapping one shows it full size when online, or from cache after it has been opened once.
5. Any recipe can get, change or lose a dish photo, shown at the top of the recipe and as a thumbnail in the list. Dish photos show offline on every household phone.
6. Another household can never read a photo file or row, and viewers cannot add photos.
7. A photo parse costs about 1.7¢ for one page and 2.7¢ for three, within the existing $2.00 cap.

### Out of scope

- A photo gallery per recipe (one dish photo only).
- Re-parse from the original (FR-13) and the duplicate warning (FR-14), still *proposed*.
- Cropping, rotating or enhancing photos in the app (the phone's own editor can do this before picking).
- A per-household storage limit (revisit with monetization, SPEC §7 q5).
- Photos in shared links and PDFs (sharing sub-project).
- An automated backup job; this spec only records that the photo volume must be backed up with Postgres.

## 2. Decisions made during design

| Decision | Choice | Why |
|---|---|---|
| Scope | Photo import **and** one dish photo per recipe | The owner's choice. They share storage, upload and display code. |
| Where files live | **A Docker volume**, served by the API after an RLS check on the photo's row | The owner's choice. No new container; isolation stays in the database through the `photos` row. Storage sits behind a small interface so an S3-style adapter can replace it. |
| Bytes in Postgres | Rejected | The database grows by gigabytes; backups and restores get heavy. |
| S3-style container (Garage, SeaweedFS) | Rejected for now | One more service to run and back up at family scale. |
| What phones keep offline | **Dish photos only**; original pages on demand, cached once opened | The owner's choice. A complete-looking app offline at roughly 200–400 MB for 2,000 recipes; iOS Safari storage is limited and can be evicted. |
| Phone-side queue | PowerSync's `AttachmentQueue` with the web IndexedDB adapter, already in `@powersync/common` 2.3 and `@powersync/web` 2.4, wrapped in our own `src/photos/` module | No new dependency. It is marked experimental, so the wrapper keeps the rest of the app off its API (ADR-0013). |
| Image size | Pages 1568 px long edge, dish photos 1200 px, JPEG, resized on the phone | Claude scales anything larger to about 1568 px anyway, so more pixels only cost upload time. Small files upload quickly on a phone connection. |
| Page limit | 8 pages per import | Covers any recipe spread; bounds cost (about 5¢ at 8 pages) and request size. |
| Prompt | A separate versioned prompt, `parse-recipe-photo.v1.md`, with the same `record_recipe` tool | Photos need different instructions (page order, handwriting, several recipes on a page); the output contract is unchanged. |

## 3. Data (`db/migrations/`, `powersync/sync-config.yaml`)

### `photos` (household table)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | Client-generated; also the file name. |
| `household_id` | uuid not null | RLS. |
| `kind` | text not null | `page` or `dish`. |
| `import_id` | uuid | Required for `page`, null for `dish`. Must belong to the household. |
| `position` | integer | Page order, 1–8, required for `page`. |
| `recipe_id` | uuid | For a page: set when its import is saved. For a dish photo: the recipe it was taken for. Must belong to the household. |
| `media_type` | text not null | `image/jpeg`. |
| `bytes` | integer not null | 1 to 3,000,000. |
| `width`, `height` | integer not null | 1 to 4,000. |
| `uploaded_at` | timestamptz | Set by the server when the file has arrived. |
| `created_at`, `updated_at`, `updated_by`, `deleted_at` | | As every tenant table (rule 5). |

- **RLS:**
  - select for the household;
  - insert and update for the household's admins and members (viewers refused, rule 4);
  - `photos_purge` delete policy for the 30-day purge (§4).
- **Sync stream `household_photos`:** the household's rows with `deleted_at IS NULL`, mirroring the select policy narrowed like `household_imports` (rule 6).
- **Upload (`/api/upload`):**
  - `photos` joins the allowed tables.
  - A put accepts `household_id`, `kind`, `import_id`, `position`, `recipe_id`, `media_type`, `bytes`, `width`, `height` and `deleted_at`.
  - A patch accepts `recipe_id`, `position` and `deleted_at`.
  - `uploaded_at` is written only by the file endpoint.
  - A repeated put does not change an existing row, as for imports.

### `imports` changes

- `source_type` allows `photo`. A photo import has no `source_text` or `source_url`; its pages are the `photos` rows with its `import_id`.
- `error` allows `photo_unreadable` (§5).
- The import put schema gains a `photo` variant.

### `recipes` gains

`photo_id` (uuid, nullable, references `photos`, must belong to the household): the dish photo. It is added to:
- `recipeSchema`, the patch schema and `RECIPE_CLIENT_FIELDS`;
- the sync stream and the local schema.

A page can also serve as the dish photo, in which case `photo_id` points at a `page` row.

## 4. Server (`apps/api/src/photos/`, `apps/api/src/import/`, `apps/api/src/llm/`)

### Photo storage

- **`PhotoStore` interface:** `put(household, id, bytes)`, `open(household, id)` (a stream or null) and `remove(household, id)`.
- **`DiskPhotoStore` implementation** on the volume mounted at `/data/photos`:
  - files are stored at `<household_id>/<id>.jpg`;
  - writes go to a temporary file and are then renamed into place, so a half-written file is never served;
  - the path is built only from UUIDs that have already been validated.
- **Compose:** a named volume `photos`, mounted into the API.
- **Tests:** a temporary directory.

### File endpoints

**`PUT /api/photos/:id`** (body: the JPEG):
- 401 without a valid token.
- 404 when the row isn't visible as the user (unknown, another household, or deleted).
- 403 for a viewer.
- 413 when the body is over 3 MB.
- 415 when the bytes aren't a JPEG. The check reads the SOI marker and the frame header, not the declared type.
- 422 when the JPEG's size differs from the row's `width`/`height`, or is over 4,000 px.
- 204 on success. The file is written, then `uploaded_at` is set as the user.
- Idempotent: a second upload of the same photo replaces the file.

**`GET /api/photos/:id`:**
- Reads the row as the user, so RLS decides who sees it.
- Streams the file as `image/jpeg` with `Cache-Control: private, max-age=31536000, immutable`; a photo id's bytes never change in practice.
- 404 for an unknown photo, another household's photo, or a missing file.
- Viewers can read.

**Purge (`POST /api/trash/purge`)** additionally:
1. Hard-deletes, as the user through `photos_purge`:
   - photos soft-deleted over 30 days ago;
   - photos whose recipe is in expired trash (deleted before the recipes they reference).
2. Deletes the recipes, as now.
3. After commit, removes the deleted photos' files.

A file whose removal fails is logged and left behind; it can no longer be served because its row is gone.

### Parsing a photo import

- **Same endpoint and claim as 4a.** Before claiming, the endpoint checks the import's live pages:
  - 1 to 8 pages, all with `uploaded_at` set; otherwise it answers **409 `photos_pending`** and the kicker retries later;
  - pages are read from the store in `position` order;
  - a file that is missing or no longer a JPEG → `photo_unreadable`.
- **AI call:** the gateway's `callTool` accepts content blocks.
  - The pages are sent as base64 image blocks, each labelled "Page n of N", followed by the household's tags.
  - The system prompt is `parse-recipe-photo.v1.md`.
  - The `record_recipe` tool, strict mode, `tool_choice: auto` and low effort are the same as for text.
- **The prompt says:**
  - the pages are in order and one recipe may continue across them;
  - handwriting, stains, glare and cut-off edges are normal;
  - read amounts exactly as written;
  - put an unreadable value in `low_confidence` rather than guess;
  - if several recipes are visible, take the one that continues across the pages, or else the most complete one, and flag `title`;
  - ignore page numbers, headers and photo captions.
- **Cost:** the cap check and usage tracking from 4a apply unchanged. A 1568 × 1176 page is about 2,500 input tokens (about 0.5¢).
- **Interpreting the result:** unchanged from 4a, through `toImportDraft` and `importDraftSchema` (rule 7).

## 5. Errors

All of 4a's codes still apply. New or changed:

| Code | When | Message on the import | Try again |
|---|---|---|---|
| `photo_unreadable` | A page file is missing or corrupt on the server | Couldn't read the photos | Yes |
| `not_a_recipe` | No recipe in the photos | This doesn't look like a recipe | No |

`photos_pending` is a 409 answer, not a stored error. The import stays `pending`.

## 6. The app (`apps/mobile`)

### Photos module (`src/photos/`)

- **`preparePhoto(file, maxEdge)`** decodes the picked file with `createImageBitmap` (`imageOrientation: 'from-image'`), draws it scaled onto a canvas, and encodes JPEG at quality 0.82. Re-encoding drops EXIF, including location. It returns `{ blob, width, height }`. Files the browser can't decode are refused with "Couldn't open that photo".
- **The queue wrapper** owns PowerSync's `AttachmentQueue` with the IndexedDB adapter. The rest of the app sees only:
  - `savePhoto(row, blob)`: the photos row and the local file in one transaction, queued for upload;
  - `photoUri(id)`: a local object URL when the file is on the phone, otherwise the API URL;
  - `uploadState(ids)`: how many of the given photos are uploaded.
- **Watched for download:** photos that are a live recipe's `photo_id`. Photos waiting for upload stay until uploaded.
- **Page photos opened online** are fetched with the session token and kept in a Cache Storage cache, `photo-pages`.
- **Remote adapter:** `PUT` and `GET /api/photos/:id` with the session token.

### Import screen

- A third tab, **Photo**, next to Paste text and Paste link.
- **Add page** opens a file input with `accept="image/*"`. On iPhone this offers Take Photo or Photo Library.
- Pages show as numbered thumbnails, each with Remove and Move left / Move right. Add page is hidden at 8 pages.
- **Import** writes the import and its page rows, then queues the files.
- **The import list** shows a photo import as "Photo · 3 pages" with a first-page thumbnail. While uploading it shows **"Uploading photos (2 of 3)"**. When another device holds the files, it shows **"Waiting for photos from another device"**.

### Kicker

Unchanged, except a photo import is kicked only once all its pages have `uploaded_at`. A 409 `photos_pending` is treated as "try later" with the usual backoff.

### Review screen

For a photo import:
- the original pages sit on top as thumbnails; tapping one opens it full screen, with pinch-zoom from the browser;
- a **"Use page n as the dish photo"** choice;
- **Save** sets the pages' `recipe_id` (and `photo_id` if chosen) in the same local transaction as the recipe;
- **Discard** soft-deletes the import and its pages.

### Recipe screen and editor

- **The dish photo** shows at the top, full width and about 4:3. Admins and members get **Add photo / Change photo / Remove photo**; viewers get none.
  - Changing or removing soft-deletes the old dish photo, unless it is one of the recipe's pages.
- **Source:** for a photo import, it reads "From photos · 3 pages", with thumbnails that open full screen. Offline and uncached, a page shows "Available when online".

### Recipe list

A 48 px square thumbnail of the dish photo on each row that has one, or nothing on rows without one.

## 7. Testing

### Unit (Vitest)

- **Domain:** the photo import put schema, the photos put and patch schemas, and the recipe `photo_id`.
- **API:**
  - the JPEG check: SOI, frame header, wrong type, truncated file, PNG refused;
  - disk store paths and atomic writes;
  - the photo request builder: order, labels, base64 and the photo prompt;
  - the parse precheck (`photos_pending` or `photo_unreadable`).
- **App:**
  - `preparePhoto` maths: the long edge and aspect ratio;
  - which photos are watched;
  - kicker eligibility for photo imports;
  - upload-state text.

### RLS suite

- `photos` added to the registry, with a seed row per household.
- Another household can't read, insert, update or purge photos.
- A viewer can't insert or update.
- `photo_id`, `import_id` and `recipe_id` must belong to the household.

### API suite (needs the stack in test mode)

- PUT then GET round trip.
- GET of another household's photo: 404.
- PUT by a viewer: 403.
- Oversize: 413. Not a JPEG: 415. Size mismatch: 422.
- Parse with a page not uploaded: 409. After upload: `ready`.
- A missing file: `photo_unreadable`.
- The purge removes rows and files.
- **Fake Claude:** accepts image blocks and picks its reply by a marker in the page bytes. Fixture JPEGs carry the marker in a JPEG comment segment.

### End to end (Playwright, built app, fake Claude)

1. Import → Photo → add 2 fixture pages → reorder → Import → Ready to review → save with page 1 as the dish photo. The recipe shows the dish photo and both originals, and the list shows the thumbnail.
2. Pages added offline → "Uploading photos" waits → back online → Ready to review.
3. Add, change and remove a dish photo on an existing recipe. It shows on a second signed-in household device context offline after sync.
4. A viewer sees no photo controls.
5. Another household's photo URL returns 404 in the browser.

### Eval (manual)

`pnpm eval:import` gains photo samples in `apps/api/eval/samples/photos/`:
- **generated** (created during implementation by rendering text to JPEG): a printed card, a handwriting-style card, and a two-page spread with a slight tilt;
- **real:** the owner may add their own photos (`<name>-1.jpg`, `<name>-2.jpg`, … per recipe), and the eval includes them.

The eval prints each draft, its cost and how long it took, against NFR-6.

## 8. Documentation

- **ADR-0013** "Photo files on a volume behind RLS-checked endpoints":
  - the storage choice and the rejected options;
  - the attachment queue and its experimental status;
  - the offline download policy;
  - the backup requirement.
- **`ARCHITECTURE.md`:**
  - Object Storage becomes the `photos` volume behind the API;
  - the photo-import dynamic diagram is updated;
  - the data model gains `PHOTO`.
- **`docs/SPEC.md`:** FR-7 and FR-15's photo marked built in 4b.
- **`CLAUDE.md`:** the photos volume noted in the stack.

## 9. Acceptance criteria

1. The success criteria in §1 hold on the owner's iPhone with a real key.
2. Lint, typecheck, unit, stack, RLS, API and e2e suites pass locally and in CI, with no real AI calls in CI.
3. The eval's photo samples produce drafts that look right to the owner, each under 30 seconds.
