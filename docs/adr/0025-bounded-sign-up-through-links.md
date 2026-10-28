# 0025. Sign-up through links is bounded: one account per share link, 10 pending friend links per person

- **Status:** Accepted
- **Date:** 2026-10-27

## Context
With the sign-up gate on (ADR-0018), an address can make an account only if it is allowed or holds a pass from a link. Friend links already worked once (FR-42). Recipe share links did not: any live share granted a pass to any number of addresses (issue #62). Shares are made to be forwarded, so one link posted publicly would have opened sign-up to everyone. That defeats the gate, and each new account brings its own household, AI budget (#63) and photo storage.

FR-6 lets any member, Viewers included, make friend links, up to 50 pending per household. Each friend link can make one account.

## Decision
- **A share link makes at most one account.** `grant_signup_pass('share', …)` holds the share for the first address to ask, for as long as its 24-hour pass lives. The account made with that pass uses the share's sign-up up, recorded in `share_signups`.
  - `share_signups` is a system table: RLS on, no policies, no grants, like the `signup_*` tables. It is not a column on `shares`, which syncs to devices.
  - The share keeps working for reading, and a person who already has an account still gets a pass from it.
  - A refused pass shows the existing "expired or already used" message.
- **Each person may have at most 10 pending friend links**, alongside the household's 50.
- **Viewers keep making friend links (FR-6).** A friend link adds nothing to the Viewer's household, it works once, and the per-person cap bounds what one Viewer can hand out. This is the record the issue asks for in place of taking the right away.

## Alternatives considered
- **Up to 3 accounts per share:** friendlier to group chats, but three strangers per leaked link. One matches friend links.
- **No sign-up through shares:** the tightest option, but a recipient without an account could only read the recipe, never save it (FR-27).
- **Friend links for Admins and Members only:** closes the Viewer path, but FR-6's reasoning still holds, and the cap already bounds it.

## Consequences
- A share sent to a group lets only its first new person sign up. The others are told the link was used and need an invite or a friend link. People who already have accounts aren't affected.
- A share's sign-up can't be reset. The sender makes a new share link (stop and share again) if needed.
- A removed or deleted share releases nothing: `share_signups` rows go with the share (`on delete cascade`).
