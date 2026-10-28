# 0028. Per-person limits on signed-in routes, and a photo quota per household

- **Status:** Accepted
- **Date:** 2026-10-28

## Context
Only the signed-out sign-up routes and feedback were rate-limited. Any Member could ask the API to read URL imports without end, so the server would fetch pages from any public host, hiding behind the owner's home address. The fetch happens before the AI budget is checked, and a page with JSON-LD never reaches the AI at all. Uploads and photo files had no limit on how often, and photo storage had no limit on how much (issue #67, CWE-770). The SSRF guards on the fetcher already stop it reaching private addresses; this is about volume.

## Decision
- **Per-person limits** on the routes that fetch pages or write files, in the API's in-memory limiter (`createRateLimiter`, as for feedback):

  | Route | Default limit |
  |---|---|
  | `POST /api/imports/:id/parse` | 30 an hour; only parses that start count |
  | `POST /api/upload` | 120 batches a minute |
  | `PUT /api/photos/:id` | 200 an hour |

  Each is checked after the token and before any work. Over a limit the answer is `429 rate_limited`.
- **A photo quota per household:** 2 GB by default.
  - When a photo is uploaded, the API sums the household's uploaded, live photos under a per-household advisory lock. If this file would pass the quota, it answers `507 storage_full`.
  - The upload records the file's real size in `photos.bytes`, replacing what the phone declared. Phones cannot change `bytes` afterwards.
- **The app needs no new retry logic:**
  - A refused parse is retried with backoff, uploads stay queued, and photos retry.
  - On a 507 the status line adds "Photo storage is full" until an upload succeeds.
- All four values come from the environment (`API_PARSES_PER_HOUR`, `API_UPLOADS_PER_MINUTE`, `API_PHOTOS_PER_HOUR`, `PHOTO_QUOTA_MB`). Development and test set them very high, because test runs reuse the seed users.

## Alternatives considered
- **Limits at the proxy (Caddy):** Caddy has no rate limiter without a third-party module. It also sees addresses, not people, and every family member shares one address.
- **A shared store such as Redis:** a new container for a single API process at family scale. Counts restart with the API, which is acceptable here.
- **Counting the files on disk for the quota:** exact, but costs a directory walk on every upload. The recorded sizes are as exact once the server writes them.

## Consequences
- A burst of legitimate use, such as a big photo import, can wait for the window to pass. The defaults sit well above family use.
- A household at its quota stops uploading photos until trash is purged (30 days) or the quota is raised. Recipes and everything else keep syncing.
- The limits restart when the API restarts. They bound abuse; they are not a ledger.
- Share-link photo copies are not counted in the quota. Each is a copy of a photo that was counted, one per live link.
