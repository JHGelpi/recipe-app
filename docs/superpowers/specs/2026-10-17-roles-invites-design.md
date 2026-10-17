# Roles and Invites — Design

> Status: **Draft for review** · Date: 2026-10-17
> Sub-project 6 of Phase 1 (see `2026-10-12-walking-skeleton-design.md` §1). Builds on the walking skeleton's households, memberships, token hook and RLS helpers, and on every tenant table added since (recipes, favorites, imports, ai_usage, photos, substitutions). Requirements: `docs/SPEC.md`. Architecture: `ARCHITECTURE.md`, `docs/adr/`.

## 1. Purpose

Let the owner bring the family into the household. An Admin shares an invite link. The person signs in with their own email code and lands in the household with the chosen role. If they already used the app on their own, their recipes come with them. Admins change roles, remove people, and rename the household. Anyone can leave, and anyone can invite a friend to start a household of their own.

**Covers:**
- FR-3: invite by a text or email link;
- FR-4: roles enforced live, and controls hidden;
- FR-5: change roles and remove members;
- FR-6: invite someone to create their own household;
- NFR-1: household isolation kept through every move.

### Success criteria

1. **Inviting.** On the iPhone, an Admin opens Household → Invite someone, picks a role and shares a link through the share sheet.
2. **Joining as a new person.** Opening the link, signing in and tapping Join shows the household's recipes within seconds, with that role's controls.
3. **Joining with recipes of their own.** A person who already had recipes, alone in their household, sees "Your N recipes will move to the <name>". After Join, those recipes, photos, imports, remembered substitutions and favorites are in the new household for everyone.
4. **Changing roles.** An Admin changes someone's role. The server enforces it at once, and that person's phone shows the new controls within about a minute.
5. **Removing and leaving.** An Admin removes someone, or someone leaves. That person's phones clear the household's data and land in a new empty household. The household keeps every recipe.
6. **Invite links.**
   - A link works once and expires after 7 days. A used, expired or cancelled link says so.
   - Before sign-in, a link reveals nothing about the household.
7. **The household's rules.**
   - It always has at least one Admin.
   - Only Admins invite, change roles, remove or rename.
   - Nobody can act on another household.

### Out of scope

- Sending email or text from the server. The phone's share sheet carries the link.
- Display names and profile photos. Members are shown by email.
- More than one household per person (SPEC §2 v1 assumption).
- Transferring a whole multi-person household into another.
- Deleting an account.
- Recording who added each recipe.

## 2. Decisions made during design

| Decision | Choice | Why |
|---|---|---|
| Joining with recipes | **Bring them along** when the joiner is alone in their household; the old household is closed | The owner's choice. Nothing is lost when a family member started first. |
| Leave them behind / only if empty | Rejected | Easy to regret, or blocks the common case. |
| Joining from a household with others | Join without moving anything; recipes stay with those others; the only Admin must hand over first | You can't take a shared household's recipes away from its other members. |
| Removing or leaving | **A fresh empty household** for the person; recipes stay with the household | The owner's choice. Nobody ends up with no household; the household keeps what it built. |
| Delivery | **A share-sheet link**: single use, 7 days, cancellable, not tied to an email | The owner's choice. Works for text and email alike, and needs no mail server. |
| Moving data between households | **Narrow `SECURITY DEFINER` database functions** that check the caller themselves (ADR-0015) | A per-user RLS request can't write into a household the user isn't in yet. Kept to four audited functions; everything else stays under RLS. |
| Role checks | **Live from `memberships`** in `auth_household_id()` and `auth_household_role()` | A demoted or removed person must lose rights at once, not when their token expires. |
| Sync after a change | Token lifetime cut to **10 minutes**, and each phone syncs its own membership and refreshes on a change | PowerSync scopes by token, so a short token bounds what a removed phone can still receive. |
| Invite page before sign-in | Shows nothing about the household | A forwarded or leaked link reveals nothing on its own. |

## 3. Data (`db/migrations/`, `powersync/sync-config.yaml`)

### `invites` (household table)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | Generated on the server. |
| `household_id` | uuid not null | RLS. |
| `role` | `household_role` not null | The role on joining. |
| `token_hash` | bytea not null, unique | `sha256` of the link's code; the code itself is never stored. |
| `expires_at` | timestamptz not null | 7 days after creation. |
| `accepted_at`, `accepted_by` | | Set on Join. |
| `created_at`, `updated_at`, `updated_by`, `deleted_at` | | `deleted_at` means cancelled. |

- **Reading:** the household's Admins can read its pending invites.
- **Writing:** only the functions in §4 write the table. Clients get `select` only.
- **Not synced to phones.** The Household screen reads pending invites from the API.

### `memberships` changes

- **Email:** gains `email text`, copied from `auth.users` when the row is created and kept current by the functions in §4. It is shown on the Household screen.
- **Who reads it:** stays readable by the household, and is still written only by functions.
- **Sync stream `household_members`:** the household's memberships (`id`, `household_id`, `user_id`, `email`, `role`, `created_at`), mirroring `memberships_select`.
- **Sync stream `my_membership`:** the signed-in user's own row (`WHERE user_id = auth.user_id()`).
  - It keeps arriving after a change of household, because it is keyed by user, not household. That is what lets the phone notice a move (§6).
  - Its select policy: a user can always read their own membership row, so the stream mirrors RLS.

### `households` changes

- **Rename:** Admins already have an update policy. `PATCH /api/household` uses it as the user, with the name checked for 1–200 characters.
- **Closing a household:** `deleted_at` marks a household closed after its only member moved out of it.

### Live role checks

`auth_household_id()` and `auth_household_role()` read from `memberships` for `auth.uid()` (the token's `sub`). They no longer read the token's `household_id` and `household_role` claims.

- **Performance:** the policies already call them as `(select …)`, so each runs once per statement.
- **The token hook:** it still writes the claims, because sync streams use `auth.parameter('household_id')`.

### Foreign keys

- **The move:** the composite household foreign keys (photos → imports and recipes; recipes → photos; substitutions → recipes) become `DEFERRABLE INITIALLY IMMEDIATE`, so the move can set `SET CONSTRAINTS ALL DEFERRED` and change `household_id` table by table inside one transaction.
- **Token lifetime:** `GOTRUE_JWT_EXP` changes from 3600 to **600** seconds.

## 4. Database functions (`SECURITY DEFINER`, owner `app_owner`, `search_path = ''`)

- **Who may call them:** every function takes no household id from the caller. It reads the caller from `auth.uid()` and the caller's membership itself, checks every rule, and raises a coded error (`P0001` with a message key) on refusal.
- **Grants:** execute is granted only to `authenticated`.

### `create_invite(role)` → `(id, token, expires_at)`

- **Who:** Admins only.
- **The token:** generates 32 random bytes (`gen_random_bytes` from pgcrypto, or `gen_random_uuid()` twice as a fallback). It stores the sha256 and returns the code base64url-encoded, once.
- **Limit:** at most 20 pending invites per household.

### `cancel_invite(id)`

Admins of the invite's household; sets `deleted_at`.

### `preview_invite(token)` → `(status, household_name, role, moving_recipes, blocker)`

- **`status`:** `ok`, `used`, `expired`, `cancelled`, `unknown` or `already_member`.
- **`moving_recipes`:** the number of live recipes that would move (0 unless the caller is alone in their household).
- **`blocker`:** null, or `only_admin` (the caller is the only Admin of a household with others).

### `accept_invite(token)` → `(household_id, moved_recipes)`

1. **Checks:** locks the invite row and refuses unless `preview_invite` would say `ok` with no blocker.
2. **Moving.** If the caller is the only member of their old household, every row with the old `household_id` in recipes, photos, imports, substitutions and favorites moves to the new one, under deferred constraints. `ai_usage` stays behind. The old household gets `deleted_at`.
   - **Duplicate ids:** two households can't both hold the same recipe id, so nothing clashes.
   - **Favorites** are the user's own, so they move with them.
3. **Otherwise** (the caller came from a household with others), nothing moves.
4. **Membership:** the caller's membership row is updated to the new household and the invite's role.
5. **The invite:** `accepted_at` and `accepted_by` are set.
6. **Returns** the moved photo ids, so the API can move their files.

### `set_member_role(user_id, role)`

- **Who:** Admins, for a member of their own household.
- **Refused** if it would leave no Admin.

### `remove_member(user_id)`

- **Who:** Admins, for another member of their own household (not themselves).
- **Result:** creates a new household named like a sign-up's ("<email name> household") and moves the person's membership there as Admin.
- **Nothing else moves.** Their favorites of the old household's recipes are soft-deleted.

### `leave_household()`

- **The same result as removal,** for oneself.
- **Refused** when alone in the household (`alone`), or when the only Admin of a household with others (`only_admin`).
- **Unsent changes:** the phone checks its queued uploads first (§6).

### Errors

These message keys are returned to the API: `forbidden`, `not_member`, `last_admin`, `only_admin`, `alone`, `invite_used`, `invite_expired`, `invite_cancelled`, `invite_unknown`, `already_member`, `too_many_invites`.

## 5. Server (`apps/api/src/household/`)

Every endpoint runs as the user through `asUser`, calling the functions or plain RLS-checked SQL:

| Endpoint | Body | Answers |
|---|---|---|
| `POST /api/invites` | `{ role }` | 201 `{ id, url, expires_at }`, 403, 409 `too_many_invites` |
| `GET /api/invites` | | 200 the pending invites (`id`, `role`, `expires_at`, `created_at`), 403 for non-Admins |
| `DELETE /api/invites/:id` | | 204, 403, 404 |
| `POST /api/invites/preview` | `{ token }` | 200 `{ status, household_name, role, moving_recipes, blocker }` |
| `POST /api/invites/accept` | `{ token }` | 200 `{ household_id, moved_recipes }`, 409 with the key |
| `PATCH /api/members/:userId` | `{ role }` | 204, 403, 404, 409 `last_admin` |
| `DELETE /api/members/:userId` | | 204, 403, 404, 409 |
| `POST /api/household/leave` | | 204, 409 `alone` / `only_admin` |
| `PATCH /api/household` | `{ name }` | 204, 400, 403 |

- **The invite URL** is `${PUBLIC_URL}/invite/<code>` (a new `PUBLIC_URL` config, already in `.env`).
- **Photo files:** after `accept_invite` commits, the API moves the moved photos' files from `<old household>/` to `<new household>/` on the volume. A file that fails to move is logged; its photo then shows as missing.
- **Shared schemas:** zod schemas for the bodies live in `packages/domain/src/household.ts`.

## 6. The app (`apps/mobile`)

### Household screen (`/household`)

Reached from a **Household** link on the Recipes list.

**Everyone sees:**
- the household name (with **Rename** for Admins);
- the members list: email, role, the date joined, and "(you)";
- **Leave household**, where allowed (§4);
- **Invite a friend to Recipes**: the share sheet with "Make your own recipe collection: <PUBLIC_URL>".

**Admins also see:**
- a role picker per member, and **Remove** for others, each confirmed;
- **Invite someone**: a role choice (Member by default; Viewer or Admin), then **Share invite**.
  - Uses `navigator.share`, falling back to copying the link with "Link copied".
- **Pending invites**, each with its role, its expiry ("expires in 6 days") and **Cancel**.

**Offline:** the screen shows the synced members list. Invite, role, remove, leave and rename are disabled, with "Changing the household needs a connection".

### Invite page (`/invite/[code]`)

- **Signed out:** "You've been invited to a household. Sign in to see the invite." Sign-in returns to this page.
- **Signed in:** it calls preview and shows:
  - "Join the <name> as a <role>";
  - when recipes would move: "Your N recipes will move to the <name>";
  - when they would stay: "Your recipes stay with the <old name>";
  - the blocker or status message, with no Join: "This invite has already been used", "This invite has expired", "This invite was cancelled", "This invite isn't valid", "You're already in the <name>", "Make someone else an Admin of your household first".
- **Join:**
  1. waits for queued uploads (up to 30 s; otherwise "Still saving your changes. Try again in a moment.");
  2. calls accept;
  3. refreshes the session;
  4. lands on Recipes with "You've joined the <name>".

### Following membership changes

- **`useMembershipWatch`** compares the synced `my_membership` row with the session's claims. When the household or role differs, it calls `auth.refreshSession()` once, retrying with backoff.
- **The session bridge** keys local data by **user and household**: `dbOwner` stores `"<userId>:<householdId>"`. A change of household wipes the local database, photo files and cook places, then reconnects. It then shows:
  - "You've joined the <name>", after an accept on this phone;
  - otherwise "You were moved to the <name>" (covering removal, since the person can't tell removal from leaving on another phone).
- **A role change** only refreshes the token: the controls follow the claims, and nothing is wiped.

## 7. Testing

- **Unit:**
  - the domain body schemas;
  - the API endpoint answers, with a fake `asUser`;
  - the app's membership-watch decision (refresh or not, wipe or not), and the invite page states;
  - the `dbOwner` key format.
- **RLS and function suite** (registry gains `invites`):
  - Live checks: a demoted Member's write is refused on their next statement, using the same token.
  - Invites:
    - only Admins create, list and cancel;
    - a token works once;
    - an expired or cancelled invite is refused;
    - another household can't read invites;
    - the stored hash never equals the code.
  - Accept:
    - a new person joins with the right role;
    - a lone person's recipes, photos, imports, substitutions and favorites all move (counts before and after), and the old household is closed;
    - a person from a shared household moves nothing;
    - the only Admin of a shared household is refused.
  - Roles: the last Admin can't be demoted, nor removed, nor leave.
  - Removal:
    - an Admin removes a member, who gets a new household as its Admin;
    - a Member or Viewer can't remove anyone;
    - nobody can act on another household's member.
  - Grants: the exact grants test is updated.
- **API suite:** every endpoint's answers against the stack, and an accept moving a photo's file (GET works afterwards).
- **End to end:**
  1. An Admin invites a Member. A second browser signs in through the link, joins, and sees the household's recipes.
  2. An existing user with a recipe joins, and the recipe is in the household for the Admin.
  3. The Admin changes the Member to Viewer, and the Viewer's Edit controls disappear.
  4. The Admin removes the person, whose browser shows the notice and an empty Recipes list.
  5. Leave household.
  6. A used link shows "This invite has already been used".
  7. The household screen offline shows members, with the changes disabled.

## 8. Documentation

- **ADR-0015** "Household moves through narrow definer functions; live role checks":
  - the four functions and their rules;
  - why RLS alone can't do it;
  - live helper lookups;
  - 10-minute tokens and the membership stream;
  - an amendment to CLAUDE.md rule 1: "…or the `SECURITY DEFINER` household functions listed in ADR-0015, which check the caller themselves".
- **`ARCHITECTURE.md`:** the Household screen, the invite flow, and the `INVITE` entity.
- **`docs/SPEC.md`:** FR-3 to FR-6 noted as built; open question 1 (one household per user) stays as it is.

## 9. Acceptance criteria

1. The success criteria in §1 hold on the owner's iPhone, with a second person on another device.
2. Lint, typecheck, unit, stack, RLS, API and e2e suites pass locally and in CI.
3. The owner's existing account and data (and the 445 local test users) survive the migration. It changes no existing row except adding `memberships.email`, backfilled from `auth.users`.
