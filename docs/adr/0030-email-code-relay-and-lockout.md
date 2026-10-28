# 0030. Email codes through the API, with a per-email lockout

- **Status:** Accepted
- **Date:** 2026-10-28

## Context
GoTrue limits sign-in code requests and checks per client address, but doesn't count wrong codes per account. A guesser spread over many addresses gets every address's allowance. Codes have 8 digits (issue #61's follow-up) and live for 10 minutes, so guessing is already hopeless; this is defence in depth (issue #72, FR-1).

## Decision
- **The API relays email codes.** `POST /api/auth/otp` and `POST /api/auth/verify` pass the request to GoTrue on the Docker network unchanged. They also pass the proxy's `X-Client-IP`, so GoTrue's per-address limits still see the visitor. GoTrue's answer comes back unchanged.
- **The proxy closes GoTrue's own `/auth/otp` and `/auth/verify`** (the ADR-0026 allow-list of issue #68), so the relay cannot be skipped.
- **The app's auth-js client keeps its usual calls.** Its `fetch` sends just those two URLs to the relay (`codeRelayUrl` in `packages/domain`).
- **Five wrong codes for one email in 15 minutes lock that email.**
  - Further checks get `429 too_many_wrong_codes` without reaching GoTrue, whatever the code or address. The sign-in screen says "Too many wrong codes. Request a new code."
  - A successful check clears the count. So does a new code: each new code replaces the old, so five guesses per code stay hopeless, and nobody can keep someone else locked out.
  - GoTrue's own 429 doesn't count as a wrong code.
- **The counter is in API memory,** like the other limiters (ADR-0028). A restart clears it, which only resets a 15-minute window.
- **Cloudflare refuses floods first.** A rate-limit rule (`cloudflare_ruleset.sign_in_rate_limit`, OpenTofu) blocks more than 10 requests to either path in 10 seconds from one address and data centre. This is the free plan's one rule.

## Alternatives considered
- **A database table for the counter:** survives restarts, but needs a system table, definer functions and an RLS registry entry, for a 15-minute window.
- **Locking until the window ends, even with a new code:** simpler, but an attacker could keep a victim locked out.
- **A GoTrue hook:** GoTrue has no hook on failed verification.

## Consequences
- Sign-in depends on the API as well as GoTrue. Both are in the same stack, and the API was already needed for sign-up passes.
- Tests and scripts sign in through the relay: `test-support/auth.ts` makes the same auth-js client as the app, and the JWT rotation script posts to `/api/auth/*`.
- The Cloudflare rule only takes effect once someone runs `tofu apply`.
