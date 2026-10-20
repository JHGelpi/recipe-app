# Bug batch PR 3: Household, sharing, sign-up and sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the household, sharing, sign-up and sync findings of spec §4. Friend links get listed and revoked in the app, member counts ignore removed memberships, the Join and notice flows survive double taps and failed refreshes, Link reuses a recipe's live link, and the sign-up limiter is bounded.

**Architecture:**
- **Database:** two migrations.
  - The first redefines the household functions to skip removed memberships, and adds `revoke_friend_link` and `friend_link_status`.
  - The second keeps each new share link's code, so `create_share` can hand the same link out again.
- **API:** the routes call these functions through `asUser`, or `asAnonymous` for the signed-out friend-link status.
- **Phone:** session and notice reads move out of render into effects. The retry loop and the owner-key choice become pure functions with unit tests.

**Tech Stack:** Hono API with postgres.js under RLS, dbmate migrations, Expo / React Native Web, PowerSync, Vitest, Playwright, Caddy.

**Spec:** `docs/superpowers/specs/2026-10-19-bug-batch-design.md` (§4, and the PR 3 parts of §6 and §7)

## Global Constraints

- CLAUDE.md rule 1: the API reaches the database only through `asUser`, `asClaims` or `asAnonymous`. Cross-household changes go only through `SECURITY DEFINER` functions that check the caller themselves (ADR-0015).
- Rule 4: Viewers can't change household data. Friend links are the exception the spec names: anyone who can create one can list and revoke them, and Viewers can create them.
- Rule 5: delete means soft delete. A revoked link gets `deleted_at = now()`.
- Rule 6: sync rules mirror RLS. `friend_links` is not synced. The new `shares.kept_code` column is not added to `household_shares`.
- Never edit an applied migration. New migrations go in `db/migrations/<timestamp>_<verb>_<thing>.sql` with `-- migrate:up`.
- UI: screens use `apps/mobile/src/ui` and `src/theme`, with no colour literals and no `react-native` `Text`.
- Copy, verbatim from the spec:
  - "Uploading the photo…"
  - "Couldn't stop sharing. Try again."
  - "Couldn't load this page. Try again."
  - "joined" (the Join notice)
- **Never run `pnpm db:reset`.** After `pnpm test:api` or `pnpm test:e2e`, run `pnpm dev:backend` and then `docker compose restart sync`.
- Conventional Commits with requirement IDs. Every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Found while planning

- **"The `user_favorites` stream also filters on `household_id`" is already done.** `powersync/sync-config.yaml` has `WHERE user_id = auth.user_id() AND household_id = auth.parameter('household_id')`, matching `favorites_select`. Skipped.
- **"The purge e2e checks that the recipe is gone on the server" is already done.** `e2e/trash.spec.ts` polls `select 1 from recipes where title = …` until it returns 0 rows. Skipped.
- **"Suites that need many recipes use fresh households."** Every e2e and API suite that creates more than a few recipes already signs in a fresh user: look, tagbar, search, screens, both imports suites, and shopping. Task 7 re-checks this with a grep and records the result.
- **The local database's household A holds 3,307 recipes and 1,046 imports** from repeated local runs. The tests above don't cause this: the API upload suite writes a few rows per test to household A, and the local database is never reset.
- **Revoked links read as ended:** `/welcome/<code>` needs a signed-out status check, so the page can say a link has ended before anyone types an email.
- **The share code is never stored**, only its hash, so "Link reuses the recipe's live share" needs the code kept. Task 4 adds `shares.kept_code`.
  - The column is not synced, and only the household can read it, through the API.
  - The household can already make links to its own recipes, so this exposes nothing new to it. ADR-0016 records the change.
- **The flaky shopping e2e (PR #16 CI):**
  - after `setOffline(false)` the page still read "Offline · 1 unsynced" 30 s later. That label is PowerSync's `connected`, so sync never reconnected;
  - the first run failed and the rerun passed. Task 8 investigates it.

## Review Focus

1. **Two Link taps at once, or Link on two phones:** each may find no live link and make one, so a recipe gets two links. Each link works, and Stop sharing stops both. *Test:* Task 4's API test runs two creates back to back and expects one code.
2. **A share id that belongs to another household's link, or to a stopped link, passed to `create_share`:** it must be refused, never return or overwrite that link. *Test:* Task 4's RLS test.
3. **A friend link revoked while its page is open in another tab:** a sign-up then fails with the existing "This link has expired. Ask for a new one." The pass check is the gate, and the page check is only a courtesy. *Test:* Task 2's RLS test revokes a link, then asks for a pass.
4. **The rate limiter at its key cap:** a new key is refused, not let through, and keys free up a window later. *Test:* Task 6's unit test.
5. **A Join whose token refresh fails:** the list shows no "moved" banner. The "joined" notice waits until the claims name the new household. *Test:* Task 3's `notice` unit test.

---

### Task 1: Removed memberships don't count; friend links can be listed and revoked (database)

**Files:**
- Create: `db/migrations/20261026000000_fix_member_counts_and_revoke_friend_links.sql`
- Modify: `packages/domain/src/household.ts` (`HOUSEHOLD_ERRORS` gains `link_unknown`)
- Test: `apps/api/tests/rls/household.test.ts`, `apps/api/tests/rls/signup-gate.test.ts`

**Interfaces:**
- Produces:
  - `public.revoke_friend_link(link_id uuid) returns void`, refusing with `link_unknown`;
  - `public.friend_link_status(link_code text) returns text`, which returns `'live' | 'ended' | 'unknown'`;
  - `friend_links_select`, open to every role of the household;
  - `HouseholdError` gains `'link_unknown'`.

- [ ] **Step 1: Write the failing membership tests.** Append to `apps/api/tests/rls/household.test.ts`:

```ts
describe('removed memberships do not count (bug batch §4)', () => {
  // A person who joined and whose membership was then soft-deleted.
  async function ghost(admin: Actor, role = 'admin'): Promise<Actor> {
    const person = await fresh();
    await accept(person, await invite(admin, role));
    await adminSql`update public.memberships set deleted_at = now() where user_id = ${person.userId}`;
    return person;
  }

  it('the last live Admin cannot step down', async () => {
    const admin = await fresh();
    await ghost(admin);
    expect(
      await outcome(
        as(admin, (tx) => tx`select public.set_member_role(${admin.userId}::uuid, 'member')`),
      ),
    ).toBe('last_admin');
  });

  it('alone with a removed member: leaving is refused, and joining brings the recipes', async () => {
    const admin = await fresh();
    await ghost(admin, 'member');
    expect(await outcome(as(admin, (tx) => tx`select public.leave_household()`))).toBe('alone');
    const id = randomUUID();
    await as(
      admin,
      (tx) =>
        tx`insert into public.recipes (id, household_id, title) values (${id}, ${admin.householdId}, 'Ghost soup')`,
    );
    const other = await fresh();
    const token = await invite(other);
    expect(await preview(admin, token)).toMatchObject({
      status: 'ok',
      moving_recipes: 1,
      blocker: null,
    });
    expect(await outcome(accept(admin, token))).toBe('ok');
    const [row] = await adminSql<{ household_id: string }[]>`
      select household_id from public.recipes where id = ${id}`;
    expect(row?.household_id).toBe(other.householdId);
  });
});
```

- [ ] **Step 2: Write the failing friend-link tests.** In `apps/api/tests/rls/signup-gate.test.ts`:
  - add these helpers after `friendCode`:

```ts
async function outcome(run: Promise<unknown>): Promise<string> {
  try {
    await run;
    return 'ok';
  } catch (error) {
    return (error as { message?: string }).message ?? 'error';
  }
}

async function linkStatus(code: string): Promise<string> {
  const [row] = await asAnonymous(
    (tx) => tx<{ status: string }[]>`select public.friend_link_status(${code}) as status`,
  );
  return row!.status;
}

async function linkId(code: string): Promise<string> {
  const [row] = await adminSql<{ id: string }[]>`
    select id from public.friend_links where token_hash = sha256(convert_to(${code}, 'UTF8'))`;
  return row!.id;
}
```

  - replace the whole `describe('friend links', …)` block with:

```ts
describe('friend links', () => {
  it('any member, viewers included, can make, list and revoke one; another household cannot revoke it', async () => {
    const viewer = await signInAs(SEED.viewerA);
    const adminB = await signInAs(SEED.adminB);
    const code = await friendCode(viewer);
    const id = await linkId(code);
    const listed = await as(
      viewer,
      (tx) => tx<{ id: string; household_id: string }[]>`
      select id, household_id from public.friend_links`,
    );
    expect(listed.some((row) => row.id === id)).toBe(true);
    expect(listed.every((row) => row.household_id === viewer.householdId)).toBe(true);
    const revoke = (actor: Actor) =>
      outcome(as(actor, (tx) => tx`select public.revoke_friend_link(${id}::uuid)`));

    expect(await revoke(adminB)).toBe('link_unknown');
    expect(await linkStatus(code)).toBe('live');
    expect(await revoke(viewer)).toBe('ok');
    expect(await linkStatus(code)).toBe('ended');
    const late = address('late-friend');
    used.push(late);
    expect(await grant('friend', code, late)).toBe(false);
    expect(await revoke(viewer)).toBe('link_unknown');
  });

  it('signed out, a link reads as live, ended once expired, or unknown', async () => {
    const admin = await signInFresh(address('status-admin'));
    const code = await friendCode(admin);
    expect(await linkStatus(code)).toBe('live');
    await adminSql`update public.friend_links set expires_at = now() - interval '1 second'
      where token_hash = sha256(convert_to(${code}, 'UTF8'))`;
    expect(await linkStatus(code)).toBe('ended');
    expect(await linkStatus('z'.repeat(43))).toBe('unknown');
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm vitest run -c vitest.integration.config.ts apps/api/tests/rls/household.test.ts apps/api/tests/rls/signup-gate.test.ts`

Expected: FAIL:
- `last_admin` test: `expected 'ok' to be 'last_admin'`;
- the alone test: `expected 'ok' to be 'alone'`;
- the friend-link tests: `function public.friend_link_status(unknown) does not exist`.

(The stack must be up: `pnpm dev:backend` with the seed.)

- [ ] **Step 4: Write the migration**

```sql
-- db/migrations/20261026000000_fix_member_counts_and_revoke_friend_links.sql
-- migrate:up
-- Bug batch §4 (ADR-0015). Runs as app_owner.
-- 1. A removed (soft-deleted) membership no longer counts as an Admin or as
--    another person in the household.
-- 2. Friend links are listed to everyone who can make one, and can be revoked.

create or replace function public.preview_invite(code text)
returns table (status text, household_name text, role public.household_role, moving_recipes int, blocker text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  inv public.invites;
  home uuid;
  my_role public.household_role;
  others int;
begin
  select * into inv from public.invites i where i.token_hash = sha256(convert_to(code, 'UTF8'));
  if not found then return query select 'unknown'::text, null::text, null::public.household_role, 0, null::text; return; end if;
  if inv.deleted_at is not null then return query select 'cancelled'::text, null::text, inv.role, 0, null::text; return; end if;
  if inv.accepted_at is not null then return query select 'used'::text, null::text, inv.role, 0, null::text; return; end if;
  if inv.expires_at <= now() then return query select 'expired'::text, null::text, inv.role, 0, null::text; return; end if;
  if exists (select 1 from public.households h where h.id = inv.household_id and h.deleted_at is not null) then
    return query select 'cancelled'::text, null::text, inv.role, 0, null::text; return;
  end if;

  select m.household_id, m.role into home, my_role from public.memberships m
  where m.user_id = public.auth_user_id() and m.deleted_at is null;
  if home = inv.household_id then
    return query select 'already_member'::text, h.name, inv.role, 0, null::text
      from public.households h where h.id = inv.household_id;
    return;
  end if;
  select count(*) into others from public.memberships m
  where m.household_id = home and m.user_id <> public.auth_user_id() and m.deleted_at is null;
  return query select
    'ok'::text,
    h.name,
    inv.role,
    case when others = 0 then (select count(*)::int from public.recipes r
                               where r.household_id = home and r.deleted_at is null) else 0 end,
    case when others > 0 and my_role = 'admin' and not exists (
           select 1 from public.memberships m
           where m.household_id = home and m.role = 'admin' and m.user_id <> public.auth_user_id()
             and m.deleted_at is null)
         then 'only_admin'::text end
  from public.households h where h.id = inv.household_id;
end;
$$;

create or replace function public.accept_invite(code text)
returns table (household_id uuid, from_household uuid, moved_recipes int, moved_photos uuid[])
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  inv public.invites;
  home uuid;
  my_role public.household_role;
  others int;
  recipes_moved int := 0;
  photos_moved uuid[] := '{}';
  mail text := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email';
begin
  select * into inv from public.invites i where i.token_hash = sha256(convert_to(code, 'UTF8')) for update;
  if not found then perform public.household_refuse('invite_unknown'); end if;
  if inv.deleted_at is not null then perform public.household_refuse('invite_cancelled'); end if;
  if inv.accepted_at is not null then perform public.household_refuse('invite_used'); end if;
  if inv.expires_at <= now() then perform public.household_refuse('invite_expired'); end if;
  perform 1 from public.households h where h.id = inv.household_id and h.deleted_at is null for update;
  if not found then perform public.household_refuse('invite_cancelled'); end if;

  select l.household, l.my_role into home, my_role from public.lock_my_household() l;
  if home = inv.household_id then perform public.household_refuse('already_member'); end if;
  select count(*) into others from public.memberships m
  where m.household_id = home and m.user_id <> public.auth_user_id() and m.deleted_at is null;
  if others > 0 and my_role = 'admin' and not exists (
       select 1 from public.memberships m
       where m.household_id = home and m.role = 'admin' and m.user_id <> public.auth_user_id()
         and m.deleted_at is null) then
    perform public.household_refuse('only_admin');
  end if;

  if others = 0 then
    -- Alone: everything of the old household comes along (spec §4).
    set constraints all deferred;
    -- Share photo copies are files named by the share id (ADR-0016), so they move too.
    photos_moved := array(select p.id from public.photos p where p.household_id = home)
      || array(select sh.id from public.shares sh
               where sh.household_id = home and jsonb_typeof(sh.snapshot -> 'photo') = 'object');
    update public.recipes r set household_id = inv.household_id where r.household_id = home;
    get diagnostics recipes_moved = row_count;
    update public.photos p set household_id = inv.household_id where p.household_id = home;
    update public.imports i set household_id = inv.household_id where i.household_id = home;
    update public.substitutions s set household_id = inv.household_id where s.household_id = home;
    update public.favorites f set household_id = inv.household_id where f.household_id = home;
    update public.shares sh set household_id = inv.household_id where sh.household_id = home;
    update public.households h set deleted_at = now() where h.id = home;
    update public.invites i set deleted_at = now()
    where i.household_id = home and i.accepted_at is null and i.deleted_at is null;
  else
    update public.favorites f set deleted_at = now()
    where f.user_id = public.auth_user_id() and f.household_id = home and f.deleted_at is null;
  end if;

  update public.memberships m
  set household_id = inv.household_id, role = inv.role, email = coalesce(mail, m.email)
  where m.user_id = public.auth_user_id();
  update public.invites i set accepted_at = now(), accepted_by = public.auth_user_id() where i.id = inv.id;
  return query select inv.household_id, home, recipes_moved, photos_moved;
end;
$$;

create or replace function public.set_member_role(target uuid, new_role public.household_role) returns void
language plpgsql security definer set search_path = '' as $$
declare
  home uuid;
  my_role public.household_role;
  target_role public.household_role;
begin
  select l.household, l.my_role into home, my_role from public.lock_my_household() l;
  if my_role <> 'admin' then perform public.household_refuse('forbidden'); end if;
  select m.role into target_role from public.memberships m
  where m.user_id = target and m.household_id = home and m.deleted_at is null;
  if target_role is null then perform public.household_refuse('not_member'); end if;
  if target_role = 'admin' and new_role <> 'admin' and (
       select count(*) from public.memberships m
       where m.household_id = home and m.role = 'admin' and m.deleted_at is null) <= 1 then
    perform public.household_refuse('last_admin');
  end if;
  update public.memberships set role = new_role where user_id = target;
end;
$$;

create or replace function public.remove_member(target uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  home uuid;
  my_role public.household_role;
begin
  select l.household, l.my_role into home, my_role from public.lock_my_household() l;
  if my_role <> 'admin' then perform public.household_refuse('forbidden'); end if;
  if target = public.auth_user_id() then perform public.household_refuse('forbidden'); end if;
  if not exists (select 1 from public.memberships m
                 where m.user_id = target and m.household_id = home and m.deleted_at is null) then
    perform public.household_refuse('not_member');
  end if;
  perform public.move_to_new_household(target);
end;
$$;

create or replace function public.leave_household() returns void
language plpgsql security definer set search_path = '' as $$
declare
  home uuid;
  my_role public.household_role;
begin
  select l.household, l.my_role into home, my_role from public.lock_my_household() l;
  if not exists (select 1 from public.memberships m
                 where m.household_id = home and m.user_id <> public.auth_user_id()
                   and m.deleted_at is null) then
    perform public.household_refuse('alone');
  end if;
  if my_role = 'admin' and not exists (
       select 1 from public.memberships m
       where m.household_id = home and m.role = 'admin' and m.user_id <> public.auth_user_id()
         and m.deleted_at is null) then
    perform public.household_refuse('only_admin');
  end if;
  perform public.move_to_new_household(public.auth_user_id());
end;
$$;

-- Everyone who can make a friend link sees the household's links (FR-6).
drop policy friend_links_select on public.friend_links;
create policy friend_links_select on public.friend_links
for select to authenticated
using (household_id = (select public.auth_household_id()));

-- Any member of the household, viewers too, ends one of its live links at once.
create function public.revoke_friend_link(link_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  home uuid;
begin
  select l.household into home from public.lock_my_household() l;
  update public.friend_links f set deleted_at = now()
  where f.id = link_id and f.household_id = home and f.deleted_at is null and f.expires_at > now();
  if not found then perform public.household_refuse('link_unknown'); end if;
end;
$$;

-- Called signed out (asAnonymous) by the /welcome page. Says only live, ended or unknown.
create function public.friend_link_status(link_code text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  link public.friend_links;
  open boolean;
begin
  select * into link from public.friend_links f
  where f.token_hash = sha256(convert_to(coalesce(link_code, ''), 'UTF8'));
  if not found then return 'unknown'; end if;
  select h.deleted_at is null into open from public.households h where h.id = link.household_id;
  return case when link.deleted_at is null and link.expires_at > now() and open then 'live' else 'ended' end;
end;
$$;

revoke execute on function public.revoke_friend_link(uuid), public.friend_link_status(text) from public;
grant execute on function public.revoke_friend_link(uuid), public.friend_link_status(text) to authenticated;

-- migrate:down
-- Roll forward: the earlier bodies counted removed memberships.
select 1;
```

- [ ] **Step 5: Add the refusal key.** In `packages/domain/src/household.ts`, add `'link_unknown',` after `'too_many_invites',` in `HOUSEHOLD_ERRORS`.

- [ ] **Step 6: Apply and run the tests**

Run: `pnpm dev:backend && pnpm vitest run -c vitest.integration.config.ts apps/api/tests/rls/household.test.ts apps/api/tests/rls/signup-gate.test.ts` (`pnpm dev:backend` applies new migrations; never `db:reset`).

Expected: PASS, every test in both files.

- [ ] **Step 7: Run the whole RLS suite**

Run: `pnpm test:rls`

Expected: PASS (132 + 3 new = 135).

- [ ] **Step 8: Commit**

```bash
git add db/migrations/20261026000000_fix_member_counts_and_revoke_friend_links.sql packages/domain/src/household.ts apps/api/tests/rls/household.test.ts apps/api/tests/rls/signup-gate.test.ts
git commit -m "fix(household): removed memberships never count; friend links listed to all and revocable (FR-3, FR-6, ADR-0015)"
```

---

### Task 2: Friend links in the API and the app

**Files:**
- Modify:
  - `apps/api/src/household/service.ts`, `apps/api/src/household/routes.ts`;
  - `apps/api/src/signup/service.ts`, `apps/api/src/signup/routes.ts`;
  - `apps/mobile/src/household/api.ts`, `apps/mobile/src/session/signupPass.ts`;
  - `apps/mobile/src/screens/HouseholdScreen.tsx`, `apps/mobile/src/screens/WelcomeScreen.tsx`.
- Test:
  - `apps/api/src/household/routes.test.ts`, `apps/api/src/signup/routes.test.ts`;
  - `apps/mobile/src/session/signupPass.test.ts`;
  - `apps/api/tests/household/household.test.ts`;
  - `e2e/signup-gate.spec.ts`.

**Interfaces:**
- Consumes (Task 1): `revoke_friend_link`, `friend_link_status`, and the `link_unknown` key.
- Produces:
  - `HouseholdService.listFriendLinks(token): Promise<FriendLink[]>`, where `FriendLink = { id: string; created_at: string; expires_at: string }`;
  - `HouseholdService.revokeFriendLink(token, id): Promise<void>`;
  - `SignupService.friendLinkStatus(code): Promise<'live' | 'ended' | 'unknown'>`;
  - routes:
    - `GET /api/friend-links` → `FriendLink[]`;
    - `DELETE /api/friend-links/:id` → 204, or 404 `link_unknown`;
    - `POST /api/friend-links/status` `{ code }`, signed out, → `{ status }`;
  - mobile:
    - `listFriendLinks(deps)` and `revokeFriendLink(id, deps)` in `household/api.ts`;
    - `friendLinkStatus(code, deps)` and `FRIEND_LINK_ENDED` in `session/signupPass.ts`.
  - Task 6 adds `limitIp` to `registerSignupRoutes`. This task passes `limitCode` only.

- [ ] **Step 1: Write the failing route tests.**
  - In `apps/api/src/household/routes.test.ts`, add to the mock in `app()`:

```ts
    listFriendLinks: vi.fn().mockResolvedValue([{ id: 'f1', created_at: 'a', expires_at: 'b' }]),
    revokeFriendLink: vi.fn().mockResolvedValue(undefined),
```

  - and these tests:

```ts
it('lists friend links and revokes one; an unknown link is 404', async () => {
  const { hono, household } = app({
    revokeFriendLink: vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new HouseholdRefusal('link_unknown')),
  });
  const listed = await send(hono, 'GET', '/api/friend-links');
  expect(await listed.json()).toEqual([{ id: 'f1', created_at: 'a', expires_at: 'b' }]);
  expect((await send(hono, 'DELETE', `/api/friend-links/${USER}`)).status).toBe(204);
  expect(household.revokeFriendLink).toHaveBeenCalledWith('jwt', USER);
  const gone = await send(hono, 'DELETE', `/api/friend-links/${USER}`);
  expect(gone.status).toBe(404);
  expect(await gone.json()).toEqual({ error: 'link_unknown' });
  expect((await send(hono, 'DELETE', '/api/friend-links/not-a-guid')).status).toBe(404);
});
```

  - In `apps/api/src/signup/routes.test.ts`, change `app()` so the signup mock is `{ grant, friendLinkStatus: vi.fn(async () => status) }`, with a `status: 'live' | 'ended' | 'unknown' = 'live'` parameter, and return a `check` helper:

```ts
function app(granted = true, limit = 100, status: 'live' | 'ended' | 'unknown' = 'live') {
  const grant = vi.fn(async () => granted);
  const friendLinkStatus = vi.fn(async () => status);
  const hono = new Hono();
  registerSignupRoutes(hono, {
    signup: { grant, friendLinkStatus },
    limitEmail: createRateLimiter({ limit, windowMs: 60_000 }),
    limitCode: createRateLimiter({ limit, windowMs: 60_000 }),
  });
  const post = (body: unknown) =>
    hono.request('/api/signup-pass', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const check = (body: unknown) =>
    hono.request('/api/friend-links/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  return { grant, friendLinkStatus, post, check };
}

it('says whether a friend link is live, signed out, and refuses a malformed code', async () => {
  const ended = app(true, 100, 'ended');
  const response = await ended.check({ code: CODE });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: 'ended' });
  expect(ended.friendLinkStatus).toHaveBeenCalledWith(CODE);
  expect((await ended.check({ code: 'short' })).status).toBe(400);
});

it('friend link checks share the per-link limit', async () => {
  const { check } = app(true, 1);
  await check({ code: CODE });
  expect((await check({ code: CODE })).status).toBe(429);
});
```

- [ ] **Step 2: Write the failing mobile test.** Append to `apps/mobile/src/session/signupPass.test.ts`:

```ts
it('reads a friend link status; offline or an error reads as live', async () => {
  const reply = (status: number, body: unknown) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status }));
  const deps = (fetch: typeof globalThis.fetch) => ({ fetch, apiUrl: 'https://x/api' });
  const ended = reply(200, { status: 'ended' });
  expect(await friendLinkStatus(B, deps(ended))).toBe('ended');
  expect(ended).toHaveBeenCalledWith(
    'https://x/api/friend-links/status',
    expect.objectContaining({ method: 'POST', body: JSON.stringify({ code: B }) }),
  );
  expect(await friendLinkStatus(B, deps(reply(200, { status: 'unknown' })))).toBe('ended');
  expect(await friendLinkStatus(B, deps(reply(500, {})))).toBe('live');
  const down = vi.fn(async () => Promise.reject(new TypeError('offline')));
  expect(await friendLinkStatus(B, deps(down))).toBe('live');
});
```

  - and add `friendLinkStatus` to the import from `./signupPass`.

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm vitest run apps/api/src/household/routes.test.ts apps/api/src/signup/routes.test.ts && pnpm vitest run apps/mobile/src/session/signupPass.test.ts`

Expected: FAIL. The new route tests get 404s, and `friendLinkStatus is not a function`. TypeScript complaints about the mock shapes are expected until Step 4.

- [ ] **Step 4: Implement the API.**
  - In `apps/api/src/household/service.ts`:
    - add `export type FriendLink = { id: string; created_at: string; expires_at: string };`;
    - add the two members to `HouseholdService`:

```ts
  /** FR-6: the household's live friend links; every role may see them. */
  listFriendLinks(token: string): Promise<FriendLink[]>;
  revokeFriendLink(token: string, id: string): Promise<void>;
```

  - and to the returned object:

```ts
    listFriendLinks: (token) =>
      run(token, async (tx) => {
        // friend_links_select limits this to the caller's household.
        const rows = await tx<{ id: string; created_at: Date; expires_at: Date }[]>`
          select id, created_at, expires_at from public.friend_links
          where deleted_at is null and expires_at > now()
          order by created_at desc`;
        return rows.map((row) => ({
          id: row.id,
          created_at: iso(row.created_at),
          expires_at: iso(row.expires_at),
        }));
      }),

    async revokeFriendLink(token, id) {
      await run(token, (tx) => tx`select public.revoke_friend_link(${id}::uuid)`);
    },
```

  - In `apps/api/src/household/routes.ts`, after the `POST /api/friend-links` route:

```ts
  app.get('/api/friend-links', (c) =>
    handle(c, async (token) => c.json(await household.listFriendLinks(token))),
  );
  app.delete('/api/friend-links/:id', (c) =>
    handle(
      c,
      async (token) => {
        if (!isGuid(c.req.param('id'))) return c.json({ error: 'not_found' }, 404);
        await household.revokeFriendLink(token, c.req.param('id'));
        return c.body(null, 204);
      },
      ['link_unknown'],
    ),
  );
```

  - In `apps/api/src/signup/service.ts`, add `friendLinkStatus(code: string): Promise<'live' | 'ended' | 'unknown'>;` to `SignupService`, and implement it:

```ts
    async friendLinkStatus(code) {
      const [row] = await deps.asAnonymous(
        (tx) => tx<{ status: string }[]>`select public.friend_link_status(${code}) as status`,
      );
      return row?.status === 'live' || row?.status === 'ended' ? row.status : 'unknown';
    },
```

  - In `apps/api/src/signup/routes.ts`, add inside `registerSignupRoutes`:

```ts
  // FR-6: lets /welcome/<code> say a link has ended before anyone types an email.
  app.post('/api/friend-links/status', async (c) => {
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    const code = body?.code;
    if (typeof code !== 'string' || !CODE.test(code)) return c.json({ error: 'invalid_body' }, 400);
    if (!deps.limitCode(code)) return c.json({ error: 'too_many' }, 429);
    return c.json({ status: await deps.signup.friendLinkStatus(code) });
  });
```

  - Update the `signup` stub in `apps/api/src/app.test.ts`, if it builds one, with `friendLinkStatus: async () => 'live'`.

- [ ] **Step 5: Implement the mobile calls.**
  - In `apps/mobile/src/household/api.ts`:
    - add `link_unknown: 'This link has already ended',` to `HOUSEHOLD_MESSAGES`;
    - add:

```ts
export type FriendLink = { id: string; created_at: string; expires_at: string };
export const listFriendLinks = (deps: ApiDeps) =>
  request<FriendLink[]>(deps, 'GET', '/friend-links');
export const revokeFriendLink = (id: string, deps: ApiDeps) =>
  request<void>(deps, 'DELETE', `/friend-links/${id}`);
```

  - In `apps/mobile/src/session/signupPass.ts`:

```ts
export const FRIEND_LINK_ENDED = 'This link has ended. Ask for a new one.';

/**
 * Whether a friend link still works, asked signed out. Only a definite "no"
 * reads as ended; offline or a server error leaves it to the pass check.
 */
export async function friendLinkStatus(
  code: string,
  deps: { fetch: typeof fetch; apiUrl: string },
): Promise<'live' | 'ended'> {
  try {
    const response = await deps.fetch(`${deps.apiUrl}/friend-links/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    if (!response.ok) return 'live';
    const json = (await response.json().catch(() => null)) as { status?: string } | null;
    return json?.status === 'ended' || json?.status === 'unknown' ? 'ended' : 'live';
  } catch {
    return 'live';
  }
}
```

- [ ] **Step 6: Run the unit tests**

Run: `pnpm vitest run apps/api/src/household/routes.test.ts apps/api/src/signup/routes.test.ts && pnpm vitest run apps/mobile/src/session/signupPass.test.ts`

Expected: PASS.

- [ ] **Step 7: Write the failing API and e2e tests.**
  - Append to `apps/api/tests/household/household.test.ts`, inside `describe('household endpoints', …)`:

```ts
  it('friend links are listed to a viewer and revoked once; then the link reads as ended', async () => {
    const admin = await fresh();
    const viewer = await fresh();
    await call(viewer, 'POST', '/invites/accept', { token: await invite(admin, 'viewer') });
    const viewerNow = await signInFresh(viewer.email);
    const made = await call(viewerNow, 'POST', '/friend-links', {});
    const { code } = (await made.json()) as { code: string };
    const listed = (await (await call(admin, 'GET', '/friend-links')).json()) as { id: string }[];
    expect(listed).toHaveLength(1);
    expect((await call(viewerNow, 'DELETE', `/friend-links/${listed[0]!.id}`)).status).toBe(204);
    expect((await call(admin, 'DELETE', `/friend-links/${listed[0]!.id}`)).status).toBe(404);
    const status = await fetch(`${env.apiUrl}/friend-links/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    expect(await status.json()).toEqual({ status: 'ended' });
  });
```

  - Append to `e2e/signup-gate.spec.ts`:

```ts
test('a friend link is listed on Household; once revoked, its page says it has ended (FR-6)', async ({
  page,
  browser,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  page.on('dialog', (dialog) => void dialog.accept());
  await signIn(page, freshEmail('friend-revoke'));
  await page.getByRole('link', { name: 'Household', exact: true }).click();
  await page.getByRole('button', { name: 'Invite a friend to Dishkept' }).click();
  await expect(page.getByText('Link copied')).toBeVisible();
  const url = await page.evaluate(() => navigator.clipboard.readText());
  await expect(page.getByText(/^Expires in 30 days/)).toBeVisible();
  await page.getByRole('button', { name: /^Revoke link/ }).click();
  await expect(page.getByRole('button', { name: /^Revoke link/ })).toHaveCount(0);

  const friend = await (await browser.newContext()).newPage();
  await friend.goto(url);
  await expect(friend.getByText('This link has ended. Ask for a new one.')).toBeVisible();
  await friend.context().close();
});
```

- [ ] **Step 8: Run them to verify they fail**

Run: `pnpm dev:backend:test && pnpm vitest run -c vitest.integration.config.ts apps/api/tests/household/household.test.ts -t "friend links" && pnpm test:e2e -- e2e/signup-gate.spec.ts -g "revoked"`

Expected:
- the API test: FAIL until the API image is rebuilt with Step 4 (`pnpm dev:backend:test` rebuilds it), then PASS;
- the e2e: FAIL, with `getByText(/^Expires in 30 days/)` not found.

- [ ] **Step 9: Implement the Household section.** In `apps/mobile/src/screens/HouseholdScreen.tsx`:
  - import `listFriendLinks`, `revokeFriendLink` and `type FriendLink`;
  - add state, and a loader that runs for every role:

```tsx
  const [friendLinks, setFriendLinks] = useState<FriendLink[]>([]);
  const refreshFriendLinks = useCallback(async () => {
    if (!online) return;
    const result = await withSession(listFriendLinks);
    if (result?.ok) setFriendLinks(result.value);
  }, [online]);
  useEffect(() => void refreshFriendLinks(), [refreshFriendLinks]);
```

  - In the "Invite a friend to Dishkept" handler, call `void refreshFriendLinks();` after `shareLink` returns.
  - Directly after that button, inside the same `online ?` branch, so the fragment holds the button and the list, render:

```tsx
          {friendLinks.length > 0 ? (
            <Card title="Friend links" level={3}>
              {friendLinks.map((link) => {
                const made = new Date(link.created_at).toLocaleDateString();
                return (
                  <View
                    key={link.id}
                    style={{ flexDirection: 'row', gap: space.md, alignItems: 'center' }}
                  >
                    <Text tone="muted" style={{ flex: 1 }}>
                      Expires in {days(link.expires_at)} days · made {made}
                    </Text>
                    <Button
                      variant="ghost"
                      label="Revoke"
                      aria-label={`Revoke link made ${made}`}
                      onPress={async () => {
                        if (
                          !(await confirm(
                            'Revoke this link? Anyone who has it can no longer use it to join Dishkept.',
                          ))
                        )
                          return;
                        await act(
                          () => withSession((deps) => revokeFriendLink(link.id, deps)),
                          () => void refreshFriendLinks(),
                        );
                      }}
                    />
                  </View>
                );
              })}
            </Card>
          ) : null}
```

  - Wrap the existing `<Button … label="Invite a friend to Dishkept" … />` and this block in a fragment (`<>…</>`).
  - `Card` accepts `level` already (see `SharedLinks.tsx`).

- [ ] **Step 10: Implement the Welcome page.** Replace the body of `apps/mobile/src/screens/WelcomeScreen.tsx`:

```tsx
import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { config } from '../config';
import { setPendingFriend } from '../session/pendingFriend';
import { useSession } from '../session/SessionProvider';
import { FRIEND_LINK_ENDED, friendLinkStatus } from '../session/signupPass';
import { SignInScreen } from './SignInScreen';

/** FR-6: a friend link. Signed out, it is sign-in with a pass to make an account. */
export function WelcomeScreen({ code }: { code: string }) {
  const { state } = useSession();
  const [ended, setEnded] = useState(false);
  useEffect(() => {
    if (state.status !== 'signedOut') return;
    let live = true;
    void friendLinkStatus(code, {
      fetch: (input, init) => fetch(input, init),
      apiUrl: config.apiUrl,
    }).then((status) => {
      if (!live) return;
      // An ended link is not kept: a sign-up through it would only be refused.
      if (status === 'ended') setEnded(true);
      else setPendingFriend(code);
    });
    return () => {
      live = false;
    };
  }, [state.status, code]);
  if (state.status === 'loading') return null;
  if (state.status === 'signedIn') return <Redirect href="/" />;
  return (
    <SignInScreen
      intro={ended ? FRIEND_LINK_ENDED : 'Someone invited you to make your own recipe collection.'}
    />
  );
}
```

- [ ] **Step 11: Run the e2e tests**

Run: `pnpm test:e2e -- e2e/signup-gate.spec.ts`

Expected: PASS, every test in the file. The existing dead-link test still sees "This link has expired. Ask for a new one." after typing an email.

- [ ] **Step 12: Typecheck, lint, commit**

Run: `pnpm lint && pnpm typecheck`
Expected: clean.

```bash
git add apps/api/src/household apps/api/src/signup apps/api/src/app.test.ts apps/mobile/src/household/api.ts apps/mobile/src/session/signupPass.ts apps/mobile/src/session/signupPass.test.ts apps/mobile/src/screens/HouseholdScreen.tsx apps/mobile/src/screens/WelcomeScreen.tsx apps/api/tests/household/household.test.ts e2e/signup-gate.spec.ts
git commit -m "feat(household): list and revoke friend links; an ended link says so (FR-6)"
```

---

### Task 3: Join, notices, resume and the owner key

**Files:**
- Create:
  - `apps/mobile/src/household/refreshLoop.ts`, `apps/mobile/src/household/refreshLoop.test.ts`;
  - `apps/mobile/src/session/useResume.ts`.
- Modify:
  - `apps/mobile/src/household/notice.ts`, `apps/mobile/src/household/notice.test.ts`;
  - `apps/mobile/src/components/HouseholdNoticeBanner.tsx`, `apps/mobile/src/screens/InviteScreen.tsx`;
  - `apps/mobile/src/household/useMembershipWatch.ts`;
  - `apps/mobile/src/session/sessionState.ts`, `apps/mobile/src/session/sessionState.test.ts`;
  - `apps/mobile/src/db/DatabaseSessionBridge.tsx`;
  - `apps/mobile/app/index.tsx`, `apps/mobile/app/sign-in.tsx`;
  - `apps/mobile/src/screens/RecipeScreen.tsx`.
- Test: `e2e/household.spec.ts`

**Interfaces:**
- Produces:
  - `HouseholdNotice = { kind: 'joined' | 'moved'; name: string | null; householdId: string | null }`;
  - `takeNoticeFor(householdId: string): HouseholdNotice | null`, which leaves a notice for another household in place;
  - `startRefreshLoop(refresh: () => Promise<{ error: unknown }>, state: RetryState): () => void`, where the returned function stops the loop;
  - `ownerToRecord(session: { userId: string; householdId: string | null }, stored: string | null): string`;
  - `useResumeAfterSignIn(): string | null | undefined`, where `undefined` means not read yet.

- [ ] **Step 1: Write the failing unit tests.**
  - Replace `apps/mobile/src/household/notice.test.ts`'s imports and add, keeping the existing tests but adding `householdId: null` to every `setNotice` call:

```ts
it('a notice for another household waits until the claims name it (a failed refresh after Join)', () => {
  setNotice({ kind: 'joined', name: 'Gelpi household', householdId: 'h-new' });
  expect(takeNoticeFor('h-old')).toBeNull();
  expect(hasNotice()).toBe(true);
  expect(takeNoticeFor('h-new')).toEqual({
    kind: 'joined',
    name: 'Gelpi household',
    householdId: 'h-new',
  });
  expect(hasNotice()).toBe(false);
});

it('a notice without a household is taken anywhere', () => {
  setNotice({ kind: 'moved', name: null, householdId: null });
  expect(takeNoticeFor('h-any')?.kind).toBe('moved');
});
```

  - (If `notice.test.ts` has no sessionStorage stub, copy the `memory` stub from `signupPass.test.ts` into it.)
  - Create `apps/mobile/src/household/refreshLoop.test.ts`:

```ts
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { newRetryState, startRefreshLoop } from './refreshLoop';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('retries a failed refresh with a growing delay, and stops on success', async () => {
  const refresh = vi
    .fn<() => Promise<{ error: unknown }>>()
    .mockResolvedValueOnce({ error: new Error('offline') })
    .mockResolvedValueOnce({ error: null });
  startRefreshLoop(refresh, newRetryState());
  await vi.advanceTimersByTimeAsync(0);
  expect(refresh).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(refresh).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(600_000);
  expect(refresh).toHaveBeenCalledTimes(2);
});

it('a refresh that fails after the loop was stopped schedules nothing', async () => {
  let fail!: (value: { error: unknown }) => void;
  const refresh = vi.fn(() => new Promise<{ error: unknown }>((resolve) => (fail = resolve)));
  const stop = startRefreshLoop(refresh, newRetryState());
  stop();
  fail({ error: new Error('offline') });
  await vi.advanceTimersByTimeAsync(600_000);
  expect(refresh).toHaveBeenCalledTimes(1);
});
```

  - Append to `apps/mobile/src/session/sessionState.test.ts` (import `ownerToRecord`):

```ts
it('a session with no claims keeps the stored owner key of the same user', () => {
  expect(ownerToRecord({ userId: 'u1', householdId: null }, 'u1:h1')).toBe('u1:h1');
  expect(ownerToRecord({ userId: 'u1', householdId: null }, null)).toBe('u1');
  expect(ownerToRecord({ userId: 'u1', householdId: null }, 'u2:h9')).toBe('u1');
  expect(ownerToRecord({ userId: 'u1', householdId: 'h2' }, 'u1:h1')).toBe('u1:h2');
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run apps/mobile/src/household/notice.test.ts apps/mobile/src/household/refreshLoop.test.ts apps/mobile/src/session/sessionState.test.ts`

Expected: FAIL, with `takeNoticeFor is not a function`, a missing `./refreshLoop` module, and `ownerToRecord is not a function`.

- [ ] **Step 3: Extract the loop as it is today**, so the stop test can fail for the right reason. Create `apps/mobile/src/household/refreshLoop.ts`:

```ts
export type RetryState = { at: number; delay: number; busy: boolean };

const FIRST_DELAY_MS = 5_000;
const MAX_DELAY_MS = 5 * 60 * 1000;

export const newRetryState = (): RetryState => ({ at: 0, delay: FIRST_DELAY_MS, busy: false });

/**
 * Refreshes the token, retrying with backoff while it fails (spec §6, Review
 * Focus 5). The state outlives one loop, so a new loop keeps the backoff.
 * Returns stop.
 */
export function startRefreshLoop(
  refresh: () => Promise<{ error: unknown }>,
  state: RetryState,
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const attempt = () => {
    if (state.busy) return;
    const wait = state.at - Date.now();
    if (wait > 0) {
      timer = setTimeout(attempt, wait);
      return;
    }
    state.busy = true;
    void refresh().then(({ error }) => {
      state.busy = false;
      if (error) {
        state.at = Date.now() + state.delay;
        state.delay = Math.min(MAX_DELAY_MS, state.delay * 2);
        timer = setTimeout(attempt, state.delay);
      } else {
        state.delay = FIRST_DELAY_MS;
      }
    });
  };
  attempt();
  return () => clearTimeout(timer);
}
```

  Run: `pnpm vitest run apps/mobile/src/household/refreshLoop.test.ts`

  Expected: the first test PASSES; the stop test FAILS with `expected 2 to be 1` (or more): the failed refresh scheduled a retry after stop.

- [ ] **Step 4: Make stop final.** In `startRefreshLoop`:
  - add `let stopped = false;` after `let timer`;
  - start `attempt` with `if (stopped || state.busy) return;`;
  - in the `.then`, after `state.busy = false;`, add `if (stopped) return;`;
  - return:

```ts
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
```

  - Then replace the body of `useMembershipWatch` with the loop:

```ts
import { useQuery } from '@powersync/react';
import { useEffect, useRef } from 'react';
import { auth } from '../session/auth';
import type { Claims } from '../session/claims';
import { membershipAction } from './membership';
import { newRetryState, startRefreshLoop } from './refreshLoop';

const MEMBERSHIP_SQL = 'select household_id, role from memberships where user_id = ?';

/**
 * Refreshes the token when this user's synced membership no longer matches
 * it, so a role change or a move takes effect on the phone (spec §6). Retries
 * with backoff while offline (Review Focus 5); nothing runs after cleanup.
 */
export function useMembershipWatch(claims: Claims | null, enabled: boolean): void {
  const { data } = useQuery<{ household_id: string; role: string }>(MEMBERSHIP_SQL, [
    claims?.userId ?? '',
  ]);
  const retry = useRef(newRetryState());
  const row = data[0];
  const action = claims && enabled ? membershipAction(row, claims) : 'none';

  useEffect(() => {
    if (action !== 'refresh') return;
    return startRefreshLoop(() => auth.refreshSession(), retry.current);
  }, [action, row?.household_id, row?.role]);
}
```

- [ ] **Step 5: Implement the notice and the owner key.**
  - In `apps/mobile/src/household/notice.ts`:
    - change the type to `{ kind: 'joined' | 'moved'; name: string | null; householdId: string | null }`;
    - have `takeNotice`'s parse also read `householdId: typeof value.householdId === 'string' ? value.householdId : null`;
    - add:

```ts
/**
 * The notice for the household the claims now name. A Join's notice waits
 * while the token still names the old household (its refresh failed), so the
 * person later reads "joined", not "moved".
 */
export function takeNoticeFor(householdId: string): HouseholdNotice | null {
  const raw = globalThis.sessionStorage?.getItem(KEY);
  if (raw == null) return null;
  try {
    const value = JSON.parse(raw) as { householdId?: unknown } | null;
    if (typeof value?.householdId === 'string' && value.householdId !== householdId) return null;
  } catch {
    // Unreadable: taken below and dropped.
  }
  return takeNotice();
}
```

  - In `apps/mobile/src/session/sessionState.ts`, after `ownerKey`:

```ts
/**
 * The owner key to store once settled. A session with no claims says nothing
 * about the household, so it keeps the same user's stored key; rewriting it
 * would make the next session with claims look like a move and wipe.
 */
export function ownerToRecord(
  session: { userId: string; householdId: string | null },
  stored: string | null,
): string {
  if (session.householdId === null && stored !== null && ownerUser(stored) === session.userId) {
    return stored;
  }
  return ownerKey(session.userId, session.householdId);
}
```

  - `ownerUser` is declared below `ownerKey`, so move its `const` above `ownerToRecord`.
  - In `apps/mobile/src/db/DatabaseSessionBridge.tsx`:
    - import `ownerToRecord`;
    - replace `dbOwner.set(ownerKey(session.userId, session.householdId));` with `dbOwner.set(ownerToRecord(session, dbOwner.get()));`. Keep `setReadyFor(ownerKey(…))` as it is: it gates rendering on the session in hand;
    - change the moved notice to `setNotice({ kind: 'moved', name: null, householdId: session.householdId });`.

- [ ] **Step 6: Run the unit tests**

Run: `pnpm vitest run apps/mobile/src/household apps/mobile/src/session`

Expected: PASS.

- [ ] **Step 7: Write the failing e2e.** Append to `e2e/household.spec.ts`, adding imports for `watchMailbox` from `'../test-support/mail'` and `env` from `'../test-support/env'` if the file lacks them:

```ts
test('an invite opened signed out resumes after sign-in, and a double tap on Join joins once (FR-3)', async ({
  page,
  browser,
}) => {
  await signIn(page, freshEmail('resume-admin'));
  await page.getByRole('link', { name: 'Household', exact: true }).click();
  await page.getByRole('button', { name: 'Share invite' }).click();
  const url = (await page.getByLabel('Invite link').textContent())!.trim();

  const guest = await (await browser.newContext()).newPage();
  await guest.goto(url);
  await guest.getByRole('link', { name: 'Sign in' }).click();
  const email = freshEmail('resume-guest');
  const mailbox = await watchMailbox(env.mailUrl, email);
  await guest.getByLabel('Email').fill(email);
  await guest.getByRole('button', { name: 'Send code' }).click();
  await guest.getByLabel('Code').fill(await mailbox.nextCode());
  await guest.getByRole('button', { name: 'Sign in' }).click();
  const join = guest.getByRole('button', { name: 'Join' });
  await expect(join).toBeVisible();

  let accepts = 0;
  guest.on('request', (request) => {
    if (request.url().endsWith('/api/invites/accept')) accepts += 1;
  });
  await join.dblclick();
  await expect(guest.getByText(/^You've joined the /)).toBeVisible({ timeout: 30_000 });
  expect(accepts).toBe(1);
  await guest.context().close();
});
```

- [ ] **Step 8: Run it to verify it fails**

Run: `pnpm test:e2e -- e2e/household.spec.ts -g "resumes after sign-in"`

Expected: FAIL with `expected 2 to be 1` (the second tap posts again). If it passes at this step, record a ledger ruling that the double tap was not reproducible in e2e, and keep the test as a guard.

- [ ] **Step 9: Guard Join, and read in effects.**
  - In `apps/mobile/src/screens/InviteScreen.tsx`:
    - import `useRef`;
    - in `SignedInInvite`, add `const busy = useRef(false);`;
    - start `join()` with `if (!preview || busy.current) return; busy.current = true;`;
    - on each failure path, set `busy.current = false;` next to `setJoining(false)`;
    - pass the household to the notice: `setNotice({ kind: 'joined', name: preview.household_name, householdId: result.value.household_id });`.
  - Replace `apps/mobile/src/components/HouseholdNoticeBanner.tsx`'s state line with an effect:

```tsx
import { useEffect, useState } from 'react';
import { useHouseholdName } from '../household/hooks';
import { takeNoticeFor, type HouseholdNotice } from '../household/notice';
import type { Claims } from '../session/claims';
import { Banner } from '../ui';

/** "You've joined the …" / "You were moved to the …", once (spec §6). */
export function HouseholdNoticeBanner({ claims }: { claims: Claims }) {
  const [notice, setShown] = useState<HouseholdNotice | null>(null);
  // Read in an effect, not in render: a render can run twice, and the second
  // would find the notice already taken.
  useEffect(() => {
    const next = takeNoticeFor(claims.householdId);
    if (next) setShown(next);
  }, [claims.householdId]);
  const synced = useHouseholdName(claims.householdId);
  if (!notice) return null;
  const name = notice.name ?? synced ?? 'new household';
  return (
    <Banner>
      {notice.kind === 'joined' ? `You've joined the ${name}` : `You were moved to the ${name}`}
    </Banner>
  );
}
```

  - Create `apps/mobile/src/session/useResume.ts`:

```ts
import { useEffect, useRef, useState } from 'react';
import { resumeAfterSignIn } from './resume';

/**
 * Where to go after sign-in, read once in an effect (it consumes the pending
 * invite). undefined until read.
 */
export function useResumeAfterSignIn(): string | null | undefined {
  const [target, setTarget] = useState<string | null | undefined>(undefined);
  const read = useRef(false);
  useEffect(() => {
    if (read.current) return;
    read.current = true;
    setTarget(resumeAfterSignIn());
  }, []);
  return target;
}
```

  - In `apps/mobile/app/index.tsx`, `Home` becomes:

```tsx
function Home({ claims }: { claims: Claims }) {
  const resume = useResumeAfterSignIn();
  if (resume === undefined) return null;
  if (resume) return <Redirect href={resume} />;
  return <RecipeListScreen claims={claims} />;
}
```

  - Import `useResumeAfterSignIn` from `'../src/session/useResume'` and drop the `useState` and `resumeAfterSignIn` imports.
  - In `apps/mobile/app/sign-in.tsx`:

```tsx
import { Redirect } from 'expo-router';
import { SignInScreen } from '../src/screens/SignInScreen';
import { useResumeAfterSignIn } from '../src/session/useResume';
import { useSession } from '../src/session/SessionProvider';

// An invite or a shared recipe opened while signed out resumes after sign-in.
function Resume() {
  const resume = useResumeAfterSignIn();
  if (resume === undefined) return null;
  return <Redirect href={resume ?? '/'} />;
}

export default function SignIn() {
  const { state } = useSession();
  if (state.status === 'loading') return null;
  if (state.status === 'signedIn') return <Resume />;
  return <SignInScreen />;
}
```

  - In `apps/mobile/src/screens/RecipeScreen.tsx`, replace `const [saved] = useState(() => takeSavedFlash());` with:

```tsx
  const [saved, setSaved] = useState(false);
  // Read in an effect: a second render would find the flash already taken.
  useEffect(() => {
    if (takeSavedFlash()) setSaved(true);
  }, []);
```

- [ ] **Step 10: Run the e2e tests**

Run: `pnpm test:e2e -- e2e/household.spec.ts e2e/sharing.spec.ts e2e/signup-gate.spec.ts`

Expected: PASS. The sharing suite covers the saved flash, and the gate suite covers the invite resume with the gate on.

- [ ] **Step 11: Typecheck, lint, commit**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: clean; unit tests pass.

```bash
git add apps/mobile e2e/household.spec.ts
git commit -m "fix(household): Join posts once; the joined notice waits for the new claims; reads moved out of render; no refresh after cleanup; no claims keeps the owner key (FR-3, FR-5)"
```

---

### Task 4: Link reuses the live link; a refused share leaves no file

**Files:**
- Create:
  - `db/migrations/20261026000001_keep_share_link_codes.sql`;
  - `packages/domain/src/recipeParts.ts`, `packages/domain/src/sharing.test.ts` (append, if it exists).
- Modify:
  - `packages/domain/src/index.ts`, `packages/domain/src/sharing.ts`;
  - `apps/api/src/sharing/service.ts`, `apps/api/src/sharing/service.test.ts`.
- Test: `apps/api/tests/rls/shares.test.ts`, `apps/api/tests/sharing/sharing.test.ts`

**Interfaces:**
- Produces:
  - `shares.kept_code text`, which is null for links made before this migration;
  - `create_share(share_id, recipe, snap)`: an existing live row with this id, recipe and household, whose code was kept, gets the new snapshot and returns its code. Any other existing row with this id is refused as `forbidden`.

- [ ] **Step 1: Write the failing domain test.** Append to `packages/domain/src/sharing.test.ts`, or create it with `import { expect, it } from 'vitest';`:

```ts
import { shareSnapshotSchema } from './sharing';

it('the share snapshot schema is a plain object schema, not a lazy one', () => {
  expect(shareSnapshotSchema.def.type).toBe('object');
});
```

- [ ] **Step 2: Write the failing service tests.**
  - In `apps/api/src/sharing/service.test.ts`, let `setup` throw an `Error` value:
    - change the `rows` type to `Record<string, unknown[] | Error>`;
    - replace the return line with `const value = key ? rows[key]! : []; if (value instanceof Error) throw value; return value;`.
  - Then add:

```ts
  it('reuses the recipe’s live link: same share id, new snapshot', async () => {
    const { service, store, statements } = setup({
      'from public.shares': [{ id: 's-live' }],
      'from public.recipes': [recipeRow],
      'public.create_share(': [{ id: 's-live', token: 'k'.repeat(43) }],
    });
    expect(await service.create('jwt', RECIPE)).toEqual({ code: 'k'.repeat(43) });
    expect(vi.mocked(store.copy).mock.calls[0]?.[3]).toBe('s-live');
    expect(statements.some((sql) => sql.includes('kept_code is not null'))).toBe(true);
  });

  it('a refused new share deletes the photo it copied', async () => {
    const refused = Object.assign(new Error('forbidden'), { code: 'P0001' });
    const { service, store } = setup({
      'from public.recipes': [recipeRow],
      'public.create_share(': refused,
    });
    await expect(service.create('jwt', RECIPE)).rejects.toEqual(new ShareRefusal('forbidden'));
    const shareId = vi.mocked(store.copy).mock.calls[0]?.[3];
    expect(store.remove).toHaveBeenCalledWith('h1', shareId);
  });
```

- [ ] **Step 3: Write the failing database tests.**
  - Append to `apps/api/tests/rls/shares.test.ts`, reusing the file's existing actors and recipe helpers. If it has none, use `signInFresh`, and insert a recipe with `as(actor, tx => tx\`insert into public.recipes …\`)` as `purge.test.ts` does:

```ts
describe('kept link codes (bug batch §4)', () => {
  it('a live link is reused with the new snapshot; another household’s or a stopped link is refused', async () => {
    const cook = await signInFresh(`share-keep-${randomUUID()}@example.test`);
    const other = await signInFresh(`share-other-${randomUUID()}@example.test`);
    const recipe = randomUUID();
    await as(cook, (tx) => tx`insert into public.recipes (id, household_id, title) values (${recipe}, ${cook.householdId}, 'Kept soup')`);
    const snap = (title: string) => ({ title });
    const create = (actor: Actor, id: string, title: string) =>
      as(actor, (tx) => tx<{ id: string; token: string }[]>`
        select * from public.create_share(${id}::uuid, ${recipe}::uuid, ${tx.json(snap(title))})`);
    const id = randomUUID();
    const [first] = await create(cook, id, 'One');
    const [again] = await create(cook, id, 'Two');
    expect(again!.token).toBe(first!.token);
    const [row] = await adminSql<{ title: string; kept: string }[]>`
      select snapshot ->> 'title' as title, kept_code as kept from public.shares where id = ${id}`;
    expect(row).toEqual({ title: 'Two', kept: first!.token });
    expect(await refusalCode(create(other, id, 'Theirs'))).toBe('P0001');
    await as(cook, (tx) => tx`select public.stop_shares(${recipe}::uuid)`);
    expect(await refusalCode(create(cook, id, 'Three'))).toBe('P0001');
  });
});
```

  - If `shares_select` or the snapshot check rejects `{ title }` as too thin, use the file's existing snapshot fixture. The table only checks `jsonb_typeof(snapshot) = 'object'`.
  - Append to `apps/api/tests/sharing/sharing.test.ts`, using its helpers for a fresh cook, a recipe made through `/api/upload`, and `POST /api/shares`:

```ts
  it('Link twice gives the same code; after Stop sharing, a new one', async () => {
    const first = await shareLink(cook, recipeId);
    const second = await shareLink(cook, recipeId);
    expect(second).toBe(first);
    await stop(cook, recipeId);
    expect(await shareLink(cook, recipeId)).not.toBe(first);
  });
```

  - Name `shareLink` and `stop` after the file's existing helpers. If they don't exist, add them, each a `fetch` to `${env.apiUrl}/shares` or `/shares/stop` with the cook's bearer token, returning `(await response.json()).code`.

- [ ] **Step 4: Run them to verify they fail**

Run: `pnpm vitest run packages/domain/src/sharing.test.ts && pnpm vitest run apps/api/src/sharing/service.test.ts && pnpm vitest run -c vitest.integration.config.ts apps/api/tests/rls/shares.test.ts`

Expected: FAIL:
- domain: `expected 'lazy' to be 'object'`;
- service: the reuse test sees a random id, and `remove` is not called;
- RLS: `column "kept_code" does not exist`, or the second create returns a different token.

- [ ] **Step 5: Split the recipe parts out of index.ts.** Create `packages/domain/src/recipeParts.ts` with:
  - `import { z } from 'zod'; import { UNITS } from './ingredients'; import { RECIPE_LIMITS, TITLE_MAX } from './limits';`;
  - the `recipeTitleSchema`, `unitSchema`, `ingredientSchema`, `stepSchema` and `tagSchema` definitions, moved verbatim from `index.ts`.

  In `index.ts`:
  - delete those five definitions;
  - add `export * from './recipeParts';` after `export * from './shopping';`;
  - add `import { ingredientSchema, recipeTitleSchema, stepSchema, tagSchema } from './recipeParts';` to the imports;
  - drop the `UNITS` import if nothing else uses it.

  In `sharing.ts`:
  - import the four schemas from `'./recipeParts'`;
  - replace `z.lazy(() => z.strictObject({...}))` with `z.strictObject({...})`;
  - replace the comment with `/** FR-27, NFR-2: what a link shows; nothing else of the household. */`.

  Run: `pnpm vitest run packages/domain/src`
  Expected: PASS, all domain tests.

- [ ] **Step 6: Write the migration**

```sql
-- db/migrations/20261026000001_keep_share_link_codes.sql
-- migrate:up
-- Bug batch §4 (ADR-0016): Link hands out the recipe's live link again rather
-- than making a new one each tap, so a link's code is kept. Not synced; read
-- by the household through the API, which can make links anyway. Links made
-- before this have no kept code and are never reused.
alter table public.shares add column kept_code text;

create or replace function public.create_share(share_id uuid, recipe uuid, snap jsonb)
returns table (id uuid, token text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  home uuid := public.auth_household_id();
  existing public.shares;
  new_code text;
begin
  if home is null or not exists (
       select 1 from public.recipes r where r.id = recipe and r.household_id = home and r.deleted_at is null) then
    perform public.household_refuse('forbidden');
  end if;
  select * into existing from public.shares s where s.id = share_id for update;
  if found then
    -- Only this recipe's own live link, whose code was kept, is reused.
    if existing.household_id <> home or existing.recipe_id <> recipe
       or existing.deleted_at is not null or existing.kept_code is null then
      perform public.household_refuse('forbidden');
    end if;
    update public.shares s set snapshot = snap where s.id = share_id;
    return query select share_id, existing.kept_code;
    return;
  end if;
  new_code := translate(rtrim(encode(decode(
    replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'hex'), 'base64'), '='), '+/', '-_');
  insert into public.shares (id, household_id, recipe_id, token_hash, snapshot, kept_code)
  values (share_id, home, recipe, sha256(convert_to(new_code, 'UTF8')), snap, new_code);
  return query select share_id, new_code;
end;
$$;

-- migrate:down
-- Roll forward: the earlier body made a new link on every call.
select 1;
```

  The column is `kept_code`, not `code`. `read_share(code)` and `save_share(code)` use `#variable_conflict use_column`, so a column named `code` would silently replace their parameter.

- [ ] **Step 7: Reuse in the API.** In `apps/api/src/sharing/service.ts`:
  - widen `store` to `Pick<PhotoStore, 'copy' | 'read' | 'remove'>`;
  - in `create`, after the recipe row is checked, replace `const shareId = randomUUID();` with:

```ts
          // The recipe's live link, if its code was kept, is handed out again
          // with the latest snapshot (bug batch §4).
          const [live] = await tx<{ id: string }[]>`
            select id from public.shares
            where recipe_id = ${recipeId} and deleted_at is null and kept_code is not null
            order by created_at desc limit 1`;
          const shareId = live?.id ?? randomUUID();
```

  - replace the final `create_share` call and return with:

```ts
          const household = String(recipe.household_id);
          // A reused link whose recipe lost its photo keeps no stale copy.
          if (live && !copied) await deps.store.remove(household, shareId).catch(() => {});
          try {
            const [row] = await tx<{ token: string }[]>`
              select token from public.create_share(${shareId}, ${recipeId}, ${json(tx, snapshot)})`;
            return { code: row!.token };
          } catch (error) {
            // A refused new link must not leave its photo copy behind.
            if (copied && !live) await deps.store.remove(household, shareId).catch(() => {});
            throw error;
          }
```

  - In `apps/api/src/server.ts`, the `photoStore` passed as `store` already has `remove`.

- [ ] **Step 8: Apply and run the tests**

Run: `pnpm dev:backend && pnpm vitest run apps/api/src/sharing && pnpm vitest run -c vitest.integration.config.ts apps/api/tests/rls/shares.test.ts && pnpm dev:backend:test && pnpm vitest run -c vitest.integration.config.ts apps/api/tests/sharing/sharing.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add db/migrations/20261026000001_keep_share_link_codes.sql packages/domain/src apps/api/src/sharing apps/api/tests/rls/shares.test.ts apps/api/tests/sharing/sharing.test.ts
git commit -m "fix(sharing): Link reuses the recipe's live link; a refused share deletes its photo copy; the snapshot schema loads without z.lazy (FR-27, ADR-0016)"
```

---

### Task 5: Sharing on the phone: wait for the photo, say what failed

**Files:**
- Create: `apps/mobile/src/sharing/waitForPhoto.ts`, `apps/mobile/src/sharing/waitForPhoto.test.ts`
- Modify:
  - `apps/mobile/src/sharing/api.ts`, `apps/mobile/src/sharing/api.test.ts`;
  - `apps/mobile/src/components/ShareMenu.tsx`, `apps/mobile/src/components/SharedLinks.tsx`;
  - `apps/mobile/src/screens/SharedRecipeScreen.tsx`.
- Test: `e2e/sharing.spec.ts`

**Interfaces:**
- Consumes (Task 4): Link returns the same code for the same live recipe.
- Produces:
  - `waitForPhoto(db: { getAll<T>(sql: string, params: unknown[]): Promise<T[]> }, photoId: string, opts?: { tries?: number; pauseMs?: number; onWait?: () => void }): Promise<boolean>`;
  - `readShare` returns `{ ok: false, status: 'error' }` on a 5xx;
  - each sharing call takes a fallback message.

- [ ] **Step 1: Write the failing unit tests.**
  - Create `apps/mobile/src/sharing/waitForPhoto.test.ts`:

```ts
import { expect, it, vi } from 'vitest';
import { waitForPhoto } from './waitForPhoto';

const db = (answers: ({ uploaded_at: string | null } | undefined)[]) => {
  let call = 0;
  return {
    getAll: vi.fn(async () => {
      const row = answers[Math.min(call++, answers.length - 1)];
      return row ? [row] : [];
    }),
  };
};

it('returns at once when the photo is uploaded or not on this phone', async () => {
  const onWait = vi.fn();
  expect(await waitForPhoto(db([{ uploaded_at: 'x' }]), 'p1', { onWait })).toBe(true);
  expect(await waitForPhoto(db([undefined]), 'p1', { onWait })).toBe(true);
  expect(onWait).not.toHaveBeenCalled();
});

it('says it is waiting once, and returns when the upload lands', async () => {
  const onWait = vi.fn();
  const source = db([{ uploaded_at: null }, { uploaded_at: null }, { uploaded_at: 'x' }]);
  expect(await waitForPhoto(source, 'p1', { pauseMs: 1, onWait })).toBe(true);
  expect(onWait).toHaveBeenCalledTimes(1);
  expect(source.getAll).toHaveBeenCalledWith('select uploaded_at from photos where id = ?', ['p1']);
});

it('gives up after its tries', async () => {
  expect(await waitForPhoto(db([{ uploaded_at: null }]), 'p1', { tries: 3, pauseMs: 1 })).toBe(
    false,
  );
});
```

  - Append to `apps/mobile/src/sharing/api.test.ts`:

```ts
it('a 5xx reading a share is an error, not "no longer shared"', async () => {
  const fetchImpl = vi.fn(async () => new Response('{"error":"internal"}', { status: 503 }));
  expect(await readShare('c'.repeat(43), fetchImpl, 'https://x/api')).toEqual({
    ok: false,
    status: 'error',
  });
});

it('a failure with no known key says what failed', async () => {
  const deps = {
    fetch: vi.fn(async () => new Response('{"error":"internal"}', { status: 500 })),
    apiUrl: 'https://x/api',
    token: 't',
  };
  expect(await stopShares('r1', deps)).toEqual({
    ok: false,
    message: "Couldn't stop sharing. Try again.",
  });
  expect(await saveShare('c'.repeat(43), deps)).toEqual({
    ok: false,
    message: "Couldn't save this recipe. Try again.",
  });
});
```

  - Use the existing imports in that file, and add `stopShares` and `saveShare` if they are missing.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run apps/mobile/src/sharing`

Expected: FAIL, with a missing `./waitForPhoto` module, `status: 'unknown'` received, and the message `Something went wrong. Try again.`

- [ ] **Step 3: Implement.**
  - Create `apps/mobile/src/sharing/waitForPhoto.ts`:

```ts
type Db = { getAll<T>(sql: string, params: unknown[]): Promise<T[]> };

/**
 * True once the dish photo has reached the server (its synced row carries
 * uploaded_at), or when there is no such row on this phone; false if it
 * hasn't within the wait (60 s by default). A link made before the upload
 * would show no photo (bug batch §4).
 */
export async function waitForPhoto(
  db: Db,
  photoId: string,
  { tries = 120, pauseMs = 500, onWait }: { tries?: number; pauseMs?: number; onWait?: () => void } = {},
): Promise<boolean> {
  for (let attempt = 0; attempt < tries; attempt++) {
    const [row] = await db.getAll<{ uploaded_at: string | null }>(
      'select uploaded_at from photos where id = ?',
      [photoId],
    );
    if (!row || row.uploaded_at) return true;
    if (attempt === 0) onWait?.();
    await new Promise((resolve) => setTimeout(resolve, pauseMs));
  }
  return false;
}
```

  - In `apps/mobile/src/sharing/api.ts`:
    - give `call` a fallback, `async function call<T>(deps: ApiDeps, path: string, body: unknown, fallback: string)`, and use `SHARE_MESSAGES[json?.error ?? ''] ?? fallback`;
    - then:

```ts
export const createShare = (recipeId: string, deps: ApiDeps) =>
  call<{ code: string }>(deps, '/shares', { recipe_id: recipeId }, "Couldn't make a link. Try again.");
export const stopShares = (recipeId: string, deps: ApiDeps) =>
  call<{ stopped: number }>(
    deps,
    '/shares/stop',
    { recipe_id: recipeId },
    "Couldn't stop sharing. Try again.",
  );
export const saveShare = (code: string, deps: ApiDeps) =>
  call<{ recipe_id: string }>(
    deps,
    `/shares/${code}/save`,
    undefined,
    "Couldn't save this recipe. Try again.",
  );
```

  - In `readShare`, before the JSON parse, add `if (response.status >= 500) return { ok: false, status: 'error' };`.
  - In `apps/mobile/src/components/ShareMenu.tsx`:
    - import `waitForPhoto`;
    - in `shareLink()`, after `await waitForUploads(db);`:

```ts
    if (recipe.photo_id) {
      const uploaded = await waitForPhoto(db, recipe.photo_id, {
        onWait: () => setMessage('Uploading the photo…'),
      });
      if (!uploaded) {
        setMessage("The photo hasn't finished uploading. Try again in a moment.");
        return;
      }
      setMessage(null);
    }
```

  - In `apps/mobile/src/screens/SharedRecipeScreen.tsx`, before the `if (status)` branch:

```tsx
  if (status === 'error')
    return (
      <Screen>
        <Text>Couldn't load this page. Try again.</Text>
        <Button label="Try again" onPress={() => setAttempt((value) => value + 1)} />
      </Screen>
    );
```

  - `SharedLinks.tsx` needs no change: the fallback now comes from `stopShares`.

- [ ] **Step 4: Run the unit tests**

Run: `pnpm vitest run apps/mobile/src/sharing`

Expected: PASS.

- [ ] **Step 5: Write the e2e.** Append to `e2e/sharing.spec.ts`:

```ts
test('a link made right after adding a dish photo shows it signed out, and Link again gives the same link (FR-27)', async ({
  page,
  browser,
}) => {
  await signIn(page, freshEmail('share-photo'));
  const title = unique('Photo soup');
  await soup(page, title);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add photo' }).click();
  await (await chooser).setFiles('test-support/photos/dish.jpg');
  await page.getByRole('button', { name: 'Share' }).click();
  await page.getByRole('button', { name: 'Link' }).click();
  const link = page.getByLabel('Share link');
  await expect(link).toBeVisible({ timeout: 60_000 });
  const url = (await link.textContent())!.trim();
  await page.getByRole('button', { name: 'Link' }).click();
  await expect(page.getByText('Copied').or(link)).toBeVisible();
  expect((await link.textContent())!.trim()).toBe(url);

  const visitor = await (await browser.newContext()).newPage();
  const photo = visitor.waitForResponse(
    (response) => response.url().endsWith('/photo') && response.status() === 200,
  );
  await visitor.goto(url);
  await expect(visitor.getByRole('heading', { name: title, level: 1 })).toBeVisible();
  await photo;
  await visitor.context().close();
});
```

- [ ] **Step 6: Run it**

Run: `pnpm test:e2e -- e2e/sharing.spec.ts`

Expected: PASS, every test in the file. (Before Step 3 this test could fail by timing out on the photo response: the link was made before the upload.)

- [ ] **Step 7: Lint, typecheck, commit**

Run: `pnpm lint && pnpm typecheck`

```bash
git add apps/mobile/src/sharing apps/mobile/src/components/ShareMenu.tsx apps/mobile/src/screens/SharedRecipeScreen.tsx e2e/sharing.spec.ts
git commit -m "fix(sharing): Link waits for the dish photo; Stop and Save say what failed; a server error is not 'no longer shared' (FR-26, FR-27)"
```

---

### Task 6: Sign-up: the latest link wins; a bounded limiter

**Files:**
- Create: `apps/mobile/src/session/latestLink.ts`
- Modify:
  - `apps/mobile/src/household/pendingInvite.ts`, `apps/mobile/src/sharing/pending.ts`;
  - `apps/mobile/src/session/pendingFriend.ts`, `apps/mobile/src/session/signupPass.ts`, `apps/mobile/src/session/signupPass.test.ts`;
  - `apps/api/src/rateLimit.ts`, `apps/api/src/rateLimit.test.ts`;
  - `apps/api/src/signup/routes.ts`, `apps/api/src/signup/routes.test.ts`;
  - `apps/api/src/app.ts`, `apps/api/src/app.test.ts`, `apps/api/src/server.ts`;
  - `deploy/Caddyfile`.

**Interfaces:**
- Consumes (Task 2): `registerSignupRoutes` deps `{ signup, limitEmail, limitCode }` and the `/api/friend-links/status` route.
- Produces:
  - `createRateLimiter({ limit, windowMs, maxKeys?, now? })`;
  - `registerSignupRoutes` deps gain `limitIp` and `limitAll`;
  - `AppDeps.limits` is `{ email; code; ip; all }`;
  - the API reads the client address from `X-Client-IP`, which Caddy sets.

- [ ] **Step 1: Write the failing tests.**
  - Append to `apps/mobile/src/session/signupPass.test.ts`:

```ts
it('prefers the link opened last over an older pending invite or share', () => {
  setPendingInvite(A);
  setPendingShare({ code: A, title: 'Pie' });
  setPendingFriend(B);
  expect(passSource()).toEqual({ kind: 'friend', code: B });
  setPendingInvite(B);
  expect(passSource()).toEqual({ kind: 'invite', code: B });
});
```

  - Replace `apps/api/src/rateLimit.test.ts`:

```ts
import { expect, it } from 'vitest';
import { createRateLimiter } from './rateLimit';

it('allows up to the limit per key inside the window, then again once it passes', () => {
  let now = 0;
  const allow = createRateLimiter({ limit: 2, windowMs: 1_000, now: () => now });
  expect([allow('a'), allow('a'), allow('a'), allow('b')]).toEqual([true, true, false, true]);
  now = 1_001;
  expect(allow('a')).toBe(true);
});

it('at its key cap a new key is refused, and keys free up a window later', () => {
  let now = 0;
  const allow = createRateLimiter({ limit: 5, windowMs: 1_000, maxKeys: 2, now: () => now });
  expect([allow('a'), allow('b'), allow('c')]).toEqual([true, true, false]);
  expect(allow('a')).toBe(true);
  now = 1_000;
  expect(allow('c')).toBe(true);
});
```

  - In `apps/api/src/signup/routes.test.ts`:
    - give `app()` `limitIp: createRateLimiter({ limit: ipLimit, windowMs: 60_000 })` and `limitAll: createRateLimiter({ limit: allLimit, windowMs: 60_000 })`, with parameters `ipLimit = 100, allLimit = 100` after `status`;
    - send `'X-Client-IP': ip` in `post`, where `post = (body: unknown, ip = '203.0.113.1') => …`;
    - add:

```ts
it('one address asking for many emails is 429 after its limit; another address is not', async () => {
  const { grant, post } = app(true, 100, 'live', 1);
  await post({ kind: 'share', code: CODE, email: 'a@b.co' });
  expect((await post({ kind: 'share', code: CODE, email: 'c@d.co' })).status).toBe(429);
  expect((await post({ kind: 'share', code: CODE, email: 'e@f.co' }, '203.0.113.2')).status).toBe(
    204,
  );
  expect(grant).toHaveBeenCalledTimes(2);
});

it('a global cap holds across addresses and emails', async () => {
  const { post } = app(true, 100, 'live', 100, 1);
  await post({ kind: 'share', code: CODE, email: 'a@b.co' }, '203.0.113.1');
  expect((await post({ kind: 'share', code: CODE, email: 'c@d.co' }, '203.0.113.2')).status).toBe(
    429,
  );
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run apps/mobile/src/session/signupPass.test.ts && pnpm vitest run apps/api/src/rateLimit.test.ts apps/api/src/signup/routes.test.ts`

Expected: FAIL:
- the passSource test gets `invite`;
- the key-cap test gets `true` for `c`;
- the route tests get 204 where 429 is expected.

- [ ] **Step 3: Implement the latest link.**
  - Create `apps/mobile/src/session/latestLink.ts`:

```ts
// Which kind of link this visitor opened last (production spec §4): a friend
// link opened now beats an invite or share opened earlier in the tab.
const KEY = 'recipes.latestLink';
export type LinkKind = 'invite' | 'share' | 'friend';

export function markLatestLink(kind: LinkKind): void {
  globalThis.sessionStorage?.setItem(KEY, kind);
}

export function latestLink(): LinkKind | null {
  const kind = globalThis.sessionStorage?.getItem(KEY) ?? null;
  return kind === 'invite' || kind === 'share' || kind === 'friend' ? kind : null;
}
```

  - Call `markLatestLink('invite')` in `setPendingInvite`, `markLatestLink('share')` in `setPendingShare`, and `markLatestLink('friend')` in `setPendingFriend`, after each `setItem`. Import from `'../session/latestLink'` or `'./latestLink'`.
  - In `signupPass.ts`, replace `passSource`:

```ts
const ORDER: LinkKind[] = ['invite', 'share', 'friend'];
const CODES: Record<LinkKind, () => string | null> = {
  invite: peekPendingInvite,
  share: () => peekPendingShare()?.code ?? null,
  friend: peekPendingFriend,
};

/** The link this visitor arrived through, the latest first (production spec §4). Not consumed. */
export function passSource(): PassSource | null {
  const latest = latestLink();
  const order = latest ? [latest, ...ORDER.filter((kind) => kind !== latest)] : ORDER;
  for (const kind of order) {
    const code = CODES[kind]();
    if (code) return { kind, code };
  }
  return null;
}
```

  - Import `latestLink` and `type LinkKind` from `'./latestLink'`.

- [ ] **Step 4: Implement the limiter and the caps.**
  - Replace `apps/api/src/rateLimit.ts`:

```ts
/**
 * In-memory sliding window per key. One API process (family scale), so no
 * shared store. Keys are swept once a window by time, and at `maxKeys` a new
 * key is refused until the sweep frees room, so memory stays bounded.
 */
export function createRateLimiter(opts: {
  limit: number;
  windowMs: number;
  maxKeys?: number;
  now?: () => number;
}): (key: string) => boolean {
  const now = opts.now ?? Date.now;
  const maxKeys = opts.maxKeys ?? 10_000;
  const hits = new Map<string, number[]>();
  let sweepAt = 0;
  return (key) => {
    const at = now();
    if (at >= sweepAt) {
      for (const [k, times] of hits)
        if (times.every((t) => at - t >= opts.windowMs)) hits.delete(k);
      sweepAt = at + opts.windowMs;
    }
    if (!hits.has(key) && hits.size >= maxKeys) return false;
    const recent = (hits.get(key) ?? []).filter((t) => at - t < opts.windowMs);
    const allowed = recent.length < opts.limit;
    if (allowed) recent.push(at);
    hits.set(key, recent);
    return allowed;
  };
}
```

  Check the key-cap test against this: `a` and `b` fill the map at 0, `c` is refused, `a` is allowed. At 1,000, `sweepAt` (1,000) is due and removes `a` and `b`, so `c` is allowed.
  - In `apps/api/src/signup/routes.ts`:
    - add `limitIp: (key: string) => boolean; limitAll: (key: string) => boolean;` to deps;
    - add `const ip = (c: Context) => c.req.header('X-Client-IP') ?? 'unknown';`, importing `Context` from hono;
    - in `/api/signup-pass`, replace the limit line with:

```ts
    // Per address, per email, per link, then everyone: a refused check
    // counts against none after it.
    if (
      !deps.limitIp(ip(c)) ||
      !deps.limitEmail(email) ||
      !deps.limitCode(code) ||
      !deps.limitAll('all')
    )
      return c.json({ error: 'too_many' }, 429);
```

    - in `/api/friend-links/status`, use `if (!deps.limitIp(ip(c)) || !deps.limitCode(code) || !deps.limitAll('all'))`.
  - In `apps/api/src/app.ts`:
    - `limits: { email; code; ip; all }`, all `(key: string) => boolean`;
    - pass `limitIp: deps.limits.ip, limitAll: deps.limits.all`.
  - In `apps/api/src/app.test.ts`, the stub becomes `{ email: () => true, code: () => true, ip: () => true, all: () => true }`.
  - In `apps/api/src/server.ts`:

```ts
// 10 asks per email, 30 per link and 30 per address an hour, 300 in all;
// GoTrue rate-limits the emails themselves.
const limits = {
  email: createRateLimiter({ limit: 10, windowMs: 3_600_000 }),
  code: createRateLimiter({ limit: 30, windowMs: 3_600_000 }),
  ip: createRateLimiter({ limit: 30, windowMs: 3_600_000 }),
  all: createRateLimiter({ limit: 300, windowMs: 3_600_000 }),
};
```

  - In `deploy/Caddyfile`, replace `reverse_proxy api:3000` under `handle /api/*` with the block below. `{client_ip}` honours `trusted_proxies`, so the tunnel's forwarded visitor address is used, and a client-sent `X-Client-IP` is overwritten:

```
		reverse_proxy api:3000 {
			# The visitor's address for the API's sign-up limits.
			header_up X-Client-IP {client_ip}
		}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run apps/mobile/src/session && pnpm vitest run apps/api/src && pnpm test:prod-config`

Expected: PASS. `test:prod-config` still reports `ok`.

- [ ] **Step 6: Check the header reaches the API.** Rebuild the stack with `pnpm dev:backend`. Then send two pass requests through Caddy with a forged header:

```bash
for i in 1 2; do curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:8090/api/signup-pass -H 'Content-Type: application/json' -H 'X-Client-IP: 1.2.3.4' -d "{\"kind\":\"share\",\"code\":\"$(printf 'x%.0s' $(seq 43))\",\"email\":\"probe$i@example.test\"}"; done
```

Expected: `404` twice (`link_expired`), showing the route works through the proxy. The forged header is replaced by Caddy, so it neither helps nor blocks the probe. (A per-IP refusal would take 30 requests; the unit test covers it.)

- [ ] **Step 7: Lint, typecheck, commit**

Run: `pnpm lint && pnpm typecheck`

```bash
git add apps/mobile/src/session apps/mobile/src/household/pendingInvite.ts apps/mobile/src/sharing/pending.ts apps/api/src deploy/Caddyfile
git commit -m "fix(signup): the latest link opened wins; the pass limiter has per-address and global caps and sweeps by time (FR-6)"
```

---

### Task 7: Test hygiene: the purge Viewer test, fresh households

**Files:**
- Modify: `apps/api/tests/upload/purge.test.ts`

- [ ] **Step 1: Give the Viewer test its own household.** In `apps/api/tests/upload/purge.test.ts`:
  - import `signInFresh` and `env` (already imported);
  - replace `it('a viewer purges nothing', …)` with:

```ts
  it('a viewer purges nothing (in a household of its own, so no parallel purge can interfere)', async () => {
    const tag = () => `purge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
    const admin = await signInFresh(tag());
    const invited = await fetch(`${env.apiUrl}/invites`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${admin.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'viewer' }),
    });
    const { code } = (await invited.json()) as { code: string };
    const joiner = await signInFresh(tag());
    const joined = await fetch(`${env.apiUrl}/invites/accept`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${joiner.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token: code }),
    });
    expect(joined.status).toBe(200);
    const viewer = await signInFresh(joiner.email);
    expect(viewer.role).toBe('viewer');
    const expired = await trashedRecipe(admin, 31);
    const response = await purge(viewer.accessToken);
    expect(await response.json()).toEqual({ purged: 0 });
    expect(await exists(expired)).toBe(true);
  });
```

  - `signInFresh` asks for a new code. `viewer.role` comes from the new token, so the test proves the viewer's claims.
  - This test cannot be shown failing first: it fixes a race (a parallel purge by household A's member) that doesn't happen on a quiet run. Record it in the ledger as `Ruling: no RED for a race fix`.

- [ ] **Step 2: Run it**

Run: `pnpm dev:backend:test && pnpm vitest run -c vitest.integration.config.ts apps/api/tests/upload/purge.test.ts`

Expected: PASS, 3 tests.

- [ ] **Step 3: Check that suites needing many recipes use fresh households.**

Run: `grep -nE "for \(let i = 0; i < ([6-9]|[1-9][0-9]+)|length: ([6-9]|[1-9][0-9]+)" e2e/*.spec.ts apps/api/tests/**/*.test.ts`

Expected: every hit is in a test that signs in with `freshEmail(…)` or `fresh()`. Open each file at the hit and check. Any suite that loops over recipes in a `SEED` household moves to a fresh user, as in Step 1. If none do, record `Task 7: Ruling: suites with many recipes already use fresh households — spec item already done`.

- [ ] **Step 4: Commit**

```bash
git add apps/api/tests/upload/purge.test.ts
git commit -m "test(purge): the Viewer test uses its own household (FR-18)"
```

---

### Task 8: The flaky offline shopping sync (PR #16 CI)

**Files:**
- Investigate: `e2e/shopping.spec.ts:75`, `apps/mobile/src/db/DatabaseSessionBridge.tsx`, `apps/mobile/src/db/useNetworkOnline.ts`
- Modify: whatever the root cause names, plus a test that reproduces it

This task follows superpowers:systematic-debugging. Its steps gather evidence; the fix depends on what they show.

- [ ] **Step 1: Reproduce.** With the test stack up (`pnpm dev:backend:test`), run the test 30 times while the machine is busy:

Run: `pnpm test:e2e -- e2e/shopping.spec.ts -g "a change made offline syncs" --repeat-each=30 --reporter=line > .superpowers/flaky.log 2>&1; tail -20 .superpowers/flaky.log`

Expected: either some runs fail at line 86 ("Online · 0 unsynced" not found), or all pass.

- [ ] **Step 2: If it reproduces, gather evidence at each boundary.**
  - Add a temporary listener in the test: `page.on('console', (m) => console.log('[page]', m.type(), m.text()))`.
  - Add a temporary `console.log` in `DatabaseSessionBridge`'s queued transition: online, the action, before and after `db.connect` and `db.disconnect`.
  - Run again with `--repeat-each=30`.
  - Find which of these happens:
    - the `online` event never arrives;
    - a transition waits behind an earlier one that never settles (for example `db.connect` waiting while offline);
    - `connect` runs, but PowerSync stays disconnected (connector `fetchCredentials` failing).
- [ ] **Step 3: Fix the root cause with a failing test first.**
  - A pure decision goes in a unit test, as `localDataAction` has.
  - A timing fault needs an e2e that pins it, for example going offline before the first connect has settled. Make it fail, fix, then run it 30 times green.
  - Remove the temporary logging.
- [ ] **Step 4: If 60 runs (two rounds of 30) never fail,** record `Task 8: Ruling: the CI failure did not reproduce in 60 local runs; left as is, and the evidence (CI run 39338332472: "Offline · 1 unsynced" after setOffline(false)) is in the PR body` and change nothing.
- [ ] **Step 5: Restore the stack and commit any fix**

Run: `pnpm dev:backend && docker compose restart sync`

```bash
git add <the files the fix touched>
git commit -m "fix(sync): <the root cause, in plain words> (FR-31)"
```

---

### Task 9: Docs

**Files:**
- Modify:
  - `docs/adr/0015-household-moves-and-live-roles.md`, `docs/adr/0016-*.md` (sharing);
  - `docs/SPEC.md` (FR-6), `ARCHITECTURE.md` (the `FRIEND_LINK` and `SHARE` lines).

- [ ] **Step 1: ADR-0015.**
  - In Decision, change the first bullet's list to nine functions, adding `revoke_friend_link` (bug batch) and `create_friend_link`. Then change the lock sentence and the helpers sentence to:

```markdown
  - None takes a household id from the caller. Each reads the caller from `auth_user_id()`, checks every rule, and raises a key on refusal. Every function that changes data locks the caller's household's memberships first; `preview_invite` only reads, so it takes no lock, and `accept_invite` re-checks everything under the lock.
  - Only live memberships (`deleted_at is null`) count as Admins or as other people in the household.
  - Clients reach them only through the API, as the user (`asUser`), and only `authenticated` may execute them.
  - Internal helpers cannot be called by clients: `lock_my_household` and `move_to_new_household` are themselves `SECURITY DEFINER` functions with no grant to clients, and `household_refuse` only raises.
```

- [ ] **Step 2: ADR-0016.** Replace "only its sha256 is stored" with:

```markdown
The link code is 32 random bytes. Reads look it up by its sha256. Since the bug batch, the code is also kept (`shares.kept_code`, not synced) so Link hands out a recipe's live link again rather than making a new one each tap; the household can already make links to its own recipes, so keeping the code exposes nothing new to it. Links made before then have no kept code and are never reused.
```

- [ ] **Step 3: SPEC FR-6.** Change its text to:

```markdown
| FR-6 | Any user can invite someone to create their own household; the household's friend links are listed on the Household screen, and anyone who can make one can revoke it *(built in sub-project 6; friend links in the production sub-project; revoking in the bug batch)* | S |
```

- [ ] **Step 4: ARCHITECTURE.**
  - The `FRIEND_LINK` line becomes: "…made by `create_friend_link`, listed to every member of the household, revoked by `revoke_friend_link`, its status read signed out through `friend_link_status`, not synced".
  - The `SHARE` line gains: ", and the kept code (`kept_code`, not synced) so Link reuses a live link".
  - If ARCHITECTURE lists API routes, add `GET /api/friend-links`, `DELETE /api/friend-links/:id` and `POST /api/friend-links/status`.

- [ ] **Step 5: Commit**

```bash
git add docs/adr ARCHITECTURE.md docs/SPEC.md
git commit -m "docs: ADR-0015 locks and helpers, ADR-0016 kept codes, FR-6 revoking, ARCHITECTURE friend links"
```

---

### Final verification (after Task 9)

- [ ] `pnpm lint && pnpm typecheck`: clean.
- [ ] `pnpm test`: all pass.
- [ ] `pnpm dev:backend && pnpm test:stack && pnpm test:rls`: all pass.
- [ ] `pnpm dev:backend:test && pnpm test:api`: all pass.
- [ ] `pnpm test:e2e`: all pass, 1 skipped as before.
- [ ] `pnpm test:prod-config`: ok.
- [ ] `pnpm dev:backend && docker compose restart sync`.
