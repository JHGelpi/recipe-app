# Import the dish photo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A URL or photo import saves with its dish picture as the recipe's dish photo (#116).

**Architecture:** The draft carries an optional `image`: a URL (from JSON-LD `image` or `og:image`) or a page plus a normalized box (from Claude). The app turns it into a `PhotoFile` while the review screen is open: URL images come through a new `GET /api/imports/:id/image` (server fetches with the SSRF guard), and page boxes are cropped from the local page. On save, that file becomes the dish photo through the existing `setDishPhoto`.

**Tech Stack:** zod (domain), Hono + node http (API), Expo web + PowerSync (app), vitest, the fake AI in `test-support/fake-ai`.

**Spec:** `docs/superpowers/specs/2026-11-22-import-dish-photo-design.md`

## Global Constraints
- AI output is untrusted: `image` is validated in `toImportDraft`; an invalid image is dropped, and the draft is never refused because of it.
- The image endpoint fetches only the URL stored on the import's draft; it never takes a URL from the client.
- Accepted image types: `image/jpeg`, `image/png`, `image/webp`, `image/gif`, `image/avif` (never SVG). Size limit `FETCH_DEFAULTS.maxBytes` (3 MB).
- Box: `[x0, y0, x1, y1]`, each 0..1, with `x1 - x0 >= 0.05` and `y1 - y0 >= 0.05`. `page` is 1-based (it matches the "Page N of M" labels).
- No new dependencies. Dish photos use `DISH_EDGE` and `preparePhoto`.
- A failure to get the picture never blocks or fails the save.
- Drafts leave `image` out when there is none (never `image: null`): app builds from before this change read drafts with a strict schema, so a stray key would make every draft unreadable there until they update.
- Commits: Conventional Commits, referencing FR-7 / FR-15 and #116.

## Review Focus
1. An image URL that redirects to a private address → blocked like page fetches (covered by reusing `fetchPage`'s hop loop; Task 2 test).
2. A site that serves `image/svg+xml` or `text/html` as the "image" → refused, so the API never serves script content (Task 2 test).
3. Claude returns a box on page 3 of a 2-page import → the image is dropped and the draft is kept (Task 3 test).
4. A relative JSON-LD image (`/img/dish.jpg`) → resolved against the final page URL; `data:` or `javascript:` → dropped (Task 3 test).
5. The reviewer ticks a page as the dish photo while an imported picture also exists → the ticked page wins and no second dish photo is written (Task 5 test on the pure `dishPhotoChoice`).

---

### Task 1: Domain — the draft's image and the crop rectangle

**Files:**
- Modify: `packages/domain/src/importDraft.ts`, `packages/domain/src/photos.ts`, `packages/domain/src/jsonLd.ts`
- Test: `packages/domain/src/importDraft.test.ts`, `packages/domain/src/photos.test.ts`, `packages/domain/src/jsonLd.test.ts`

**Interfaces:**
- Produces: `type DishBox = [number, number, number, number]`; `type DraftImage = { url: string } | { page: number; box: DishBox }`; `importDraftSchema.image: DraftImage | null | undefined` (optional, like `nutrition`); `toImportDraft` reads `input.image`; `cropRect(width: number, height: number, box: DishBox): { x: number; y: number; width: number; height: number }` (integer pixels, at least 1×1, inside the image); `recipeImage(blocks: unknown[]): string | null` (the raw first image string of the Recipe: a string, `{url}`, or the first of a list of either).

- [ ] **Step 1: Write failing tests**
  - `toImportDraft({...valid, image: {page: 1, box: [0.1, 0.2, 0.6, 0.7]}}).image` equals that object; `image: {url: 'https://x.test/a.jpg'}` kept; `image: {url: 'javascript:alert(1)'}`, `{page: 0, box: …}`, `{page: 1, box: [0.5, 0, 0.52, 1]}` (too narrow), `{page: 1, box: [0.6, 0, 0.1, 1]}` (reversed) each give a non-null draft with no `image` key.
  - `cropRect(1000, 2000, [0.1, 0.25, 0.6, 0.75])` → `{x: 100, y: 500, width: 500, height: 1000}`; `cropRect(10, 10, [0, 0, 1, 1])` → `{x: 0, y: 0, width: 10, height: 10}`.
  - `recipeImage` with `image: "https://a/b.jpg"`, `image: {"@type": "ImageObject", url: "https://a/c.jpg"}`, `image: [{url: "/rel.jpg"}, "https://a/d.jpg"]` → `"https://a/b.jpg"`, `"https://a/c.jpg"`, `"/rel.jpg"`; no image → `null`.
- [ ] **Step 2: Run** `pnpm vitest run packages/domain` → the new tests FAIL.
- [ ] **Step 3: Implement.** URL check uses the existing `isHttpUrl`, max 2000 chars. The `toImportDraft` image goes through `draftImageSchema.safeParse`; failure → the key is left out. `cropRect` rounds and clamps.
- [ ] **Step 4: Run** `pnpm vitest run packages/domain` → PASS.
- [ ] **Step 5: Commit** `feat(domain): dish image on the import draft (FR-15, #116)`.

### Task 2: API — fetch an image and read og:image

**Files:**
- Modify: `apps/api/src/import/fetchPage.ts`, `apps/api/src/import/html.ts`
- Test: `apps/api/src/import/fetchPage.test.ts`, `apps/api/src/import/html.test.ts`

**Interfaces:**
- Produces: `fetchImage(input: string, options: FetchOptions): Promise<ImageResult>` with `ImageResult = { ok: true; bytes: Uint8Array; type: string } | { ok: false; error: 'fetch_failed' | 'blocked_address' }`; `metaImage(html: string): string | null` (`<meta property="og:image" content="…">` in either attribute order; entities decoded).

- [ ] **Step 1: Write failing tests** in the existing local-server suite: `/img` (jpeg, `image/jpeg`) → ok with the same bytes and type `image/jpeg`; `/svg` (`image/svg+xml`) → `fetch_failed`; `/page` (HTML) → `fetch_failed`; an image over `maxBytes` → `fetch_failed`; a redirect to a blocked address → `blocked_address`. `metaImage` on both attribute orders and on `&amp;` in the URL; no tag → null.
- [ ] **Step 2: Run** `pnpm vitest run apps/api/src/import` → FAIL.
- [ ] **Step 3: Implement.** `requestOnce` takes the accepted type (Accept header and content-type regex) and returns raw bytes plus the type; `fetchPage` decodes them with `decodePage` as now. Both share the hop loop. `type` is the bare media type, lower case.
- [ ] **Step 4: Run** the same → PASS, existing fetchPage tests included.
- [ ] **Step 5: Commit** `feat(api): fetch a recipe's image behind the address guard (#116)`.

### Task 3: API — the parse sets the draft's image

**Files:**
- Modify: `apps/api/src/llm/parseRecipe.ts`, `apps/api/src/llm/parsePhoto.ts`, `apps/api/src/import/process.ts`, `test-support/fake-ai/server.mjs`, `test-support/fake-ai/pages/jsonld.html`
- Create: `apps/api/src/llm/prompts/parse-recipe-photo.v3.md` (v2 plus: "If a page shows a photo of the finished dish, set `image` to its page number and box [x0, y0, x1, y1] as fractions of that page's width and height; otherwise null. Never box text, logos or step photos.")
- Test: `apps/api/src/import/process.test.ts`, `apps/api/src/llm/parsePhoto.test.ts`

**Interfaces:**
- Consumes: Task 1 (`recipeImage`, `DraftImage`), Task 2 (`metaImage`).
- Produces: `RECORD_PHOTO_RECIPE_TOOL` (`record_recipe` plus required `image: {page: integer, box: number[4]} | null`); `PHOTO_PROMPT_VERSION = 'parse-recipe-photo.v3'`; drafts with `image` set by source type: photo → the model's image if `page <= pages.length`, else null; url → `{url}` from `recipeImage(blocks) ?? metaImage(html)` resolved with `new URL(raw, page.url)` and kept only if http(s); text → null.

- [ ] **Step 1: Write failing tests** in `process.test.ts`: a photo import whose fake answer has `image: {page: 2, box}` with 2 pages keeps it; with `page: 3` the draft has no `image`, still ready; a JSON-LD page with `"image": "/img/dish.jpg"` at `https://site.test/r/1` gives `{url: 'https://site.test/img/dish.jpg'}`; a page without JSON-LD but with `og:image` gives that URL on the AI draft; `og:image` `data:…` → no image; a text import whose model output includes an image → no image. `parsePhoto.test.ts`: the request's tool is `RECORD_PHOTO_RECIPE_TOOL`.
- [ ] **Step 2: Run** `pnpm vitest run apps/api/src` → FAIL.
- [ ] **Step 3: Implement.** `buildPhotoRequest` returns the tool with the request (`ParseRequest` gains `tool: Anthropic.Tool`; `buildParseRequest` returns `RECORD_RECIPE_TOOL`), and `process.ts` passes `request.tool` to `callTool`. In the fake AI, the marker `FAKE_DISH` in the text adds `image: {page: 1, box: [0.1, 0.1, 0.6, 0.5]}`; otherwise `image: null`. It also serves `/pages/dish.jpg` (copy a small JPEG from `test-support/photos/`), and `jsonld.html` gains `"image": "http://fake-ai:4010/pages/dish.jpg"`. Update any API/e2e expectation that compares the whole JSON-LD draft.
- [ ] **Step 4: Run** `pnpm vitest run apps/api/src` and `pnpm typecheck` → PASS.
- [ ] **Step 5: Commit** `feat(import): find the dish picture in pages and screenshots (FR-7, #116)`.

### Task 4: API — `GET /api/imports/:id/image`

**Files:**
- Modify: `apps/api/src/import/store.ts`, `apps/api/src/import/service.ts`, `apps/api/src/app.ts`, `apps/api/src/server.ts`
- Test: `apps/api/src/import/service.test.ts`, `apps/api/tests/imports/imports.test.ts`

**Interfaces:**
- Consumes: Task 2 `fetchImage`.
- Produces: `ImportStore.imageUrl(claims, id): Promise<string | null>` (selects `draft #>> '{image,url}'` from a live, ready import, as the user); `ImportService.image(token, id): Promise<{ kind: 'ok'; bytes: Uint8Array; type: string } | { kind: 'missing' | 'forbidden' | 'failed' }>`; `ProcessDeps`/service deps gain `fetchImage: (url: string) => Promise<ImageResult>`. Route: 401 without a token; 404 for a bad id or no image URL; 403 for a viewer; 429 over `userLimits.photos`; 502 when the fetch fails; 200 with the bytes, `Content-Type` set to the fetched type, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`.

- [ ] **Step 1: Write failing tests.** Service (fake store/fetch): a viewer → `forbidden`; no URL → `missing`; a fetch failure → `failed`; ok passes through bytes and type. Stack test (fake AI): import `http://fake-ai:4010/pages/jsonld.html`, wait ready, `GET /api/imports/:id/image` → 200 `image/jpeg`; another household → 404; a text import → 404.
- [ ] **Step 2: Run** `pnpm vitest run apps/api/src/import/service.test.ts` → FAIL.
- [ ] **Step 3: Implement**, following the `/api/imports/:id/parse` route's shape. Wire `fetchImage` in `server.ts` with the same options as `fetchPage`.
- [ ] **Step 4: Run** the unit tests → PASS. Then `pnpm dev:backend:test`, `pnpm db:reset`, `pnpm test:api` → PASS.
- [ ] **Step 5: Commit** `feat(api): serve an import's dish image to the app (FR-15, #116)`.

### Task 5: App — use the imported picture on save

**Files:**
- Modify: `apps/mobile/src/photos/prepare.ts`, `apps/mobile/src/imports/api.ts`, `apps/mobile/src/imports/review.ts`, `apps/mobile/src/screens/ReviewImportScreen.tsx`
- Create: `apps/mobile/src/imports/useImportedPhoto.ts`
- Test: `apps/mobile/src/imports/api.test.ts`, `apps/mobile/src/imports/review.test.ts`, `e2e/import.spec.ts`

**Interfaces:**
- Consumes: Task 1 `cropRect`, `DraftImage`; Task 4 route.
- Produces: `preparePhoto(file: Blob, maxEdge: number, box?: DishBox): Promise<PhotoFile>`; `fetchImportImage(id: string, deps: ApiDeps): Promise<Blob | null>` (never throws); `useImportedPhoto(record: ImportRecord, pages: {id: string}[]): { state: 'none' | 'loading' | 'ready' | 'failed'; file: PhotoFile | null }` (URL: `withSession(fetchImportImage)` then `preparePhoto(blob, DISH_EDGE)`; page: `usePhotoUri(pages[page - 1].id)`, then `fetch(uri).blob()` and `preparePhoto(blob, DISH_EDGE, box)`); `dishPhotoChoice(dishPage: string | null, imported: PhotoFile | null): { pageId: string } | { file: PhotoFile } | null` in `review.ts`.

- [ ] **Step 1: Write failing tests.** `fetchImportImage`: 200 → a blob; 404, 502 and a thrown fetch → null; it calls `${apiUrl}/imports/<id>/image` with the bearer token. `dishPhotoChoice('p1', file)` → `{pageId: 'p1'}`; `(null, file)` → `{file}`; `(null, null)` → null. In e2e (`import.spec.ts`), the JSON-LD fixture import, reviewed and saved, shows a dish photo on the recipe screen.
- [ ] **Step 2: Run** `pnpm vitest run apps/mobile` → FAIL.
- [ ] **Step 3: Implement.** In `ReviewImportScreen`, pass `dishPage` to `saveImportedRecipe` as now. When the choice is `{file}`, call `setDishPhoto(db, photoSaver(db), claims, recipeId, file)` after the save; if it throws, log and still navigate. When `state === 'failed'`, show `<Text variant="small">Couldn't get the dish photo. You can add one after saving.</Text>` under the source.
- [ ] **Step 4: Run** `pnpm vitest run apps/mobile`, `pnpm lint && pnpm typecheck` → PASS; `pnpm test:e2e` → the import specs PASS.
- [ ] **Step 5: Commit** `feat(import): save the imported picture as the dish photo (FR-15, #116)`.

### Task 6: Docs

**Files:** `docs/SPEC.md` (FR-7 and FR-15 rows: "the dish picture of a page or screenshot is kept as the dish photo, #116"), `ARCHITECTURE.md` (the image route next to the other import routes, if routes are listed), the release notes used by `packages/domain/src/releaseNotes.ts` / `RELEASE_NOTES.md` (follow the existing entry style).

- [ ] **Step 1:** Edit those files; run `pnpm vitest run packages/domain/src/releaseNotes.test.ts` → PASS.
- [ ] **Step 2: Commit** `docs: dish photo from imports (FR-7, FR-15, #116)`.
