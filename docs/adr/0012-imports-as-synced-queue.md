# 0012. Imports as a synced queue with server-side parsing

- **Status:** Accepted
- **Date:** 2026-10-17

## Context
Imports from pasted text and links (FR-8, FR-9) must survive being made offline (FR-29), locking the phone mid-parse, and switching devices. Parsing needs Claude, which only the server may call (NFR-3), within a per-household monthly cap (NFR-7). The server fetches pages on a user's behalf, so a pasted link must not be able to reach the server's own network.

## Decision
- **An `imports` table is the queue.** It is a household table with RLS and a sync stream. The phone writes the source locally; PowerSync uploads it; the phone then calls `POST /api/imports/:id/parse`.
- **The endpoint claims, then parses in the background.** It claims the row as the user: pending, a retryable failure, or a `parsing` row older than 5 minutes (longer than the slowest parse, so a live parse is never claimed and billed twice). It answers 202, parses in the background, and writes `ready` with a draft or `failed` with an error code.
- **Server-owned fields.** Only the parse endpoint writes `status`, `draft` and `error`; the upload handler accepts only the source and dismissal.
- **Background work runs on verified claims.** It goes through `asClaims`: the claims `asUser` verified when the request arrived, with the same role and RLS. A token expiring mid-parse loses nothing.
- **Reading a link.** schema.org Recipe JSON-LD is read without AI. Otherwise the page text goes to Claude through one gateway, with a versioned prompt and a strict tool under `tool_choice: auto` (the Claude 5.5 models refuse a forced tool with a 400), at effort `low`. The output is validated by `importDraftSchema` (rule 7).
- **Fetch safety.** Every resolved address is checked, before connecting and on every redirect, and refused unless public. The socket connects to the checked address.
- **The cap.** Spend is recorded per household per month in `ai_usage`, written only by the parse code, and checked before each call.
- **Tests never call Claude.** Test mode (`docker-compose.test.yml`) points the API at a fake Claude that also serves fixture pages.

## Alternatives considered
- **A phone-side queue and a blocking request:** Safari suspends a locked phone mid-request, and drafts would stay on one device.
- **A server worker sweeping every household's queue:** it needs a role that sees all households, against rule 1.

## Consequences
- An import costs a sync round trip before parsing starts (seconds).
- Dismissed and saved import rows stay in Postgres. They leave the phone through the sync stream's filter, and purging them can come with a later clean-up.
- One parse can overshoot the cap by its own cost; parallel parses by a little more.
- Running the integration suites switches the local stack into test mode; `pnpm dev:backend` switches it back.
