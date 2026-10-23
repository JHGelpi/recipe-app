# 0023. In-app feedback filed as GitHub issues, under an anonymous reporter id

- **Status:** Accepted
- **Date:** 2026-10-23

## Context
FR-45 lets anyone signed in suggest an idea or report a problem from inside Dishkept, without a GitHub account. The reports should land where the work is tracked: this repository's issues. The issues are public, while the people sending them belong to private households (NFR-2). No secret may reach the device (NFR-3, rule 2).

## Decision
- **The API files the issue.** `POST /api/feedback` verifies the session, validates the report against the strict zod schemas in `packages/domain/src/feedback.ts`, and calls GitHub's REST API ("create an issue").
  - It uses a **fine-grained token scoped to Issues (read and write) on this repository only**, kept in `.env` as `GITHUB_FEEDBACK_TOKEN`.
  - With no token, the route answers 503, and the app says feedback isn't set up.
- **What leaves the app is fixed by the schema.** The person's answers go out with a fixed list of device details: build, storage, user agent, installed or tab, screen size, appearance, units, online state and send time. Problem reports also say whether the device was offline lately and how many uploads are waiting.
  - Extra fields are refused.
  - The reporter's role is read live in the database, not taken from the client.
  - Email, names, the household, recipe content, and invite and share links are never sent.
  - `@mentions` are defused so they can't notify GitHub users.
- **One anonymous reporter id per person** ("r-3f9a1c"), from `feedback_reporter_id()`, a `security definer` function that returns only the caller's own id.
  - The id-to-account mapping is in `feedback_reporters`, a system table with RLS on and no policies or grants, like the `signup_*` tables.
  - Only the owner's `postgres` login can read it.
- **Five filed reports per person a day**, using the in-memory `rateLimit`. A failed or timed-out GitHub call gives its count back, so it doesn't count.
- **Tests never reach GitHub.** In test mode, `GITHUB_API_URL` points the API at the fake service (`test-support/fake-ai`), which records issues at `/__issues` and can be made to fail once.

## Alternatives considered
- **A `mailto:` link, or an email to the owner:** no structure, no public tracking, and it exposes the sender's email address.
- **Linking to GitHub's issue form:** needs a GitHub account, and the device details would have to be pasted by hand.
- **A feedback table in our own database:** private, but the work is tracked on GitHub, so every report would need copying there by hand.
- **The owner's classic personal token:** reaches every repository the owner can. A fine-grained token limits the damage if `.env` leaks to Issues on one repository.

## Consequences
- GitHub becomes an external system of the API. Its outage shows as "Couldn't send it", the draft is kept, and nothing is queued (FR-45 offline behavior).
- The token is a new production secret to create, rotate and revoke (RUNBOOK, "Rotating secrets"). It expires on the date set when it was made.
- The limit resets when the API restarts, which is acceptable at family scale.
- Issues are public: the notice above the form, and the fixed details list, are the privacy controls. Free text is the person's own responsibility.
