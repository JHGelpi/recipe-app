# Sharing Out — Design

> Status: **Draft for review** · Date: 2026-10-17
> Sub-project 7 of Phase 1 (see `2026-10-12-walking-skeleton-design.md` §1). Builds on the recipe model, dish photos and the photo store (ADR-0013), cook-mode formatting (`packages/domain/src/cooking.ts`), and the household definer-function pattern (ADR-0015). Requirements: `docs/SPEC.md`. Architecture: `ARCHITECTURE.md`, `docs/adr/`.

## 1. Purpose

Let anyone in a household send a recipe to someone else, in three ways:
- **Text:** readable plain text through the share sheet.
- **PDF:** a tidy PDF file through the share sheet.
- **Link:** the recipient sees the recipe and can save their own copy into their own household. People without an account see the recipe and are prompted to sign up to save it.

**Covers:**
- FR-26: share as a formatted PDF or plain text through the share sheet;
- FR-27: share an import link, which the recipient saves into their own household, with a sign-up prompt;
- NFR-2: a link exposes only the shared snapshot.

### Success criteria

1. On the iPhone, any recipe's **Share** opens **Text**, **PDF** and **Link**. Text and PDF work offline and open the share sheet; PDF attaches "<Title>.pdf".
2. **Link** opens the share sheet with a link. Opened on any device, signed out, it shows the recipe as it was when shared, including the dish photo.
3. **Save to my recipes** on a shared page, after signing in or up, adds an independent copy to the recipient's household, labelled "Shared by the <household name>".
4. **Stop sharing** on the recipe ends every link to it at once. A recipe moved to the Trash stops its links until it is restored.
5. A link reveals nothing but its snapshot: no other recipe, no live data, nothing about the household beyond its name.
6. Viewers can share in every way, but cannot save a shared recipe into their household.

### Out of scope

- Sharing to a specific person inside the app, or notifications.
- Editing what a link shows after sharing (share again instead).
- Sharing several recipes at once, or a whole collection.
- Link analytics (who opened it).
- A server-made PDF.
- Scaled or converted amounts in shared copies (always as written).

## 2. Decisions made during design

| Decision | Choice | Why |
|---|---|---|
| A link opened signed out | **Shows the full snapshot**, with Save prompting sign-in or sign-up | The owner's choice. Works for recipients who never install the app; only the snapshot is exposed (NFR-2). |
| Link lifetime | **Until stopped**: Stop sharing ends all of a recipe's links; the Trash pauses them | The owner's choice. Bookmarked links keep working; a mistake can be undone. |
| PDF | **Made on the phone with jsPDF**, loaded on first use, with an embedded font that has the kitchen fractions | The owner's choice. Works offline and opens the share sheet with a real file; costs the app nothing until used. |
| What a link shows | **A snapshot** taken when shared, including a copy of the dish photo file | NFR-2 and ARCHITECTURE: later edits and deletions of the live recipe never leak, and the copy stays readable. |
| Reading a link without an account | **One definer function, `read_share(code)`**, called as an anonymous user (claims `{}`) | Every normal policy still denies everything; only this function returns a single snapshot by its code's hash (ADR-0016). |
| Saving a copy | **A definer function, `save_share(code)`**, called as the signed-in user | The user cannot read the snapshot through RLS (it is another household's row), so the copy is made inside the database (ADR-0016). |
| Who may share | Everyone, viewers too | SPEC §2: viewers "share recipes out". |
| Who may stop sharing | Admins and members | It changes household data (rule 4). |

## 3. Data (`db/migrations/`, `powersync/sync-config.yaml`)

### `shares` (household table)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | Generated on the server. |
| `household_id` | uuid not null | RLS. |
| `recipe_id` | uuid not null | Composite FK `(recipe_id, household_id)` → recipes, `on delete cascade` (only the 30-day purge hard-deletes recipes). |
| `token_hash` | bytea not null, unique | sha256 of the link's code. |
| `snapshot` | jsonb not null | See §3.1. |
| `photo_copy` | boolean not null default false | True when a copy of the dish photo was stored under the share's id. |
| `created_at`, `updated_at`, `updated_by`, `deleted_at` | | `deleted_at` means stopped. |

- **Reading rows:** select for the household.
- **Writing:** no insert or delete grant. Only `create_share`, `stop_shares` and the purge write it.
- **Updating:** update only through `stop_shares`.
- **Sync stream `household_shares`:** `id`, `household_id`, `recipe_id`, `created_at`, `deleted_at` for the household's live shares. It is a subset of `shares_select`'s rows and columns; the snapshot and hash never sync.

### 3.1 The snapshot (`packages/domain/src/sharing.ts`, `shareSnapshotSchema`)

`{ title, servings, prep_minutes, cook_minutes, ingredients, steps, tags, notes, source_url, source_author, household_name, shared_at }`

- **Shape:** the same field rules as `recipeSchema`, plus `household_name` (at most 200 characters) and `shared_at` (ISO).
- **Validation:** snapshots are validated on the way in, in `create_share`'s caller, and on the way out, when the page reads them.

## 4. Database functions (ADR-0016; `SECURITY DEFINER`, owner `app_owner`, `search_path = ''`)

### `create_share(share_id uuid, recipe uuid, snapshot jsonb, photo boolean)` → `(id, token)`

- **Who:** any member of the recipe's household, viewers included. The recipe must be live, and in the caller's household (live membership).
- **The code:** generated like an invite's (32 random bytes, base64url); only its hash is stored.
- **The API** builds and validates the snapshot as the user, then calls this.

### `stop_shares(recipe uuid)` → `int`

- **Who:** admins and members of the recipe's household.
- **What it does:** sets `deleted_at` on every live share of that recipe and returns how many.

### `read_share(code text)` → `(status, snapshot, share_id, household_id, photo_copy)`

- **Status `ok`** only when:
  - the share exists and isn't stopped;
  - its recipe is live (not in the Trash);
  - its household is open.
- **Otherwise** `stopped`, `trashed` or `unknown`, with no snapshot.
- **Who may call it:** execute is granted to `authenticated`. The API calls it with empty claims for signed-out visitors.

### `save_share(code text)` → `(recipe_id, photo_id, source_household uuid, share_id uuid)`

- **Who:** the caller (live membership) must be an admin or member. The share must read as `ok`, and must belong to another household (`own_household` otherwise).
- **The recipe:** inserts a new recipe in the caller's household from the snapshot:
  - new ids for the recipe, its ingredients and its steps;
  - `source_url` set to the snapshot's source URL;
  - `source_author` set to the snapshot's author, or `null`;
  - `source_text` set to `"Shared by the <household_name>"`.
- **The photo:** when `photo_copy` is true, it inserts a `dish` photo row (`uploaded_at` set) in the caller's household and sets the recipe's `photo_id`.
- **Returns** what the API needs to copy the photo file.
- **Refusals:** `forbidden`, `share_unavailable`, `own_household`.

## 5. Server (`apps/api/src/sharing/`)

| Endpoint | Auth | Answers |
|---|---|---|
| `POST /api/shares` `{ recipe_id }` | user | 201 `{ code }`; 404 for a recipe not visible or in the Trash |
| `POST /api/shares/stop` `{ recipe_id }` | user | 200 `{ stopped }`; 403 for viewers |
| `GET /api/shares/:code` | **none** | 200 `{ snapshot, has_photo }`; 404 `{ status }` for stopped, trashed or unknown; `Cache-Control: no-store` |
| `GET /api/shares/:code/photo` | **none** | the copied JPEG, or 404; `no-store` |
| `POST /api/shares/:code/save` | user | 201 `{ recipe_id }`; 403 `forbidden`; 404 `share_unavailable`; 409 `own_household` |

**Creating a share:**
1. Reads the recipe as the user (RLS), plus the household name.
2. Builds the snapshot with `buildShareSnapshot` (domain) and validates it.
3. Calls `create_share`.
4. If the recipe has a dish photo whose file exists, copies the file to `photos/<household>/<share id>.jpg` and passes `photo = true`.

The copy happens before the call, so the API generates the share id itself and passes it as `create_share`'s first argument.

**Reading a share, signed out:**
- Unauthenticated reads use a new `asAnonymous(fn)`: `asClaims({}, fn)`, the authenticated role with no claims, so every RLS policy denies.
- CLAUDE.md rule 1 gains this, limited to the ADR-0016 functions.

**Saving:** `save_share` runs, then the photo file is copied from `<source_household>/<share_id>.jpg` to `<caller household>/<photo_id>.jpg`.

**Purge:** stopped shares older than 30 days, and the shares of recipes being purged, are deleted together with their photo copies. The purge's delete runs through a definer function, `purge_shares()`, for the caller's household's admins and members.

## 6. The app (`apps/mobile`)

### Share menu

On the recipe screen, a **Share** button for every role, offering **Text**, **PDF** and **Link**.

**Text:**
- builds the text from the recipe as written, with `shareText(recipe)` in `packages/domain/src/sharing.ts`;
- opens `navigator.share({ title, text })`, or copies it with "Copied";
- works offline.

**PDF:**
- dynamic-imports `src/sharing/pdf.ts` (jsPDF plus an embedded Noto Sans subset with ½ ⅓ ⅔ ¼ ¾ ⅛ ⅜ ⅝ ⅞ – ° •);
- builds `<Title>.pdf` in Letter size with:
  - the title, and the dish photo (from the phone's copy, if available);
  - the servings and times line;
  - the ingredients (two columns above 12 lines), numbered steps, the notes and the source;
  - the footer "Shared from Recipes".
- shares it with `navigator.share({ files: [file] })`, or downloads it where file sharing isn't supported;
- works offline.

**Link:**
- online only; while offline it says "Sharing a link needs a connection";
- waits up to 30 s for this phone's queued uploads, then calls `POST /api/shares`;
- shares `"<Title>: <origin>/s/<code>"`;
- shows the link as text too, labelled "Share link", for copying.

### Stopping

When the recipe has live shares (from the synced `shares` rows), admins and members see **"Shared links: N · Stop sharing"**.
- It asks first: "Stop sharing <title>? Anyone with a link will no longer see it."
- It needs a connection.

### Shared page (`/s/[code]`)

Not wrapped in sign-in.

**What it shows:**
- the snapshot (title, dish photo, servings and times, ingredients, steps, notes, source);
- "Shared from the <household name>";
- **Save to my recipes**.

**Save to my recipes:**
- **Signed out:** stores the code, then goes to sign-in, whose subtitle reads "Sign in or create an account to save <title>". After sign-in it returns to `/s/<code>`.
- **A viewer:** "Viewers can't add recipes. Ask an admin of your household."
- **An admin or member:** calls save, then lands on the new recipe with "Saved to your recipes".
- **Own household:** "This recipe is already in your household", with no Save button.

**Problems:**
- stopped, trashed or unknown: "This recipe is no longer shared";
- offline: "Opening a shared recipe needs a connection".

## 7. Testing

- **Unit:**
  - **Domain:** `shareText` (sections, fractions, an empty recipe, source lines), `buildShareSnapshot`, `shareSnapshotSchema`, and the save mapping (new ids, the source line).
  - **App:** the PDF builder (page count and the text present, by parsing the generated PDF's text with jsPDF's output in tests), the share menu decisions, and the shared-page states.
  - **API:** the routes' answers with a fake service, and `asAnonymous` setting empty claims.
- **RLS and function suite** (registry gains `shares`):
  - `read_share`:
    - returns only the snapshot;
    - returns nothing for a stopped share, a trashed recipe or a wrong code;
    - works with empty claims.
  - Another household can't read shares, stop them, or create them for a recipe it can't see.
  - Viewers:
    - may create;
    - may not stop;
    - `save_share` refuses viewers and the share's own household.
  - Saving: `save_share` puts the copy only in the caller's household, with fresh ingredient and step ids.
  - Grants: the exact grants test is updated.
- **API suite:**
  - create, then read without a token (200, no-store);
  - stop, then read (404);
  - trash, then read (404);
  - restore, then read (200);
  - save, which copies the photo (the new photo's GET works);
  - a viewer's save (403).
- **End to end:**
  1. Share as text: the text is copied, since Chromium has no share sheet.
  2. Share as a PDF: the download named "<Title>.pdf".
  3. A link opened in a signed-out browser shows the recipe; then Save, sign in, and the copy appears with "Shared by the …".
  4. Stop sharing, after which the link shows "This recipe is no longer shared".
  5. A viewer can create a link but sees the viewer message on Save.
  6. A link to a trashed recipe.

## 8. Documentation

- **ADR-0016** "Shared recipe snapshots, read anonymously through a definer function":
  - the snapshot model;
  - `create_share`, `stop_shares`, `read_share`, `save_share` and `purge_shares`;
  - `asAnonymous`, and why no other code may use empty claims;
  - jsPDF on the phone.
- **`CLAUDE.md`:** rule 1 lists the ADR-0016 functions and `asAnonymous`.
- **`ARCHITECTURE.md`:** the share landing page, the Sharing component and the `SHARE` entity.
- **`docs/SPEC.md`:** FR-26 and FR-27 noted as built.

## 9. Acceptance criteria

1. The success criteria in §1 hold on the owner's iPhone, with the link opened on a second device that is not signed in.
2. Lint, typecheck, unit, stack, RLS, API and e2e suites pass locally and in CI.
3. The app's first-load size does not grow by more than 20 KB. The PDF code loads only when a PDF is made.
