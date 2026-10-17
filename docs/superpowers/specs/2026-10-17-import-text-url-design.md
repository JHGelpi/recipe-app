# Import from Text and URL — Design

> Status: **Draft for review** · Date: 2026-10-17
> Sub-project 4a of Phase 1 (see `2026-10-12-walking-skeleton-design.md` §1). Photo import, file storage and own photos follow in 4b. Builds on the recipe model (`2026-10-16-recipe-model-design.md`) and search (`2026-10-17-search-design.md`). Requirements: `docs/SPEC.md`. Architecture: `ARCHITECTURE.md`, `docs/adr/`.

## 1. Purpose

Let the owner get a recipe into the app by pasting its text (from Notes, a message or a social media comment) or a link to a recipe page. The server reads it, AI structures it, the owner reviews and saves. Imports made offline wait and are read when the phone is back online.

**Covers:** FR-8 (URL by paste; the share sheet is native-only and not built), FR-9 (pasted text), FR-10 (AI parsing including suggested tags), FR-11 (review screen with low-confidence fields highlighted), FR-12 for text and URL (original kept and viewable), FR-16 (AI tag suggestions), FR-29 (offline imports queued), NFR-3 (no keys on device), NFR-7 (per-household monthly AI cap), NFR-13 (source URL and author kept).

### Success criteria

1. Pasting recipe text and tapping Import produces a draft for review within about 30 seconds when online, with title, ingredients split into quantity / unit / item / note, steps, servings, times and suggested tags filled in.
2. Pasting a link to a recipe page that publishes schema.org Recipe data produces a draft without using AI. Other pages are read by AI from the page text.
3. Fields the AI was unsure of are highlighted on the review screen. Nothing becomes a recipe until Save.
4. A saved recipe shows its source: the link and author, or the original text.
5. An import made offline shows as waiting, and is read automatically once online. Locking the phone or closing the app while it is being read does not lose it; the draft is waiting on return, on any of the household's devices.
6. A household's AI spend stops at the monthly cap ($2.00 by default) with a clear message.
7. Viewers do not see Import, and the server refuses their imports.

### Out of scope

- Photo import, file storage and own photos on recipes (4b, FR-7 and FR-15's photo).
- The OS share sheet (native builds only, ADR-0007).
- Re-parse from the original (FR-13) and the duplicate warning (FR-14), both still *proposed*.
- Purging dismissed or saved import rows (they are small; revisit with the trash purge if needed).
- Changing the cap from inside the app.

## 2. Decisions made during design

| Decision | Choice | Why |
|---|---|---|
| Slicing | Text and URL first (4a); photos next (4b) | Text and URL build the whole AI pipeline without file storage; each slice is a PR the owner can try on the phone. |
| Monthly cap | **$2.00 per household**, configurable (`AI_MONTHLY_CAP_USD`) | The owner's choice. Roughly 60–150 imports; JSON-LD URL imports are free. |
| API key | The owner puts `ANTHROPIC_API_KEY` in the server's `.env` | Tests use a fake Claude; the key is only for real imports and the eval. |
| How imports wait and get parsed | **A synced `imports` table** (option A) | Offline queue for free through the existing upload path; the server finishes a parse even when the phone locks; drafts reach every device. |
| Phone-side queue plus a blocking request (option B) | Rejected | Safari suspends a locked phone mid-request (parses take 10–30 s); drafts stay on one device. |
| Server worker sweeping all households (option C) | Rejected | Needs a role that sees every household, against rule 1. |
| Who starts a parse | The phone, by calling `POST /api/imports/:id/parse`, which runs as the user through `asUser` | Keeps every statement as the user. A claim on the row makes it safe to call twice. |
| URL reading | schema.org Recipe JSON-LD first (no AI), else cleaned page text to AI | ADR-0005; most large recipe sites publish JSON-LD. |
| AI output | A strict tool call (`tool_choice: auto`; the Claude 5.5 models refuse a forced tool), validated by a zod schema in `packages/domain` | Rule 7: never write raw model output. |
| Review | The existing recipe editor, prefilled | One editor to maintain; validation already there. |
| Where the original lives | New columns on `recipes` (`source_url`, `source_author`, `source_text`) | The import row is dismissed after save; the original must stay with the recipe (FR-12). |

## 3. Data (`db/migrations/`, `powersync/sync-config.yaml`)

### `imports` (household table)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | Client-generated. |
| `household_id` | uuid not null | RLS. |
| `source_type` | text not null | `text` or `url`. |
| `source_text` | text | Required for `text`; at most 20,000 characters. |
| `source_url` | text | Required for `url`; http(s), at most 2,000 characters. |
| `status` | text not null default `pending` | `pending`, `parsing`, `ready`, `failed`. |
| `draft` | jsonb | The validated draft when `ready`. |
| `error` | text | An error code (§5) when `failed`. |
| `parse_started_at` | timestamptz | Set when claimed. |
| `recipe_id` | uuid | Set when the draft is saved as a recipe. |
| `created_at`, `updated_at`, `updated_by`, `deleted_at` | | As every tenant table (rule 5). |

Check constraints enforce the source rules and the status values.

- **RLS:** select for the household; insert and update for the household's admins and members (viewers refused, rule 4); no delete (soft delete only).
- **Sync stream `household_imports`:** the household's rows, mirroring the select policy (rule 6).
- **Upload (`/api/upload`):** `imports` joins the allowed tables. A put accepts only `source_type`, `source_text`, `source_url`, `created_at` and `deleted_at`, plus `status` when it is `pending`. A patch accepts only `recipe_id` and `deleted_at`. `status`, `draft`, `error` and `parse_started_at` are written only by the parse endpoint.

### `ai_usage` (household table, server only)

`household_id`, `month` (date, first of the month), `spent_microusd` (bigint), `updated_at`; primary key `(household_id, month)`. RLS: select, insert and update for the household's admins and members (the parse runs as the user). Not synced and not in the upload allow-list, so only the parse code writes it.

### `recipes` gains

`source_url` (text, at most 2,000), `source_author` (text, at most 200), `source_text` (text, at most 20,000), all nullable. Added to `recipeSchema`, the patch schema, the sync stream and the local schema. The editor does not edit them.

## 4. Server (`apps/api/src/import/`, `apps/api/src/llm/`)

### Parse endpoint

`POST /api/imports/:id/parse` (bearer token, as every route):

1. **Claim**, as the user: `update imports set status = 'parsing', parse_started_at = now(), error = null where id = :id and deleted_at is null and (status = 'pending' or (status = 'failed' and error is retryable) or (status = 'parsing' and parse_started_at < now() - interval '5 minutes')) returning *`. RLS limits this to the household's admins and members. No row: `409 {status}` when the row exists and is not claimable, `404` otherwise.
2. Answer `202 {status: 'parsing'}` at once.
3. Continue in the background, still as that user, then write `ready` with `draft`, or `failed` with `error`. The work runs to the end whether or not the phone is still connected. A crash leaves `parsing`, which the 5-minute rule lets the next call reclaim.

`GET /api/imports/usage` returns `{spentUsd, capUsd}` for the caller's household this month.

### URL reader

- Only `http:` and `https:`; at most 2,000 characters.
- **Address check:** the host is resolved and every address checked. Loopback, private (RFC 1918, fc00::/7), link-local, CGNAT, unspecified and multicast ranges are refused as `blocked_address`, and so are IPv4-mapped IPv6 forms of them. The connection is made to the checked address, so DNS cannot change between check and fetch. Each redirect (at most 5) is checked the same way.
- A test-only setting `IMPORT_FETCH_ALLOW_HOSTS` (empty by default, comma-separated host names) lets the test fixture server through. It is documented as test-only.
- 10 s timeout; at most 3 MB read; a browser-like User-Agent; `text/html` only.
- **JSON-LD first:** every `<script type="application/ld+json">`, including `@graph` arrays and lists, is searched for `@type` `Recipe` (a string or an array containing it). Mapping:
  - `name` → title
  - `recipeIngredient` → ingredients through `parseIngredientLine`
  - `recipeInstructions` → steps: strings, `HowToStep.text`, and `HowToSection` items flattened
  - `recipeYield` → servings: the first whole number in a string, number or array
  - `prepTime` and `cookTime` → minutes from ISO 8601 durations
  - `keywords` (comma string or array) and `recipeCategory` → tags, normalised, at most 5
  - `author` → its name (string, object or array)

  No AI, no cost, and no low-confidence fields.
- **Otherwise:** scripts, styles, `nav`, `header`, `footer` and `aside` are removed and the text is collapsed and cut to 30,000 characters, then parsed by AI with the URL as context.

### AI parser

- Prompt in `apps/api/src/llm/prompts/parse-recipe.v1.md` (rule 7: versioned files).
- **Input:** the text, the source URL when there is one, and up to 200 of the household's existing tags (most used first) so suggestions reuse them.
- **Output:** a strict tool call `record_recipe` (asked for by the prompt; effort `low`) with these fields:
  - title, servings, prep and cook minutes
  - ingredients: raw, quantity, quantity_max, unit, item, note, heading
  - steps
  - up to 5 tags
  - author
  - `low_confidence`: field names from `title`, `servings`, `prep_minutes`, `cook_minutes`, `ingredients`, `steps`, `tags`
  - `is_recipe`
- `is_recipe: false` → `not_a_recipe`.
- **Validation:** the output goes through `importDraftSchema` (below).
  - Fixable problems are fixed: an unknown unit becomes null (the raw line stays), tags are trimmed and lowercased, extra tags are dropped, steps are trimmed.
  - Anything else fails as `invalid_output`.
  - Raw output is never written.

### LLM gateway

- The only module that calls Claude, through the official `@anthropic-ai/sdk`.
- **Settings:**
  - model from `LLM_MODEL_PARSE` (default `claude-sonnet-5-5`)
  - `ANTHROPIC_BASE_URL` configurable for tests
  - 60 s timeout
  - one retry on overload, 429 or 5xx
  - output capped (`max_tokens` 8,000)
- **Quota:**
  - Before the call, it refuses with `quota` when this month's spend has reached `AI_MONTHLY_CAP_USD`.
  - After the call, it adds the cost from the reported input and output tokens and the model's prices (`LLM_PRICE_INPUT_PER_MTOK_USD`, `LLM_PRICE_OUTPUT_PER_MTOK_USD`), with an upsert on `ai_usage`.
  - A failed call that reported usage is still recorded.
  - One call can overshoot the cap by at most its own cost.
- **Configuration:** a missing key gives `ai_unavailable` without a call. `AI_MONTHLY_TOKEN_QUOTA_PER_HOUSEHOLD` is replaced by `AI_MONTHLY_CAP_USD=2` in `.env.example`.

### Draft (`packages/domain/src/importDraft.ts`)

```ts
type ImportDraft = {
  title: string;
  servings: number | null;
  prep_minutes: number | null;
  cook_minutes: number | null;
  ingredients: { raw: string; quantity: number | null; quantity_max: number | null;
                 unit: Unit | null; item: string; note: string | null; heading: boolean }[];
  steps: string[];
  tags: string[];
  author: string | null;
  low_confidence: DraftField[];
};
importDraftSchema            // zod, with the limits of recipeSchema
draftToRecipeFields(draft, newId): recipe fields with generated ingredient and step ids
```

## 5. Errors

| Code | When | Message on the import | Try again |
|---|---|---|---|
| `quota` | The month's spend has reached the cap | Over this month's AI limit ($2.00) | Next month (a parse is claimable again once the month changes) |
| `ai_unavailable` | Timeout, overload, 5xx, missing key, or any unexpected server error (logged) | Couldn't reach the AI service | Yes |
| `fetch_failed` | Page blocked, unreachable, not HTML or too large | Couldn't open that page. Try pasting the recipe text instead. | Yes |
| `blocked_address` | A private or local address | That link can't be imported | No |
| `not_a_recipe` | No recipe found | This doesn't look like a recipe | No |
| `invalid_output` | The model's output failed validation | Couldn't read this recipe | Yes |

Retryable: `quota` (once the month has changed), `ai_unavailable`, `fetch_failed`, `invalid_output`.

## 6. The app (`apps/mobile`)

- **Recipes list:** an **Import** button next to Add recipe, hidden for viewers, with a badge "N ready" when drafts are waiting.
- **Import screen** (`/import`):
  - **Paste text / Paste link** tabs. Import is disabled until there is input; a link must start with http:// or https://.
  - Tapping Import writes a `pending` row locally. When offline, it says "Saved. It'll be read when you're back online."
  - **AI this month:** "$0.42 of $2.00" from `/api/imports/usage`, "–" when offline.
  - **Imports list**, newest first, each row showing its first line or URL:
    - **Waiting to go online** while not uploaded or offline
    - **Reading…** while pending or parsing
    - **Ready to review**, which opens review
    - **Failed**, with the message from §5, **Try again** when retryable and **Dismiss**
- **The kicker** (`src/imports/`) runs while signed in as an admin or member. When online, for each of the household's imports, it calls `/parse` in these cases:
  - the import is `pending` and has been uploaded (not in the upload queue)
  - it is `parsing` with `parse_started_at` over 5 minutes old

  It backs off on failure (5 s, doubling, at most 5 minutes) and never calls twice at once for the same row. Try again calls `/parse` directly. The decisions are pure functions with unit tests.
- **Review screen** (`/import/[id]`):
  - The original sits on top: "Original text ▸" collapsible, or the link.
  - Below it is `RecipeEditor` prefilled from `draftToRecipeFields`. Each field in `low_confidence` has an amber outline and "Check this" until edited.
  - Suggested tags arrive as removable tags.
  - **Save** writes the recipe with `source_url`, `source_author` and `source_text`, sets the import's `recipe_id` and soft-deletes the import in one local transaction, then opens the recipe.
  - **Discard** soft-deletes the import.
  - An import that is no longer ready (dismissed on another device) shows "This import is no longer available".
- **Recipe screen:** a **Source** section when the recipe has one: "From example.com · by Jane Doe" with the link, or "Original text ▸" collapsible.

## 7. Testing

### Unit (Vitest)

- **Domain:**
  - `importDraftSchema` fix-ups and refusals
  - `draftToRecipeFields` (ids generated, valid against `recipeSchema`)
  - JSON-LD mapping: `@graph`, `@type` arrays, HowToSection, yields as string, number or array, ISO durations, author as string, object or array, keywords as string or array
- **API:**
  - address checks (IPv4 and IPv6 private ranges, mapped addresses, a host resolving to loopback, a redirect to a private address)
  - HTML cleaning and truncation
  - cost arithmetic and the cap check
  - error mapping from SDK errors
  - the claim rules
- **App:** kicker decisions and backoff, status text, low-confidence state clearing on edit.

### RLS suite

- `imports` and `ai_usage` added to the registry.
- Another household cannot read, claim or update imports.
- A viewer cannot create or claim.
- Usage rows are household-scoped.

### API suite (needs the stack)

- A **fake Claude**: a small HTTP server started by the test setup, with `ANTHROPIC_BASE_URL` pointed at it. It returns canned tool calls, errors, or a non-recipe answer.
- **Tests:**
  - text parse to `ready`
  - quota refusal
  - a second claim answers 409
  - stale `parsing` reclaimed
  - `invalid_output`
  - upload refuses server-owned fields
  - a URL import with JSON-LD from a fixture page server (no AI call)
  - a URL without JSON-LD through the fake Claude
  - `blocked_address` for a private address

### End to end (Playwright, against the built app, with the fake Claude and fixture pages)

1. Paste text → Reading… → Ready to review → a flagged field is highlighted → Save → the recipe shows its original text.
2. A link to a JSON-LD fixture page → review → Save → the recipe shows the link and author.
3. Import offline → Waiting to go online → back online → Ready to review.
4. A viewer sees no Import button.
5. A failure (fake Claude errors) → Try again → ready.

### Eval (manual)

`pnpm eval:import` runs about 6 real samples (a blog page, a social media comment, a messy note, a two-column card's text, a non-recipe) through the real parser with the owner's key, and prints the drafts and the cost. It is not run in CI (ADR-0005).

## 8. Documentation

- **ADR-0012** "Imports as a synced queue with server-side parsing": option A, the claim, fetch safety, the cost cap, and the fake Claude for tests.
- `ARCHITECTURE.md`: the import orchestrator, URL extractor, AI parser and LLM gateway become real; the Import Queue component is the `imports` table; the quota store is `ai_usage`.
- `docs/SPEC.md`: FR-7 noted as following in 4b; NFR-7's cap recorded as $2.00 per household per month (configurable); open question 3 updated.
- `.env.example`: `AI_MONTHLY_CAP_USD`, the price settings and `ANTHROPIC_BASE_URL`; `IMPORT_FETCH_ALLOW_HOSTS` marked test-only.

## 9. Acceptance criteria

1. The success criteria in §1 hold on the owner's iPhone with a real key.
2. Lint, typecheck, unit, stack, RLS, API and e2e suites pass locally and in CI, with no real AI calls in CI.
3. The eval runs with the owner's key, and its drafts look right to the owner.
