# 0027. Sync scoped by live membership, not the token's household

- **Status:** Accepted
- **Date:** 2026-10-27
- **Supersedes:** the "Sync after a change" part of ADR-0015

## Context
ADR-0015 made RLS read a person's household and role from their live membership. PowerSync still scoped every stream by the `household_id` claim in the token, so a removed person, or one who moved to another household, kept receiving the old household's changes until the token expired. That could take up to 10 minutes and covered recipes, member emails, cook logs and the shopping list (issue #65, CWE-613).

## Decision
- **Every stream scopes by a subquery on `memberships`.** It selects `household_id IN (SELECT household_id FROM memberships WHERE user_id = auth.user_id() AND deleted_at IS NULL)` instead of `= auth.parameter('household_id')`. This is the same rule `auth_household_id()` applies in RLS, so the sync config now mirrors RLS exactly (CLAUDE.md rule 6). PowerSync re-evaluates the subquery when the membership row changes, so a removal or move takes effect within seconds.
- **The token keeps its claims.** The phone still keys its local data by the claimed household, and it refreshes its token when its synced membership changes (ADR-0015). Tokens still last 10 minutes.
- **The remove confirmation says what can't be taken back.** It tells the Admin that anything the person's devices already downloaded stays on them.
- **Guard:** `apps/api/tests/stack/sync-membership.test.ts` reads the real sync stream with a removed member's still-valid token, and checks that a recipe added after the removal never reaches it. With claim-scoped streams, the test fails.

## Alternatives considered
- **Shorter tokens (300 s):** halves the window but keeps it, and doubles token refreshes.
- **Recording the risk only:** leaves sync weaker than RLS, which every other path already checks live.

## Consequences
- A removed person's phone loses the household's rows on its next checkpoint. Data it downloaded earlier stays on the device, which no server-side change can undo.
- A person who joins a household starts receiving it before their token refreshes. The phone then wipes and re-syncs as before, so for a moment it may hold rows from both its old local copy and the new household. All of them belong to households the person is or was a member of.
- Each stream now looks up the person's membership, which costs PowerSync one parameter lookup per connection. That is negligible at family scale.
- New streams must use the same subquery. `auth.parameter('household_id')` no longer appears in the sync config.
