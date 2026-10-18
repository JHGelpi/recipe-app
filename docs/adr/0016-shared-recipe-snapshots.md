# 16. Shared recipe snapshots, read anonymously through a definer function

Date: 2026-10-17 · Status: Accepted

## Context

Sharing out (FR-26, FR-27) sends recipes to people outside the household, some without an account. A link must show the recipe as it was when shared and nothing else of the household (NFR-2). A recipient who saves it needs a copy in their own household, which their RLS cannot read from.

## Decision

- **A `shares` row per link** holds a validated snapshot of the recipe and a copy of its dish photo file (`photos/<household>/<share id>.jpg`). The link code is 32 random bytes; only its sha256 is stored. Links last until stopped. A recipe in the Trash pauses its links.
- **Definer functions:** `create_share`, `stop_shares`, `read_share` and `save_share`, with `search_path = ''`, check the caller themselves. `read_share` returns one snapshot by its code hash, and only while the share and its recipe are live.
- **`asAnonymous`:** the API serves signed-out visitors through `asAnonymous`, the `authenticated` role with empty claims. Every RLS policy denies it; it may call only `read_share`.
- **Saving a copy:** `save_share` makes a new recipe in the caller's household (admins and members), with new ids and the source "Shared by the <household>".
- **Text and PDF are made on the phone.** The PDF uses jsPDF (MIT), loaded on first use, with its built-in Helvetica and a fallback map for fractions the font lacks.
- **The 30-day purge** deletes stopped shares and their photo copies through RLS (`shares_purge`).

## Alternatives considered

- **Serving the live recipe:** later edits and deletions would leak (NFR-2).
- **A public role, or a signed URL service:** more moving parts than one narrow function.
- **A server-made PDF:** needs a connection and a headless browser.
- **An embedded Unicode font:** larger PDFs and an extra asset, for six glyphs.

## Consequences

- **CLAUDE.md rule 1** lists these functions and `asAnonymous`. No other code may use empty claims.
- **A link outlives edits:** to send a newer version, share again.
- **The app gains jsPDF** (a 445 KB chunk), loaded only when a PDF is made; the entry bundle grew 6 KB.
