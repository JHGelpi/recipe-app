# 15. Household moves through narrow definer functions; live role checks

Date: 2026-10-17 · Status: Accepted

## Context

Roles and invites (FR-3 to FR-6) move people, and sometimes their data, between households. Every other write runs as the user under RLS (rule 1, ADR-0006). But a person accepting an invite is not yet in the household they are joining, and someone removed must be placed in a household they don't belong to yet. Separately, RLS read the household and role from the token's claims, which last until the token expires, so a demoted or removed person kept their rights until then.

## Decision

- **Narrow definer functions.** Seven `SECURITY DEFINER` functions, owned by `app_owner` with an empty `search_path`, make every cross-household change: `create_invite`, `cancel_invite`, `preview_invite`, `accept_invite`, `set_member_role`, `remove_member` and `leave_household`.
  - None takes a household id from the caller. Each reads the caller from `auth_user_id()`, locks the caller's household's memberships, checks every rule, and raises a key on refusal.
  - Clients reach them only through the API, as the user (`asUser`), and only `authenticated` may execute them.
  - Internal helpers (`lock_my_household`, `move_to_new_household`, `household_refuse`) cannot be called by clients.
- **Live role checks.** `auth_household_id()` and `auth_household_role()` read the caller's membership live. A change binds on the next statement.
- **Sync after a change.** PowerSync still scopes by token claims, so:
  - tokens last 10 minutes;
  - each phone syncs its own membership row (`my_membership`) and refreshes its token when the row changes;
  - local data is keyed by user and household and wiped on a move.
- **Invite codes:** 32 random bytes, single use, 7 days; only their sha256 is stored.
- **Joining alone brings the data.** A person alone in their household brings recipes, photos (files moved by the API afterwards), imports, substitutions and favorites. The composite household foreign keys are deferrable for this move only.

## Alternatives considered

- **A privileged API role for these operations:** breaks rule 1 for a whole code path, rather than for seven audited statements.
- **Trusting claims with a short token only:** a removed person could still write for the token's lifetime.
- **Copying recipes instead of moving them:** duplicates photos and leaves two households to reconcile.

## Consequences

- **CLAUDE.md rule 1** names these functions as the only exception, and each needs RLS-suite tests for every refusal.
- **Sync lag:** a removed person's phone can sync the old household for at most 10 minutes, and usually a few seconds.
- **Token refreshes** happen every 10 minutes instead of hourly, which is negligible at family scale.
- **Member emails** fill in as people sign in, because the migration role cannot read `auth.users`.
