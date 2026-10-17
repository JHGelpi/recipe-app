# Roles and Invites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admins invite people by a share-sheet link, change roles, remove people and rename the household. Anyone can leave or invite a friend to start their own household. Someone joining alone brings their recipes. Role and household changes take effect at once on the server, and within seconds on phones.

**Architecture:**
- **Database:** the RLS helpers read the caller's membership live instead of trusting token claims. Seven narrow `SECURITY DEFINER` functions (create, cancel, preview and accept an invite; set a role; remove a member; leave) do every cross-household change, each checking `auth_user_id()` itself.
- **API:** thin endpoints call those functions through `asUser`, and move photo files after an accept.
- **Phones:** each phone syncs its own membership row, refreshes its token when the row changes, and keys its local data by user and household, wiping it on a move.

**Tech Stack:** Postgres 17 + RLS (dbmate), GoTrue token hook, PowerSync sync streams, Hono API, zod 4, Expo / React Native Web, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-17-roles-invites-design.md`

## Global Constraints

- **Invites:** single use, **7 days**, at most **20** pending per household; the code is **32 random bytes, base64url (43 characters)**; only its sha256 is stored (spec §3–§4).
- **Tokens:** `GOTRUE_JWT_EXP` = **600** seconds (spec §3).
- **Error keys, exactly:** `forbidden`, `not_member`, `last_admin`, `only_admin`, `alone`, `invite_used`, `invite_expired`, `invite_cancelled`, `invite_unknown`, `already_member`, `too_many_invites` (spec §4).
- **Endpoint answers:** as in spec §5's table.
- **Household name:** 1–200 characters.
- **Copy, exactly** (spec §6):
  - Household screen: "Household", "Invite someone", "Share invite", "Link copied", "Pending invites", "Cancel", "Remove", "Leave household", "Invite a friend to Recipes", "Make your own recipe collection: <url>", "Changing the household needs a connection".
  - Invite page: "You've been invited to a household. Sign in to see the invite.", "Join the <name> as a <role>", "Your N recipes will move to the <name>", "Your recipes stay with the <old name>", "Still saving your changes. Try again in a moment.".
  - Invite statuses: "This invite has already been used", "This invite has expired", "This invite was cancelled", "This invite isn't valid", "You're already in the <name>", "Make someone else an Admin of your household first".
  - Notices: "You've joined the <name>", "You were moved to the <name>".
- **CLAUDE.md rules 1–8 apply.** Rule 1 gains the ADR-0015 exception for the listed definer functions only.
- **Sync config:** after changing `powersync/sync-config.yaml`, restart sync (`docker compose restart sync`).
- **Never run `pnpm db:reset`.** The owner's account and data must survive. The migration changes no existing row except adding `memberships.email`, which is filled as people sign in (see Decisions).

## Review Focus

1. **A person whose phone has unsent edits when they're removed, or when they accept on another device.** The cook expects no crash, and an honest outcome: edits are refused by the server and the phone moves on to its new household. Pinned in Task 5 (the bridge wipes only after the token says the new household) and Task 6 (Join waits for uploads).
2. **Two Admins acting at once** (both demote each other, or one removes the other while being demoted). The cook expects the household to keep at least one Admin. Pinned in Task 3 (the functions lock the household's memberships `for update` before counting Admins).
3. **An invite link opened by the person who created it, or by someone already in the household.** The cook expects "You're already in the <name>", not a move into the same household. Pinned in Task 3.
4. **An old phone whose stored data owner is in the pre-change format** (just a user id). The cook expects no wipe and no lost unsent edits when the app updates. Pinned in Task 5 (`localDataAction` treats a bare user id as matching).
5. **A removed person whose phone is offline for days.** The cook expects that when it comes back online it moves to the new household, without being stuck on the old one or failing silently. Pinned in Task 5 (the membership watch acts once the row syncs; the token refresh is retried with backoff).

## Decisions this plan makes inside the spec (for the executor's ledger)

- **`memberships.email` is filled lazily.** The migration role cannot read `auth.users`, so there is no backfill. The email comes from:
  - `handle_new_user` (at sign-up);
  - the token hook, which records `claims.email` whenever a token is issued (every 10 minutes for active users);
  - `accept_invite`.

  The Household screen shows "Email not known yet" until then. Spec §9.3 said "backfilled from `auth.users`".
- **The token hook becomes `volatile`** to write the email. The write is wrapped so a failure can never stop a sign-in.
- **The API returns the invite code, not a URL.** The phone builds `${window.location.origin}/invite/<code>`, so links are right on `localhost`, the LAN address and the future domain alike. Spec §5 said `${PUBLIC_URL}/invite/<code>`.
- **The household's name syncs** through a `household_info` stream (households added to the publication), so the Household screen and notices work offline. Spec §6 shows the name without saying where it comes from.
- **The invite code** is built from two `gen_random_uuid()` values (244 random bits), because pgcrypto isn't installed and the migration shouldn't need a superuser. Spec §4 offered this fallback.
- **The Household screen shows the invite link as text** with Copy and Share, as well as the share sheet. The share sheet isn't available in desktop browsers, and e2e reads the link from the page.
- **The invite page leaves out "Your recipes stay with the <old name>"** (spec §6). The preview can't tell someone alone with no recipes from someone in a shared household, so the line would sometimes be wrong. When recipes will move, the page says so.
- **Two helper functions** are added, `auth_household_id()` and `auth_household_role()` as live definer lookups, and an internal `move_to_new_household(uuid)` that clients can't call.

---

## File Structure

- **Domain:** `packages/domain/src/household.ts` (new).
- **Database:**
  - `db/migrations/20261021000000_live_roles_and_member_sync.sql` (new);
  - `db/migrations/20261021000001_create_invites_and_household_functions.sql` (new);
  - `powersync/sync-config.yaml`, `docker-compose.yml` (`GOTRUE_JWT_EXP`).
- **API:**
  - `apps/api/src/household/service.ts`, `apps/api/src/household/routes.ts` (new);
  - `apps/api/src/photos/store.ts` (`move`), `app.ts`, `server.ts`.
- **App:**
  - `src/session/sessionState.ts` (owner key), `src/db/dbOwner.ts`, `src/db/DatabaseSessionBridge.tsx`, `src/db/schema.ts`;
  - `src/household/` (new): `api.ts`, `membership.ts`, `useMembershipWatch.ts`, `notice.ts`, `hooks.ts`;
  - `src/screens/HouseholdScreen.tsx`, `src/screens/InviteScreen.tsx` (new);
  - `app/household.tsx`, `app/invite/[code].tsx` (new), `app/sign-in.tsx`;
  - `src/screens/RecipeListScreen.tsx`.
- **E2E:** `e2e/household.spec.ts` (new).
- **Docs:** ADR-0015, ADR README, `CLAUDE.md`, `ARCHITECTURE.md`, `docs/SPEC.md`.

---

### Task 1: Domain: household request schemas and error keys

**Files:**
- Create: `packages/domain/src/household.ts`, `packages/domain/src/household.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Produces:
  - `HOUSEHOLD_ROLES = ['admin', 'member', 'viewer']`, `type HouseholdRoleName`
  - `INVITE_DAYS = 7`, `MAX_PENDING_INVITES = 20`
  - `inviteCreateSchema` (`{ role }`), `inviteTokenBodySchema` (`{ token }`, 43 base64url characters), `memberRoleBodySchema` (`{ role }`), `householdRenameSchema` (`{ name }`, trimmed, 1–200)
  - `HOUSEHOLD_ERRORS`, `type HouseholdError`, `householdErrorOf(message: unknown): HouseholdError | null`

- [ ] **Step 1: Write the failing tests**

`packages/domain/src/household.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  householdErrorOf,
  householdRenameSchema,
  inviteCreateSchema,
  inviteTokenBodySchema,
  memberRoleBodySchema,
} from './household';

const CODE = 'k3J9xQ2mZb7LwP0aYc5RdT8vNf1HgE4sUo6IiKjMnBq';

describe('household schemas', () => {
  it('accepts a role for an invite or a member, and refuses anything else', () => {
    expect(inviteCreateSchema.safeParse({ role: 'viewer' }).success).toBe(true);
    expect(memberRoleBodySchema.safeParse({ role: 'admin' }).success).toBe(true);
    expect(inviteCreateSchema.safeParse({ role: 'owner' }).success).toBe(false);
    expect(inviteCreateSchema.safeParse({ role: 'member', extra: 1 }).success).toBe(false);
  });

  it('accepts only a 43-character base64url invite code', () => {
    expect(CODE).toHaveLength(43);
    expect(inviteTokenBodySchema.safeParse({ token: CODE }).success).toBe(true);
    expect(inviteTokenBodySchema.safeParse({ token: `${CODE}=` }).success).toBe(false);
    expect(inviteTokenBodySchema.safeParse({ token: CODE.replace('k', '+') }).success).toBe(false);
    expect(inviteTokenBodySchema.safeParse({ token: 'short' }).success).toBe(false);
  });

  it('trims a household name and holds it to 1–200 characters', () => {
    expect(householdRenameSchema.parse({ name: '  Gelpi household ' }).name).toBe('Gelpi household');
    expect(householdRenameSchema.safeParse({ name: '   ' }).success).toBe(false);
    expect(householdRenameSchema.safeParse({ name: 'x'.repeat(201) }).success).toBe(false);
  });

  it('recognises the database functions’ refusal keys and nothing else', () => {
    expect(householdErrorOf('last_admin')).toBe('last_admin');
    expect(householdErrorOf('invite_expired')).toBe('invite_expired');
    expect(householdErrorOf('relation "x" does not exist')).toBeNull();
    expect(householdErrorOf(undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run packages/domain/src/household.test.ts`
Expected: FAIL, `./household` does not exist.

- [ ] **Step 3: Write `household.ts`**

`packages/domain/src/household.ts`:

```ts
import { z } from 'zod';

/** FR-4: the roles of SPEC §2. */
export const HOUSEHOLD_ROLES = ['admin', 'member', 'viewer'] as const;
export type HouseholdRoleName = (typeof HOUSEHOLD_ROLES)[number];

/** FR-3: invites (spec §3). */
export const INVITE_DAYS = 7;
export const MAX_PENDING_INVITES = 20;

const roleSchema = z.enum(HOUSEHOLD_ROLES);

export const inviteCreateSchema = z.strictObject({ role: roleSchema });
// 32 random bytes in base64url without padding.
export const inviteTokenBodySchema = z.strictObject({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
export const memberRoleBodySchema = z.strictObject({ role: roleSchema });
export const householdRenameSchema = z.strictObject({
  name: z.string().trim().min(1, 'Enter a name').max(200, 'At most 200 characters'),
});

/** The keys the household functions raise (spec §4). */
export const HOUSEHOLD_ERRORS = [
  'forbidden',
  'not_member',
  'last_admin',
  'only_admin',
  'alone',
  'invite_used',
  'invite_expired',
  'invite_cancelled',
  'invite_unknown',
  'already_member',
  'too_many_invites',
] as const;
export type HouseholdError = (typeof HOUSEHOLD_ERRORS)[number];

export function householdErrorOf(message: unknown): HouseholdError | null {
  return (HOUSEHOLD_ERRORS as readonly unknown[]).includes(message) ? (message as HouseholdError) : null;
}
```

Add `export * from './household';` to `packages/domain/src/index.ts`.

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run packages/domain && pnpm typecheck`
Expected: PASS and clean.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src
git commit -m "feat(domain): household request schemas and refusal keys (FR-3, FR-5)"
```

---

### Task 2: Database: live role checks, member emails, membership and household sync, 10-minute tokens

**Files:**
- Create: `db/migrations/20261021000000_live_roles_and_member_sync.sql`, `apps/api/tests/rls/live-roles.test.ts`
- Modify: `powersync/sync-config.yaml`, `docker-compose.yml`

**Interfaces:**
- Produces:
  - **Live helpers:** `auth_household_id()` and `auth_household_role()`, which read `memberships` for `auth_user_id()` (security definer).
  - **Memberships:** `memberships.email`; `memberships_select` also lets a user read their own row.
  - **Token hook and sign-up:** the token hook records `claims.email`, and `handle_new_user` writes the email.
  - **Deferrable keys:** the composite foreign keys `photos_import_id_household_id_fkey`, `photos_recipe_id_household_id_fkey`, `recipes_photo_fkey` and `substitutions_recipe_id_household_id_fkey` become deferrable.
  - **Sync:** `memberships` and `households` join the publication, with the streams `household_members`, `my_membership` and `household_info`.
  - **Tokens:** `GOTRUE_JWT_EXP` = 600.

- [ ] **Step 1: Write the failing tests**

`apps/api/tests/rls/live-roles.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { signInFresh, type Actor } from '../../../../test-support/auth';
import { adminSql, as, refusalCode } from '../helpers/db';

const REFUSED = '42501';
const fresh = () => signInFresh(`live-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`);

const moved: { user: string; household: string }[] = [];
afterEach(async () => {
  // Put anyone a test moved by hand back where the token hook expects them.
  for (const { user, household } of moved.splice(0)) {
    await adminSql`update public.memberships set household_id = ${household}, role = 'admin' where user_id = ${user}`;
  }
});

async function addRecipe(actor: Actor) {
  return as(actor, (tx) => tx`insert into public.recipes (id, household_id, title)
    values (${randomUUID()}, ${actor.householdId}, 'Live test')`);
}

describe('live role checks (spec §3)', () => {
  it('a demotion takes effect on the next statement, with the same token', async () => {
    const cook = await fresh();
    await addRecipe(cook);
    await adminSql`update public.memberships set role = 'viewer' where user_id = ${cook.userId}`;
    moved.push({ user: cook.userId, household: cook.householdId! });
    expect(await refusalCode(addRecipe(cook))).toBe(REFUSED);
  });

  it('a move to another household takes effect at once, whatever the token says', async () => {
    const a = await fresh();
    const b = await fresh();
    await addRecipe(a);
    await adminSql`update public.memberships set household_id = ${b.householdId}, role = 'member' where user_id = ${a.userId}`;
    moved.push({ user: a.userId, household: a.householdId! });
    const seen = await as(a, (tx) => tx<{ household_id: string }[]>`select household_id from public.recipes`);
    expect(seen.every((row) => row.household_id === b.householdId)).toBe(true);
  });
});

describe('memberships', () => {
  it('records the email at sign-in, and a user can always read their own row', async () => {
    const cook = await fresh();
    const rows = await as(cook, (tx) => tx<{ email: string | null; user_id: string }[]>`
      select email, user_id from public.memberships where user_id = ${cook.userId}`);
    expect(rows).toEqual([{ email: cook.email, user_id: cook.userId }]);
  });

  it('household members can read each other, and no one else', async () => {
    const a = await fresh();
    const b = await fresh();
    const seen = await as(a, (tx) => tx<{ user_id: string }[]>`select user_id from public.memberships`);
    expect(seen.map((row) => row.user_id)).toEqual([a.userId]);
    expect(seen.map((row) => row.user_id)).not.toContain(b.userId);
  });
});

describe('tokens', () => {
  it('last 10 minutes', async () => {
    const cook = await fresh();
    const payload = JSON.parse(Buffer.from(cook.accessToken.split('.')[1]!, 'base64url').toString()) as {
      exp: number;
      iat: number;
    };
    expect(payload.exp - payload.iat).toBe(600);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run -c vitest.integration.config.ts apps/api/tests/rls/live-roles.test.ts`
Expected: FAIL:
- the demoted insert succeeds (the claims still say admin);
- `column "email" does not exist`;
- the token lasts 3600 s.

- [ ] **Step 3: Write the migration**

`db/migrations/20261021000000_live_roles_and_member_sync.sql`:

```sql
-- migrate:up
-- Roles and invites, part 1 (FR-4, FR-5, NFR-1; ADR-0015). Runs as app_owner.

-- ---------------------------------------------------------------- live role checks

-- A role or household change must bind at once, not when the caller's
-- token expires. The helpers read the caller's membership instead of the
-- token's claims. Security definer, because memberships' own policy calls
-- them (reading memberships under RLS here would recurse). They return only
-- the caller's own household and role.
create or replace function public.auth_household_id() returns uuid
language sql stable security definer set search_path = ''
as $$
  select m.household_id from public.memberships m
  where m.user_id = public.auth_user_id() and m.deleted_at is null
$$;

create or replace function public.auth_household_role() returns public.household_role
language sql stable security definer set search_path = ''
as $$
  select m.role from public.memberships m
  where m.user_id = public.auth_user_id() and m.deleted_at is null
$$;

-- ---------------------------------------------------------------- member emails

alter table public.memberships add column email text check (char_length(email) <= 320);

-- A user always reads their own row (the my_membership stream), and the
-- rows of their household (household_members).
drop policy memberships_select on public.memberships;
create policy memberships_select on public.memberships
for select to authenticated
using (
  household_id = (select public.auth_household_id())
  or user_id = (select public.auth_user_id())
);

-- FR-2 unchanged, plus the email for the Household screen.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  new_household_id uuid;
begin
  insert into public.households (name, updated_by)
  values (coalesce(nullif(split_part(new.email, '@', 1), ''), 'My') || ' household', new.id)
  returning id into new_household_id;

  insert into public.memberships (household_id, user_id, role, email, updated_by)
  values (new_household_id, new.id, 'admin', new.email, new.id);

  return new;
end;
$$;

-- The token hook also records the email it is given, so members who signed
-- up before this migration get one at their next token. A failure there must
-- never stop a sign-in.
create or replace function public.custom_access_token_hook(event jsonb) returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  claims jsonb := event -> 'claims';
  membership record;
begin
  select m.household_id, m.role, m.email into membership
  from public.memberships m
  where m.user_id = (event ->> 'user_id')::uuid and m.deleted_at is null;

  if found then
    claims := jsonb_set(claims, '{household_id}', to_jsonb(membership.household_id::text));
    claims := jsonb_set(claims, '{household_role}', to_jsonb(membership.role::text));
    if claims ->> 'email' is not null and membership.email is distinct from claims ->> 'email' then
      begin
        update public.memberships set email = claims ->> 'email'
        where user_id = (event ->> 'user_id')::uuid;
      exception when others then
        null;
      end;
    end if;
  end if;

  return jsonb_build_object('claims', claims);
end;
$$;

-- ---------------------------------------------------------------- deferrable keys

-- Moving a person's data between households (accept_invite) changes
-- household_id table by table; these checks wait for the end of that
-- transaction. Everywhere else they stay immediate.
alter table public.photos alter constraint photos_import_id_household_id_fkey deferrable initially immediate;
alter table public.photos alter constraint photos_recipe_id_household_id_fkey deferrable initially immediate;
alter table public.recipes alter constraint recipes_photo_fkey deferrable initially immediate;
alter table public.substitutions alter constraint substitutions_recipe_id_household_id_fkey deferrable initially immediate;

-- ---------------------------------------------------------------- sync

-- Mirrored by powersync/sync-config.yaml (household_members, my_membership,
-- household_info). Change both together.
alter publication powersync add table public.memberships, public.households;
grant select on public.memberships, public.households to powersync_repl;

-- migrate:down
alter publication powersync drop table public.memberships, public.households;
alter table public.substitutions alter constraint substitutions_recipe_id_household_id_fkey not deferrable;
alter table public.recipes alter constraint recipes_photo_fkey not deferrable;
alter table public.photos alter constraint photos_recipe_id_household_id_fkey not deferrable;
alter table public.photos alter constraint photos_import_id_household_id_fkey not deferrable;
drop policy memberships_select on public.memberships;
create policy memberships_select on public.memberships
for select to authenticated
using (household_id = (select public.auth_household_id()));
alter table public.memberships drop column email;
```

The down section does not restore the old helpers or hook bodies. A rollback of the helpers would reintroduce claim-trusting checks, so roll forward instead.

- [ ] **Step 4: Sync streams and token lifetime**

Append to `powersync/sync-config.yaml`:

```yaml
  # Mirrors memberships_select's household branch.
  household_members:
    auto_subscribe: true
    query: >-
      SELECT id, household_id, user_id, email, role, created_at
      FROM memberships
      WHERE household_id = auth.parameter('household_id')

  # Mirrors memberships_select's own-row branch. Keyed by user, so it keeps
  # arriving after a change of household; the phone refreshes on a change.
  my_membership:
    auto_subscribe: true
    query: >-
      SELECT id, household_id, user_id, email, role, created_at
      FROM memberships
      WHERE user_id = auth.user_id()

  # Mirrors households_select.
  household_info:
    auto_subscribe: true
    query: >-
      SELECT id, name FROM households WHERE id = auth.parameter('household_id')
```

In `docker-compose.yml`, change `GOTRUE_JWT_EXP: 3600` to:

```yaml
      # 10 minutes: bounds what a removed person's phone can still sync (ADR-0015).
      GOTRUE_JWT_EXP: 600
```

- [ ] **Step 5: Apply, restart sync, and run the suites**

Run: `pnpm dev:backend:test && docker compose restart sync && pnpm test:rls && pnpm test:stack`
Expected: PASS, including `live-roles.test.ts`.
- If a stack test asserted a 3600 s lifetime, change it to 600 and note it in the ledger.
- If the existing isolation or role tests relied on claims rather than membership, investigate before changing them. Seed users' claims and memberships agree, so they should pass unchanged.

- [ ] **Step 6: Commit**

```bash
git add db powersync docker-compose.yml apps/api/tests/rls
git commit -m "feat(db): live role checks, member emails, membership and household sync, 10-minute tokens (FR-4, NFR-1)"
```

---

### Task 3: Database: invites and the household functions

**Files:**
- Create: `db/migrations/20261021000001_create_invites_and_household_functions.sql`, `apps/api/tests/rls/household.test.ts`
- Modify: `apps/api/tests/rls/registry.ts`, `apps/api/tests/rls/roles.test.ts`

**Interfaces:**
- Consumes: the live helpers and deferrable keys (Task 2).
- Produces:
  - table `public.invites`, with select for its household's Admins;
  - `create_invite(public.household_role) → table(id uuid, token text, expires_at timestamptz)`;
  - `cancel_invite(uuid) → void`;
  - `preview_invite(text) → table(status text, household_name text, role public.household_role, moving_recipes int, blocker text)`;
  - `accept_invite(text) → table(household_id uuid, from_household uuid, moved_recipes int, moved_photos uuid[])`;
  - `set_member_role(uuid, public.household_role) → void`, `remove_member(uuid) → void`, `leave_household() → void`;
  - refusals: `raise exception '<key>' using errcode = 'P0001'`.

- [ ] **Step 1: Write the failing tests**

`apps/api/tests/rls/household.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signInFresh, type Actor } from '../../../../test-support/auth';
import { adminSql, as } from '../helpers/db';

const fresh = () => signInFresh(`hh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`);

/** The refusal key a household function raised, or 'ok'. */
async function outcome(run: Promise<unknown>): Promise<string> {
  try {
    await run;
    return 'ok';
  } catch (error) {
    return (error as { message?: string }).message ?? 'error';
  }
}

async function invite(admin: Actor, role = 'member'): Promise<string> {
  const [row] = await as(admin, (tx) => tx<{ token: string }[]>`
    select token from public.create_invite(${role}::public.household_role)`);
  return row!.token;
}
const accept = (actor: Actor, token: string) =>
  as(actor, (tx) => tx`select * from public.accept_invite(${token})`);
const preview = async (actor: Actor, token: string) =>
  (await as(actor, (tx) => tx<Record<string, unknown>[]>`select * from public.preview_invite(${token})`))[0]!;
const membership = async (actor: Actor) =>
  (await adminSql<{ household_id: string; role: string }[]>`
    select household_id, role from public.memberships where user_id = ${actor.userId}`)[0]!;

describe('invites', () => {
  it('only an Admin creates one; the code is 43 characters and only its hash is stored', async () => {
    const admin = await fresh();
    const token = await invite(admin);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const stored = await adminSql<{ hit: boolean }[]>`
      select exists (select 1 from public.invites where token_hash = convert_to(${token}, 'UTF8')) as hit`;
    expect(stored[0]?.hit).toBe(false);
    const joiner = await fresh();
    await accept(joiner, await invite(admin, 'viewer'));
    expect(await outcome(invite(joiner))).toBe('forbidden');
  });

  it('works once, and says so after; expired and cancelled invites are refused', async () => {
    const admin = await fresh();
    const token = await invite(admin);
    const first = await fresh();
    const second = await fresh();
    expect(await outcome(accept(first, token))).toBe('ok');
    expect((await preview(second, token)).status).toBe('used');
    expect(await outcome(accept(second, token))).toBe('invite_used');

    const old = await invite(admin);
    await adminSql`update public.invites set expires_at = now() - interval '1 minute' where token_hash = sha256(convert_to(${old}, 'UTF8'))`;
    expect(await outcome(accept(second, old))).toBe('invite_expired');

    const cancelled = await invite(admin);
    const [row] = await adminSql<{ id: string }[]>`select id from public.invites where token_hash = sha256(convert_to(${cancelled}, 'UTF8'))`;
    await as(admin, (tx) => tx`select public.cancel_invite(${row!.id})`);
    expect(await outcome(accept(second, cancelled))).toBe('invite_cancelled');
    expect(await outcome(accept(second, 'x'.repeat(43)))).toBe('invite_unknown');
  });

  it('only that household’s Admins can read its invites', async () => {
    const admin = await fresh();
    const other = await fresh();
    await invite(admin);
    expect(await as(admin, (tx) => tx`select id from public.invites`)).toHaveLength(1);
    expect(await as(other, (tx) => tx`select id from public.invites`)).toHaveLength(0);
  });

  it('refuses the creator or a member opening their own household’s link (Review Focus 3)', async () => {
    const admin = await fresh();
    const token = await invite(admin);
    expect((await preview(admin, token)).status).toBe('already_member');
    expect(await outcome(accept(admin, token))).toBe('already_member');
  });
});

describe('joining', () => {
  it('a person alone brings recipes, photos, imports, substitutions and favorites, and their old household closes', async () => {
    const admin = await fresh();
    const joiner = await fresh();
    const recipe = randomUUID();
    const importId = randomUUID();
    await as(joiner, async (tx) => {
      await tx`insert into public.recipes (id, household_id, title) values (${recipe}, ${joiner.householdId}, 'My soup')`;
      await tx`insert into public.imports (id, household_id, source_type) values (${importId}, ${joiner.householdId}, 'photo')`;
      await tx`insert into public.photos (id, household_id, kind, import_id, position, recipe_id, media_type, bytes, width, height)
        values (${randomUUID()}, ${joiner.householdId}, 'page', ${importId}, 1, ${recipe}, 'image/jpeg', 10, 1, 1)`;
      await tx`insert into public.substitutions (id, household_id, recipe_id, ingredient_id, ingredient_raw, options)
        values (${randomUUID()}, ${joiner.householdId}, ${recipe}, ${randomUUID()}, '1 egg', ${tx.json([])})`;
      await tx`insert into public.favorites (id, household_id, user_id, recipe_id) values (${randomUUID()}, ${joiner.householdId}, ${joiner.userId}, ${recipe})`;
    });
    const token = await invite(admin);
    expect(await preview(joiner, token)).toMatchObject({ status: 'ok', moving_recipes: 1, blocker: null });
    const [result] = await as(joiner, (tx) => tx<{ moved_recipes: number; moved_photos: string[] }[]>`
      select * from public.accept_invite(${token})`);
    expect(result?.moved_recipes).toBe(1);
    expect(result?.moved_photos).toHaveLength(1);
    for (const table of ['recipes', 'imports', 'photos', 'substitutions', 'favorites']) {
      const rows = await adminSql<{ n: number }[]>`
        select count(*)::int as n from public.${adminSql(table)} where household_id = ${admin.householdId}`;
      expect([table, rows[0]?.n]).toEqual([table, 1]);
    }
    const [old] = await adminSql<{ deleted_at: Date | null }[]>`select deleted_at from public.households where id = ${joiner.householdId}`;
    expect(old?.deleted_at).not.toBeNull();
    expect(await membership(joiner)).toEqual({ household_id: admin.householdId, role: 'member' });
    // The admin can now see the moved recipe; the joiner's old token reads the new household live.
    expect(await as(admin, (tx) => tx`select id from public.recipes where id = ${recipe}`)).toHaveLength(1);
  });

  it('a person from a shared household moves nothing; its only Admin is refused', async () => {
    const admin = await fresh();
    const host = await fresh();
    const guest = await fresh();
    await accept(guest, await invite(host));
    await as(host, (tx) => tx`insert into public.recipes (id, household_id, title) values (${randomUUID()}, ${host.householdId}, 'Shared')`);
    const token = await invite(admin);
    expect(await preview(host, token)).toMatchObject({ status: 'ok', blocker: 'only_admin' });
    expect(await outcome(accept(host, token))).toBe('only_admin');
    expect(await preview(guest, token)).toMatchObject({ status: 'ok', moving_recipes: 0, blocker: null });
    expect(await outcome(accept(guest, token))).toBe('ok');
    const left = await adminSql`select id from public.recipes where household_id = ${host.householdId}`;
    expect(left).toHaveLength(1);
  });
});

describe('roles, removing and leaving', () => {
  it('keeps at least one Admin', async () => {
    const admin = await fresh();
    expect(await outcome(as(admin, (tx) => tx`select public.set_member_role(${admin.userId}, 'member')`))).toBe('last_admin');
    expect(await outcome(as(admin, (tx) => tx`select public.leave_household()`))).toBe('alone');
  });

  it('an Admin changes a role and removes a member, who gets a household of their own', async () => {
    const admin = await fresh();
    const member = await fresh();
    await accept(member, await invite(admin));
    await as(admin, (tx) => tx`select public.set_member_role(${member.userId}, 'viewer')`);
    expect((await membership(member)).role).toBe('viewer');
    await as(admin, (tx) => tx`select public.remove_member(${member.userId})`);
    const after = await membership(member);
    expect(after.household_id).not.toBe(admin.householdId);
    expect(after.role).toBe('admin');
  });

  it('only Admins act, only on their own household, and never on themselves by removal', async () => {
    const admin = await fresh();
    const member = await fresh();
    const stranger = await fresh();
    await accept(member, await invite(admin));
    expect(await outcome(as(member, (tx) => tx`select public.remove_member(${admin.userId})`))).toBe('forbidden');
    expect(await outcome(as(member, (tx) => tx`select public.set_member_role(${admin.userId}, 'viewer')`))).toBe('forbidden');
    expect(await outcome(as(stranger, (tx) => tx`select public.remove_member(${member.userId})`))).toBe('not_member');
    expect(await outcome(as(admin, (tx) => tx`select public.remove_member(${admin.userId})`))).toBe('forbidden');
  });

  it('a member leaves to a household of their own; the only Admin of a shared household cannot', async () => {
    const admin = await fresh();
    const member = await fresh();
    await accept(member, await invite(admin));
    expect(await outcome(as(admin, (tx) => tx`select public.leave_household()`))).toBe('only_admin');
    expect(await outcome(as(member, (tx) => tx`select public.leave_household()`))).toBe('ok');
    expect((await membership(member)).household_id).not.toBe(admin.householdId);
  });

  it('two Admins demoting each other at once leave one Admin (Review Focus 2)', async () => {
    const one = await fresh();
    const two = await fresh();
    await accept(two, await invite(one, 'admin'));
    const results = await Promise.all([
      outcome(as(one, (tx) => tx`select public.set_member_role(${two.userId}, 'member')`)),
      outcome(as(two, (tx) => tx`select public.set_member_role(${one.userId}, 'member')`)),
    ]);
    expect(results.sort()).toEqual(['forbidden', 'ok'].sort());
    const admins = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.memberships where household_id = ${one.householdId} and role = 'admin'`;
    expect(admins[0]?.n).toBe(1);
  });
});
```

The concurrent test expects `['forbidden', 'ok']`. Whichever demotion commits first makes the other caller a non-admin, and the live role check then refuses them as `forbidden` (or `last_admin` if they were checked first). If the run shows `['last_admin', 'ok']`, accept either in the assertion and note it in the ledger.

In `registry.ts`, add `'invites'` and `invites: 'household_id'`. In `roles.test.ts`, add `invites: ['SELECT'],`.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm test:rls`
Expected: FAIL, `function public.create_invite(household_role) does not exist`, plus the registry, coverage and grants checks for `invites`.

- [ ] **Step 3: Write the migration**

`db/migrations/20261021000001_create_invites_and_household_functions.sql`:

```sql
-- migrate:up
-- Roles and invites, part 2 (FR-3, FR-5, FR-6; ADR-0015). Runs as app_owner.
-- Every cross-household change goes through one of these security definer
-- functions. None takes a household id from the caller: each reads the
-- caller's own membership, checks every rule, and raises a key on refusal.

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id),
  role public.household_role not null,
  token_hash bytea not null unique, -- sha256 of the link's code; the code is never stored
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  deleted_at timestamptz -- set when cancelled
);
create index invites_household_id_idx on public.invites (household_id);

create trigger invites_stamp before insert or update on public.invites
for each row execute function public.stamp_row();

grant select on public.invites to authenticated;
alter table public.invites enable row level security;

create policy invites_select on public.invites
for select to authenticated
using (
  household_id = (select public.auth_household_id())
  and (select public.auth_household_role()) = 'admin'
);

-- ---------------------------------------------------------------- helpers

create function public.household_refuse(key text) returns void
language plpgsql immutable as $$
begin
  raise exception '%', key using errcode = 'P0001';
end;
$$;

-- The caller's membership, locked with every membership of their household,
-- so counting Admins and changing roles cannot interleave (Review Focus 2).
create function public.lock_my_household(out household uuid, out my_role public.household_role)
language plpgsql security definer set search_path = '' as $$
begin
  select m.household_id into household from public.memberships m
  where m.user_id = public.auth_user_id() and m.deleted_at is null;
  if household is null then perform public.household_refuse('forbidden'); end if;
  perform 1 from public.memberships m where m.household_id = household for update;
  select m.role into my_role from public.memberships m
  where m.user_id = public.auth_user_id() and m.deleted_at is null;
end;
$$;

-- A new household for a person leaving or removed; their membership moves
-- there as Admin, and their favorites of the old household's recipes go.
create function public.move_to_new_household(target uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  old uuid;
  new_home uuid;
  mail text;
begin
  select m.household_id, m.email into old, mail from public.memberships m where m.user_id = target;
  insert into public.households (name, updated_by)
  values (coalesce(nullif(split_part(mail, '@', 1), ''), 'My') || ' household', target)
  returning id into new_home;
  update public.favorites set deleted_at = now()
  where user_id = target and household_id = old and deleted_at is null;
  update public.memberships set household_id = new_home, role = 'admin' where user_id = target;
end;
$$;

-- ---------------------------------------------------------------- invites

create function public.create_invite(invite_role public.household_role)
returns table (id uuid, token text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  home uuid;
  my_role public.household_role;
  code text;
  new_id uuid;
  new_expiry timestamptz;
begin
  select l.household, l.my_role into home, my_role from public.lock_my_household() l;
  if my_role <> 'admin' then perform public.household_refuse('forbidden'); end if;
  if (select count(*) from public.invites i
      where i.household_id = home and i.deleted_at is null and i.accepted_at is null
        and i.expires_at > now()) >= 20 then
    perform public.household_refuse('too_many_invites');
  end if;
  -- 32 bytes from two random UUIDs (244 random bits), as base64url.
  code := translate(rtrim(encode(decode(
    replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'hex'), 'base64'), '='), '+/', '-_');
  insert into public.invites (household_id, role, token_hash, expires_at)
  values (home, invite_role, sha256(convert_to(code, 'UTF8')), now() + interval '7 days')
  returning invites.id, invites.expires_at into new_id, new_expiry;
  return query select new_id, code, new_expiry;
end;
$$;

create function public.cancel_invite(invite_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  home uuid;
  my_role public.household_role;
begin
  select l.household, l.my_role into home, my_role from public.lock_my_household() l;
  if my_role <> 'admin' then perform public.household_refuse('forbidden'); end if;
  update public.invites set deleted_at = now()
  where invites.id = invite_id and household_id = home and accepted_at is null and deleted_at is null;
  if not found then perform public.household_refuse('invite_unknown'); end if;
end;
$$;

create function public.preview_invite(code text)
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

  select m.household_id, m.role into home, my_role from public.memberships m
  where m.user_id = public.auth_user_id() and m.deleted_at is null;
  if home = inv.household_id then
    return query select 'already_member'::text, h.name, inv.role, 0, null::text
      from public.households h where h.id = inv.household_id;
    return;
  end if;
  select count(*) into others from public.memberships m
  where m.household_id = home and m.user_id <> public.auth_user_id();
  return query select
    'ok'::text,
    h.name,
    inv.role,
    case when others = 0 then (select count(*)::int from public.recipes r
                               where r.household_id = home and r.deleted_at is null) else 0 end,
    case when others > 0 and my_role = 'admin' and not exists (
           select 1 from public.memberships m
           where m.household_id = home and m.role = 'admin' and m.user_id <> public.auth_user_id())
         then 'only_admin'::text end
  from public.households h where h.id = inv.household_id;
end;
$$;

create function public.accept_invite(code text)
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

  select l.household, l.my_role into home, my_role from public.lock_my_household() l;
  if home = inv.household_id then perform public.household_refuse('already_member'); end if;
  select count(*) into others from public.memberships m
  where m.household_id = home and m.user_id <> public.auth_user_id();
  if others > 0 and my_role = 'admin' and not exists (
       select 1 from public.memberships m
       where m.household_id = home and m.role = 'admin' and m.user_id <> public.auth_user_id()) then
    perform public.household_refuse('only_admin');
  end if;

  if others = 0 then
    -- Alone: everything of the old household comes along (spec §4).
    set constraints all deferred;
    photos_moved := array(select p.id from public.photos p where p.household_id = home);
    update public.recipes r set household_id = inv.household_id where r.household_id = home;
    get diagnostics recipes_moved = row_count;
    update public.photos p set household_id = inv.household_id where p.household_id = home;
    update public.imports i set household_id = inv.household_id where i.household_id = home;
    update public.substitutions s set household_id = inv.household_id where s.household_id = home;
    update public.favorites f set household_id = inv.household_id where f.household_id = home;
    update public.households h set deleted_at = now() where h.id = home;
  end if;

  update public.memberships m
  set household_id = inv.household_id, role = inv.role, email = coalesce(mail, m.email)
  where m.user_id = public.auth_user_id();
  update public.invites i set accepted_at = now(), accepted_by = public.auth_user_id() where i.id = inv.id;
  return query select inv.household_id, home, recipes_moved, photos_moved;
end;
$$;

-- ---------------------------------------------------------------- members

create function public.set_member_role(target uuid, new_role public.household_role) returns void
language plpgsql security definer set search_path = '' as $$
declare
  home uuid;
  my_role public.household_role;
  target_role public.household_role;
begin
  select l.household, l.my_role into home, my_role from public.lock_my_household() l;
  if my_role <> 'admin' then perform public.household_refuse('forbidden'); end if;
  select m.role into target_role from public.memberships m where m.user_id = target and m.household_id = home;
  if target_role is null then perform public.household_refuse('not_member'); end if;
  if target_role = 'admin' and new_role <> 'admin' and (
       select count(*) from public.memberships m where m.household_id = home and m.role = 'admin') <= 1 then
    perform public.household_refuse('last_admin');
  end if;
  update public.memberships set role = new_role where user_id = target;
end;
$$;

create function public.remove_member(target uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  home uuid;
  my_role public.household_role;
begin
  select l.household, l.my_role into home, my_role from public.lock_my_household() l;
  if my_role <> 'admin' then perform public.household_refuse('forbidden'); end if;
  if target = public.auth_user_id() then perform public.household_refuse('forbidden'); end if;
  if not exists (select 1 from public.memberships m where m.user_id = target and m.household_id = home) then
    perform public.household_refuse('not_member');
  end if;
  perform public.move_to_new_household(target);
end;
$$;

create function public.leave_household() returns void
language plpgsql security definer set search_path = '' as $$
declare
  home uuid;
  my_role public.household_role;
begin
  select l.household, l.my_role into home, my_role from public.lock_my_household() l;
  if not exists (select 1 from public.memberships m
                 where m.household_id = home and m.user_id <> public.auth_user_id()) then
    perform public.household_refuse('alone');
  end if;
  if my_role = 'admin' and not exists (
       select 1 from public.memberships m
       where m.household_id = home and m.role = 'admin' and m.user_id <> public.auth_user_id()) then
    perform public.household_refuse('only_admin');
  end if;
  perform public.move_to_new_household(public.auth_user_id());
end;
$$;

-- ---------------------------------------------------------------- grants

revoke execute on function public.household_refuse(text), public.lock_my_household(),
  public.move_to_new_household(uuid) from public;
revoke execute on function public.create_invite(public.household_role), public.cancel_invite(uuid),
  public.preview_invite(text), public.accept_invite(text), public.set_member_role(uuid, public.household_role),
  public.remove_member(uuid), public.leave_household() from public;
grant execute on function public.create_invite(public.household_role), public.cancel_invite(uuid),
  public.preview_invite(text), public.accept_invite(text), public.set_member_role(uuid, public.household_role),
  public.remove_member(uuid), public.leave_household() to authenticated;

-- migrate:down
drop function public.leave_household();
drop function public.remove_member(uuid);
drop function public.set_member_role(uuid, public.household_role);
drop function public.accept_invite(text);
drop function public.preview_invite(text);
drop function public.cancel_invite(uuid);
drop function public.create_invite(public.household_role);
drop function public.move_to_new_household(uuid);
drop function public.lock_my_household();
drop function public.household_refuse(text);
drop table public.invites;
```

`household_refuse` is called from definer functions that run as their owner, so revoking it from `public` does not affect them. The same goes for `lock_my_household` and `move_to_new_household`.

- [ ] **Step 4: Apply and run the RLS suite**

Run: `pnpm dev:backend:test && pnpm test:rls`
Expected: PASS. If a function raises an unexpected Postgres error, read its message and fix the SQL. Do not loosen a test.

- [ ] **Step 5: Commit**

```bash
git add db apps/api/tests/rls
git commit -m "feat(db): invites and the household functions: accept with data, roles, remove, leave (FR-3, FR-5, FR-6, NFR-1)"
```

---
### Task 4: API: household endpoints, and moving photo files on accept

**Files:**
- Create: `apps/api/src/bearer.ts`, `apps/api/src/household/service.ts`, `apps/api/src/household/service.test.ts`, `apps/api/src/household/routes.ts`, `apps/api/src/household/routes.test.ts`, `apps/api/tests/household/household.test.ts`
- Modify: `apps/api/src/app.ts`, `apps/api/src/server.ts`, `apps/api/src/photos/store.ts`, `apps/api/src/photos/store.test.ts`, `package.json` (`test:api`)

**Interfaces:**
- Consumes:
  - the functions from Task 3;
  - `householdErrorOf`, the body schemas and `HouseholdRoleName` (Task 1);
  - `AsUser`, `PhotoStore`, `isGuid`.
- Produces:
  - `bearer(header: string | undefined): string | null`
  - `PhotoStore.move(fromHousehold: string, toHousehold: string, id: string): Promise<void>`, where a missing file is not an error
  - `class HouseholdRefusal extends Error { key: HouseholdError }`
  - `type PendingInvite = { id: string; role: HouseholdRoleName; expires_at: string; created_at: string }`
  - `type InvitePreview = { status: 'ok' | 'used' | 'expired' | 'cancelled' | 'unknown' | 'already_member'; household_name: string | null; role: HouseholdRoleName | null; moving_recipes: number; blocker: 'only_admin' | null }`
  - `type HouseholdService` with:
    - `createInvite(token, role) → { id, code, expires_at }`, `listInvites(token)`, `cancelInvite(token, id)`;
    - `previewInvite(token, code)`, `acceptInvite(token, code) → { household_id, moved_recipes }`;
    - `setRole(token, userId, role)`, `removeMember(token, userId)`, `leave(token)`, `rename(token, name)`.
  - `createHouseholdService({ asUser, photos, log })`, `registerHouseholdRoutes(app, { household })`, `AppDeps.household`
  - The routes of spec §5. `POST /api/invites` returns `{ id, code, expires_at }` (see Decisions).

- [ ] **Step 1: Write the failing unit tests**

`apps/api/src/household/service.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { AsUser } from '../db/asUser';
import type { PhotoStore } from '../photos/store';
import { createHouseholdService, HouseholdRefusal } from './service';

function refusalError(key: string) {
  return Object.assign(new Error(key), { code: 'P0001' });
}

function setup(results: unknown[][] | Error) {
  const statements: string[] = [];
  const tx = vi.fn(async (strings: TemplateStringsArray) => {
    statements.push(strings.join('?'));
    if (results instanceof Error) throw results;
    return results.shift() ?? [];
  });
  const asUser = (async (_token: string, fn: (t: unknown) => Promise<unknown>) => fn(tx)) as unknown as AsUser;
  const photos: Pick<PhotoStore, 'move'> = { move: vi.fn().mockResolvedValue(undefined) };
  const service = createHouseholdService({ asUser, photos, log: vi.fn() });
  return { service, statements, photos };
}

describe('household service', () => {
  it('creates an invite and returns its code', async () => {
    const { service, statements } = setup([[{ id: 'i1', token: 'c'.repeat(43), expires_at: new Date('2026-10-24T00:00:00Z') }]]);
    expect(await service.createInvite('jwt', 'member')).toEqual({
      id: 'i1',
      code: 'c'.repeat(43),
      expires_at: '2026-10-24T00:00:00.000Z',
    });
    expect(statements[0]).toContain('public.create_invite(');
  });

  it('turns a function refusal into a HouseholdRefusal, and passes anything else through', async () => {
    const refused = setup(refusalError('last_admin'));
    await expect(refused.service.setRole('jwt', 'u2', 'viewer')).rejects.toEqual(new HouseholdRefusal('last_admin'));
    const broken = setup(new Error('connection reset'));
    await expect(broken.service.leave('jwt')).rejects.toThrow('connection reset');
  });

  it('lists invites only for an Admin', async () => {
    const member = setup([[{ role: 'member' }]]);
    await expect(member.service.listInvites('jwt')).rejects.toEqual(new HouseholdRefusal('forbidden'));
    const admin = setup([[{ role: 'admin' }], [{ id: 'i1', role: 'viewer', expires_at: new Date(0), created_at: new Date(0) }]]);
    expect(await admin.service.listInvites('jwt')).toEqual([
      { id: 'i1', role: 'viewer', expires_at: '1970-01-01T00:00:00.000Z', created_at: '1970-01-01T00:00:00.000Z' },
    ]);
  });

  it('moves the photo files of a lone joiner after the accept', async () => {
    const { service, photos } = setup([
      [{ household_id: 'h-new', from_household: 'h-old', moved_recipes: 2, moved_photos: ['p1', 'p2'] }],
    ]);
    expect(await service.acceptInvite('jwt', 'c'.repeat(43))).toEqual({ household_id: 'h-new', moved_recipes: 2 });
    expect(vi.mocked(photos.move).mock.calls).toEqual([
      ['h-old', 'h-new', 'p1'],
      ['h-old', 'h-new', 'p2'],
    ]);
  });

  it('a rename that matched no row is forbidden (not an Admin)', async () => {
    const { service } = setup([[]]);
    await expect(service.rename('jwt', 'Gelpis')).rejects.toEqual(new HouseholdRefusal('forbidden'));
  });
});
```

`apps/api/src/household/routes.test.ts`:

```ts
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { registerHouseholdRoutes } from './routes';
import { HouseholdRefusal, type HouseholdService } from './service';

const USER = '22222222-2222-4222-8222-222222222222';
const CODE = 'k3J9xQ2mZb7LwP0aYc5RdT8vNf1HgE4sUo6IiKjMnBq';

function app(over: Partial<HouseholdService> = {}) {
  const household = {
    createInvite: vi.fn().mockResolvedValue({ id: 'i1', code: CODE, expires_at: 'x' }),
    listInvites: vi.fn().mockResolvedValue([]),
    cancelInvite: vi.fn().mockResolvedValue(undefined),
    previewInvite: vi.fn().mockResolvedValue({ status: 'ok' }),
    acceptInvite: vi.fn().mockResolvedValue({ household_id: 'h1', moved_recipes: 0 }),
    setRole: vi.fn().mockResolvedValue(undefined),
    removeMember: vi.fn().mockResolvedValue(undefined),
    leave: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
    ...over,
  } as HouseholdService;
  const hono = new Hono();
  registerHouseholdRoutes(hono, { household });
  return { hono, household };
}
const send = (hono: Hono, method: string, path: string, body?: unknown, token: string | null = 'jwt') =>
  hono.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe('household routes', () => {
  it('answers 401 without a token and 400 for a bad body, without calling the service', async () => {
    const { hono, household } = app();
    expect((await send(hono, 'POST', '/api/invites', { role: 'member' }, null)).status).toBe(401);
    expect((await send(hono, 'POST', '/api/invites', { role: 'owner' })).status).toBe(400);
    expect((await send(hono, 'POST', '/api/invites/accept', { token: 'short' })).status).toBe(400);
    expect((await send(hono, 'PATCH', '/api/household', { name: ' ' })).status).toBe(400);
    expect(household.createInvite).not.toHaveBeenCalled();
  });

  it('answers each success with its status', async () => {
    const { hono } = app();
    expect((await send(hono, 'POST', '/api/invites', { role: 'member' })).status).toBe(201);
    expect((await send(hono, 'GET', '/api/invites')).status).toBe(200);
    expect((await send(hono, 'POST', '/api/invites/preview', { token: CODE })).status).toBe(200);
    expect((await send(hono, 'POST', '/api/invites/accept', { token: CODE })).status).toBe(200);
    expect((await send(hono, 'PATCH', `/api/members/${USER}`, { role: 'viewer' })).status).toBe(204);
    expect((await send(hono, 'DELETE', `/api/members/${USER}`)).status).toBe(204);
    expect((await send(hono, 'POST', '/api/household/leave')).status).toBe(204);
    expect((await send(hono, 'PATCH', '/api/household', { name: 'Gelpis' })).status).toBe(204);
  });

  it('maps refusals: forbidden 403, not_member 404, a cancelled-or-unknown invite 404, others 409', async () => {
    const refuse = (key: string) => vi.fn().mockRejectedValue(new HouseholdRefusal(key as never));
    expect((await send(app({ createInvite: refuse('forbidden') }).hono, 'POST', '/api/invites', { role: 'member' })).status).toBe(403);
    expect((await send(app({ removeMember: refuse('not_member') }).hono, 'DELETE', `/api/members/${USER}`)).status).toBe(404);
    expect((await send(app({ cancelInvite: refuse('invite_unknown') }).hono, 'DELETE', `/api/invites/${USER}`)).status).toBe(404);
    const used = await send(app({ acceptInvite: refuse('invite_used') }).hono, 'POST', '/api/invites/accept', { token: CODE });
    expect([used.status, await used.json()]).toEqual([409, { error: 'invite_used' }]);
    expect((await send(app({ setRole: refuse('last_admin') }).hono, 'PATCH', `/api/members/${USER}`, { role: 'member' })).status).toBe(409);
  });

  it('answers 404 for an id that is not a UUID', async () => {
    const { hono, household } = app();
    expect((await send(hono, 'DELETE', '/api/members/nope')).status).toBe(404);
    expect(household.removeMember).not.toHaveBeenCalled();
  });
});
```

Add to `apps/api/src/photos/store.test.ts`:

```ts
  it('moves a file to another household, and a missing file is not an error', async () => {
    root = await mkdtemp(join(tmpdir(), 'photos-'));
    const store = createDiskPhotoStore(root);
    const OTHER = '00000000-0000-0000-0000-00000000000b';
    await store.put(H, ID, Uint8Array.from([7]));
    await store.move(H, OTHER, ID);
    expect(await store.read(H, ID)).toBeNull();
    expect([...((await store.read(OTHER, ID)) ?? [])]).toEqual([7]);
    await store.move(H, OTHER, ID);
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run apps/api/src`
Expected: FAIL, because `./service` and `./routes` do not exist and `store.move` is not a function.

- [ ] **Step 3: Write the code**

`apps/api/src/bearer.ts`:

```ts
/** The token of an `Authorization: Bearer …` header, or null. */
export function bearer(header: string | undefined): string | null {
  return /^Bearer (.+)$/.exec(header ?? '')?.[1] ?? null;
}
```

In `apps/api/src/app.ts`, delete the local `bearer` function and import it from `./bearer`.

In `apps/api/src/photos/store.ts`, add to the `PhotoStore` type `move(fromHousehold: string, toHousehold: string, id: string): Promise<void>;` and to the disk store:

```ts
    async move(fromHousehold, toHousehold, id) {
      const target = pathOf(root, toHousehold, id);
      await mkdir(dirname(target), { recursive: true });
      try {
        await rename(pathOf(root, fromHousehold, id), target);
      } catch (error) {
        // Never uploaded, or already moved: nothing to do.
        if ((error as { code?: string }).code !== 'ENOENT') throw error;
      }
    },
```

`apps/api/src/household/service.ts`:

```ts
import { householdErrorOf, type HouseholdError, type HouseholdRoleName } from '@recipe-app/domain';
import type { AsUser, UserTx } from '../db/asUser';
import type { PhotoStore } from '../photos/store';

/** A household function refused, with its key (spec §4). */
export class HouseholdRefusal extends Error {
  constructor(readonly key: HouseholdError) {
    super(key);
    this.name = 'HouseholdRefusal';
  }
}

export type PendingInvite = { id: string; role: HouseholdRoleName; expires_at: string; created_at: string };
export type InvitePreview = {
  status: 'ok' | 'used' | 'expired' | 'cancelled' | 'unknown' | 'already_member';
  household_name: string | null;
  role: HouseholdRoleName | null;
  moving_recipes: number;
  blocker: 'only_admin' | null;
};
export type HouseholdService = {
  createInvite(token: string, role: HouseholdRoleName): Promise<{ id: string; code: string; expires_at: string }>;
  listInvites(token: string): Promise<PendingInvite[]>;
  cancelInvite(token: string, id: string): Promise<void>;
  previewInvite(token: string, code: string): Promise<InvitePreview>;
  acceptInvite(token: string, code: string): Promise<{ household_id: string; moved_recipes: number }>;
  setRole(token: string, userId: string, role: HouseholdRoleName): Promise<void>;
  removeMember(token: string, userId: string): Promise<void>;
  leave(token: string): Promise<void>;
  rename(token: string, name: string): Promise<void>;
};

const iso = (value: Date | string) => new Date(value).toISOString();

/**
 * FR-3–FR-6 over the household functions (ADR-0015). Every call runs as the
 * user through asUser (rule 1); the functions check the caller themselves.
 */
export function createHouseholdService(deps: {
  asUser: AsUser;
  photos: Pick<PhotoStore, 'move'>;
  log?: (event: Record<string, unknown>) => void;
}): HouseholdService {
  async function run<T>(token: string, fn: (tx: UserTx) => Promise<T>): Promise<T> {
    try {
      return await deps.asUser(token, fn);
    } catch (error) {
      const key = householdErrorOf((error as { message?: unknown }).message);
      if ((error as { code?: unknown }).code === 'P0001' && key) throw new HouseholdRefusal(key);
      throw error;
    }
  }

  return {
    async createInvite(token, role) {
      const [row] = await run(token, (tx) => tx<{ id: string; token: string; expires_at: Date }[]>`
        select id, token, expires_at from public.create_invite(${role}::public.household_role)`);
      return { id: row!.id, code: row!.token, expires_at: iso(row!.expires_at) };
    },

    listInvites: (token) =>
      run(token, async (tx) => {
        const [me] = await tx<{ role: string | null }[]>`select public.auth_household_role() as role`;
        if (me?.role !== 'admin') throw new HouseholdRefusal('forbidden');
        const rows = await tx<{ id: string; role: HouseholdRoleName; expires_at: Date; created_at: Date }[]>`
          select id, role, expires_at, created_at from public.invites
          where accepted_at is null and deleted_at is null and expires_at > now()
          order by created_at desc`;
        return rows.map((row) => ({ ...row, expires_at: iso(row.expires_at), created_at: iso(row.created_at) }));
      }),

    async cancelInvite(token, id) {
      await run(token, (tx) => tx`select public.cancel_invite(${id}::uuid)`);
    },

    async previewInvite(token, code) {
      const [row] = await run(token, (tx) => tx<InvitePreview[]>`select * from public.preview_invite(${code})`);
      return row!;
    },

    async acceptInvite(token, code) {
      const [row] = await run(token, (tx) => tx<
        { household_id: string; from_household: string; moved_recipes: number; moved_photos: string[] }[]
      >`select * from public.accept_invite(${code})`);
      // The rows moved in the transaction; now their files follow.
      for (const id of row!.moved_photos ?? []) {
        await deps.photos.move(row!.from_household, row!.household_id, id).catch((error: unknown) => {
          deps.log?.({ event: 'photo_move_failed', id, message: String(error) });
        });
      }
      return { household_id: row!.household_id, moved_recipes: row!.moved_recipes };
    },

    async setRole(token, userId, role) {
      await run(token, (tx) => tx`select public.set_member_role(${userId}::uuid, ${role}::public.household_role)`);
    },
    async removeMember(token, userId) {
      await run(token, (tx) => tx`select public.remove_member(${userId}::uuid)`);
    },
    async leave(token) {
      await run(token, (tx) => tx`select public.leave_household()`);
    },
    async rename(token, name) {
      // households_update lets only Admins update their own household.
      const rows = await run(token, (tx) => tx`
        update public.households set name = ${name}
        where id = (select public.auth_household_id()) returning id`);
      if (rows.length === 0) throw new HouseholdRefusal('forbidden');
    },
  };
}
```

`apps/api/src/household/routes.ts`:

```ts
import {
  householdRenameSchema,
  inviteCreateSchema,
  inviteTokenBodySchema,
  memberRoleBodySchema,
  type HouseholdError,
} from '@recipe-app/domain';
import type { Context, Hono } from 'hono';
import type { z } from 'zod';
import { bearer } from '../bearer';
import { isGuid } from '../ids';
import { HouseholdRefusal, type HouseholdService } from './service';

const STATUS: Partial<Record<HouseholdError, 403 | 404>> = { forbidden: 403, not_member: 404 };

/** FR-3–FR-6 (spec §5). */
export function registerHouseholdRoutes(app: Hono, deps: { household: HouseholdService }): void {
  const { household } = deps;

  async function body<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S> | null> {
    const parsed = schema.safeParse(await c.req.json().catch(() => null));
    return parsed.success ? parsed.data : null;
  }

  // Runs an action; a refusal becomes its status and key.
  async function handle(c: Context, action: (token: string) => Promise<Response>, notFound: HouseholdError[] = []) {
    const token = bearer(c.req.header('Authorization'));
    if (!token) return c.json({ error: 'unauthorized' }, 401);
    try {
      return await action(token);
    } catch (error) {
      if (!(error instanceof HouseholdRefusal)) throw error;
      const status = notFound.includes(error.key) ? 404 : (STATUS[error.key] ?? 409);
      return c.json({ error: error.key }, status);
    }
  }

  app.post('/api/invites', (c) =>
    handle(c, async (token) => {
      const parsed = await body(c, inviteCreateSchema);
      if (!parsed) return c.json({ error: 'invalid_body' }, 400);
      return c.json(await household.createInvite(token, parsed.role), 201);
    }),
  );
  app.get('/api/invites', (c) => handle(c, async (token) => c.json(await household.listInvites(token))));
  app.delete('/api/invites/:id', (c) =>
    handle(
      c,
      async (token) => {
        if (!isGuid(c.req.param('id'))) return c.json({ error: 'not_found' }, 404);
        await household.cancelInvite(token, c.req.param('id'));
        return c.body(null, 204);
      },
      ['invite_unknown'],
    ),
  );
  app.post('/api/invites/preview', (c) =>
    handle(c, async (token) => {
      const parsed = await body(c, inviteTokenBodySchema);
      if (!parsed) return c.json({ error: 'invalid_body' }, 400);
      return c.json(await household.previewInvite(token, parsed.token));
    }),
  );
  app.post('/api/invites/accept', (c) =>
    handle(c, async (token) => {
      const parsed = await body(c, inviteTokenBodySchema);
      if (!parsed) return c.json({ error: 'invalid_body' }, 400);
      return c.json(await household.acceptInvite(token, parsed.token));
    }),
  );
  app.patch('/api/members/:userId', (c) =>
    handle(c, async (token) => {
      if (!isGuid(c.req.param('userId'))) return c.json({ error: 'not_found' }, 404);
      const parsed = await body(c, memberRoleBodySchema);
      if (!parsed) return c.json({ error: 'invalid_body' }, 400);
      await household.setRole(token, c.req.param('userId'), parsed.role);
      return c.body(null, 204);
    }),
  );
  app.delete('/api/members/:userId', (c) =>
    handle(c, async (token) => {
      if (!isGuid(c.req.param('userId'))) return c.json({ error: 'not_found' }, 404);
      await household.removeMember(token, c.req.param('userId'));
      return c.body(null, 204);
    }),
  );
  app.post('/api/household/leave', (c) =>
    handle(c, async (token) => {
      await household.leave(token);
      return c.body(null, 204);
    }),
  );
  app.patch('/api/household', (c) =>
    handle(c, async (token) => {
      const parsed = await body(c, householdRenameSchema);
      if (!parsed) return c.json({ error: 'invalid_body' }, 400);
      await household.rename(token, parsed.name);
      return c.body(null, 204);
    }),
  );
}
```

In `apps/api/src/app.ts`, add `household: HouseholdService;` to `AppDeps` and call `registerHouseholdRoutes(app, deps);` before `return app;`. In `apps/api/src/app.test.ts`'s `deps()`, add a `household` object whose methods are `vi.fn()`.

In `apps/api/src/server.ts`:

```ts
const household = createHouseholdService({
  asUser: createAsUser(sql, verify),
  photos: photoStore,
  log: (event) => console.log(JSON.stringify(event)),
});
```

and pass `household` to `createApp`.

- [ ] **Step 4: Run the unit tests, typecheck and lint**

Run: `pnpm vitest run apps/api/src && pnpm typecheck && pnpm lint`
Expected: PASS and clean.

- [ ] **Step 5: Write the API suite tests**

`apps/api/tests/household/household.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { env } from '../../../../test-support/env';
import { signInFresh, type Actor } from '../../../../test-support/auth';
import { syntheticJpeg } from '../../../../test-support/jpeg';
import { adminSql } from '../helpers/db';

const fresh = () => signInFresh(`hh-api-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`);

function call(actor: Actor, method: string, path: string, body?: unknown, raw?: Uint8Array<ArrayBuffer>) {
  return fetch(`${env.apiUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${actor.accessToken}`,
      'Content-Type': raw ? 'image/jpeg' : 'application/json',
    },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
}

async function invite(admin: Actor, role = 'member'): Promise<string> {
  const response = await call(admin, 'POST', '/invites', { role });
  expect(response.status).toBe(201);
  return ((await response.json()) as { code: string }).code;
}

describe('household endpoints', () => {
  it('invite, list, preview and accept; the joiner is then in the household', async () => {
    const admin = await fresh();
    const joiner = await fresh();
    const code = await invite(admin);
    const listed = (await (await call(admin, 'GET', '/invites')).json()) as unknown[];
    expect(listed).toHaveLength(1);
    const preview = await (await call(joiner, 'POST', '/invites/preview', { token: code })).json();
    expect(preview).toMatchObject({ status: 'ok', role: 'member', moving_recipes: 0 });
    const accepted = await call(joiner, 'POST', '/invites/accept', { token: code });
    expect(accepted.status).toBe(200);
    const [row] = await adminSql<{ household_id: string }[]>`select household_id from public.memberships where user_id = ${joiner.userId}`;
    expect(row?.household_id).toBe(admin.householdId);
    expect((await call(joiner, 'POST', '/invites/accept', { token: code })).status).toBe(409);
  });

  it('refuses a non-Admin, cancels, changes a role, keeps the last Admin, removes, and leaves', async () => {
    const admin = await fresh();
    const member = await fresh();
    await call(member, 'POST', '/invites/accept', { token: await invite(admin) });
    expect((await call(member, 'POST', '/invites', { role: 'member' })).status).toBe(403);
    expect((await call(member, 'GET', '/invites')).status).toBe(403);
    const pending = await (await call(admin, 'POST', '/invites', { role: 'viewer' })).json() as { id: string };
    expect((await call(admin, 'DELETE', `/invites/${pending.id}`)).status).toBe(204);
    expect((await call(admin, 'DELETE', `/invites/${pending.id}`)).status).toBe(404);
    expect((await call(admin, 'PATCH', `/members/${member.userId}`, { role: 'viewer' })).status).toBe(204);
    expect((await call(admin, 'PATCH', `/members/${admin.userId}`, { role: 'member' })).status).toBe(409);
    expect((await call(admin, 'PATCH', '/household', { name: 'Test kitchen' })).status).toBe(204);
    expect((await call(member, 'PATCH', '/household', { name: 'Mine now' })).status).toBe(403);
    expect((await call(admin, 'DELETE', `/members/${member.userId}`)).status).toBe(204);
    expect((await call(admin, 'POST', '/household/leave')).status).toBe(409);
  });

  it('moves a lone joiner’s photo files with their rows', async () => {
    const admin = await fresh();
    const joiner = await fresh();
    const importId = randomUUID();
    const photo = randomUUID();
    const upload = await call(joiner, 'POST', '/upload', {
      ops: [
        { op: 'put', table: 'imports', id: importId, data: { household_id: joiner.householdId, source_type: 'photo' } },
        {
          op: 'put',
          table: 'photos',
          id: photo,
          data: { household_id: joiner.householdId, kind: 'page', import_id: importId, position: 1, media_type: 'image/jpeg', bytes: 40, width: 4, height: 4 },
        },
      ],
    });
    expect(upload.status).toBe(200);
    expect((await call(joiner, 'PUT', `/photos/${photo}`, undefined, syntheticJpeg(4, 4))).status).toBe(204);
    await call(joiner, 'POST', '/invites/accept', { token: await invite(admin) });
    expect((await call(admin, 'GET', `/photos/${photo}`)).status).toBe(200);
  });
});
```

In `package.json`, append ` apps/api/tests/household` to `test:api`.

- [ ] **Step 6: Rebuild and run the API suite**

Run: `pnpm dev:backend:test && pnpm test:api`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api package.json
git commit -m "feat(api): household endpoints: invites, roles, remove, leave, rename; photo files follow a join (FR-3, FR-5)"
```

---

### Task 5: App: local data keyed by household, and following membership changes

**Files:**
- Create: `apps/mobile/src/household/membership.ts`, `apps/mobile/src/household/membership.test.ts`, `apps/mobile/src/household/useMembershipWatch.ts`, `apps/mobile/src/household/notice.ts`, `apps/mobile/src/household/notice.test.ts`
- Modify: `apps/mobile/src/session/sessionState.ts`, `apps/mobile/src/session/sessionState.test.ts`, `apps/mobile/src/db/DatabaseSessionBridge.tsx`, `apps/mobile/src/db/schema.ts`

**Interfaces:**
- Consumes: the `household_members`, `my_membership` and `household_info` streams (Task 2).
- Produces:
  - **Local tables:** `memberships` (`household_id`, `user_id`, `email`, `role`, `created_at`) and `households` (`name`).
  - **Session:** `SettledSession` signed in gains `householdId: string | null`.
  - **Owner key:** `ownerKey(userId: string, householdId: string | null): string`; `localDataAction(session, owner)` treats a bare user id as matching; `householdChanged(session, owner): boolean`.
  - **Watch:** `membershipAction(row: { household_id: string; role: string } | undefined, claims: { householdId: string; role: string }): 'refresh' | 'none'`; `useMembershipWatch(claims: Claims | null, enabled: boolean): void`.
  - **Notice:** `type HouseholdNotice = { kind: 'joined' | 'moved'; name: string | null }`; `setNotice(notice)`, `takeNotice(): HouseholdNotice | null` (sessionStorage).

- [ ] **Step 1: Write the failing tests**

Add to `apps/mobile/src/session/sessionState.test.ts` (import `householdChanged` and `ownerKey`):

```ts
describe('local data keyed by user and household', () => {
  const inA = { status: 'signedIn' as const, userId: 'user-1', householdId: 'h-a' };
  const inB = { ...inA, householdId: 'h-b' };

  it('keeps data for the same user and household, and for the old owner format (Review Focus 4)', () => {
    expect(ownerKey('user-1', 'h-a')).toBe('user-1:h-a');
    expect(localDataAction(inA, 'user-1:h-a')).toBe('keep');
    expect(localDataAction(inA, 'user-1')).toBe('keep');
    expect(householdChanged(inA, 'user-1')).toBe(false);
  });

  it('wipes when the same user’s household changed, and says so', () => {
    expect(localDataAction(inB, 'user-1:h-a')).toBe('wipe');
    expect(householdChanged(inB, 'user-1:h-a')).toBe(true);
  });

  it('still wipes for a different user, without calling it a household change', () => {
    expect(localDataAction({ ...inA, userId: 'user-2' }, 'user-1:h-a')).toBe('wipe');
    expect(householdChanged({ ...inA, userId: 'user-2' }, 'user-1:h-a')).toBe(false);
  });
});
```

and update the existing `localDataAction` tests' signed-in sessions to include `householdId: null`. Those expectations stay as they are.

`apps/mobile/src/household/membership.test.ts`:

```ts
import { expect, it } from 'vitest';
import { membershipAction } from './membership';

const claims = { householdId: 'h-a', role: 'member' };

it('refreshes the token when the synced membership disagrees with it', () => {
  expect(membershipAction({ household_id: 'h-b', role: 'member' }, claims)).toBe('refresh');
  expect(membershipAction({ household_id: 'h-a', role: 'viewer' }, claims)).toBe('refresh');
});

it('does nothing when they agree, or before the row has synced', () => {
  expect(membershipAction({ household_id: 'h-a', role: 'member' }, claims)).toBe('none');
  expect(membershipAction(undefined, claims)).toBe('none');
});
```

`apps/mobile/src/household/notice.test.ts`:

```ts
import { beforeEach, expect, it } from 'vitest';
import { setNotice, takeNotice } from './notice';

const memory = new Map<string, string>();
beforeEach(() => {
  memory.clear();
  globalThis.sessionStorage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => void memory.set(key, value),
    removeItem: (key: string) => void memory.delete(key),
  } as Storage;
});

it('is taken once', () => {
  setNotice({ kind: 'joined', name: 'Gelpi household' });
  expect(takeNotice()).toEqual({ kind: 'joined', name: 'Gelpi household' });
  expect(takeNotice()).toBeNull();
});

it('ignores anything unreadable', () => {
  memory.set('recipes.householdNotice', '{oops');
  expect(takeNotice()).toBeNull();
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run apps/mobile/src/session apps/mobile/src/household`
Expected: FAIL, because `ownerKey`, `householdChanged`, `./membership` and `./notice` do not exist.

- [ ] **Step 3: Write the code**

In `apps/mobile/src/session/sessionState.ts`, change `SettledSession`'s signed-in shape to `{ status: 'signedIn'; userId: string; householdId: string | null }`, and replace `localDataAction` with:

```ts
/** What the local database is recorded as holding: this user, in this household. */
export function ownerKey(userId: string, householdId: string | null): string {
  return householdId ? `${userId}:${householdId}` : userId;
}

const ownerUser = (owner: string) => owner.split(':')[0];

/**
 * Local data is wiped when the user signs out, when someone other than the
 * recorded owner signs in, or when the same user's household has changed
 * (FR-5: joined, left or removed). A session the server ended keeps the
 * data, so unsynced recipes upload once the same user signs back in. An
 * owner recorded as a bare user id (before households could change) matches.
 */
export function localDataAction(session: SettledSession, owner: string | null): 'wipe' | 'keep' {
  if (session.status === 'signedOut') return session.byUser ? 'wipe' : 'keep';
  if (owner === null || owner === session.userId) return 'keep';
  if (ownerUser(owner) !== session.userId) return 'wipe';
  return session.householdId === null || owner === ownerKey(session.userId, session.householdId)
    ? 'keep'
    : 'wipe';
}

/** The same user, now in another household. */
export function householdChanged(session: SettledSession, owner: string | null): boolean {
  return (
    session.status === 'signedIn' &&
    owner !== null &&
    owner.includes(':') &&
    ownerUser(owner) === session.userId &&
    localDataAction(session, owner) === 'wipe'
  );
}
```

In `apps/mobile/src/db/schema.ts`, add:

```ts
// The household's members (household_members) and this user's own row
// (my_membership); written only by the server's household functions.
const memberships = new Table(
  { household_id: column.text, user_id: column.text, email: column.text, role: column.text, created_at: column.text },
  { indexes: { user: ['user_id'] } },
);

// The household's name (household_info).
const households = new Table({ name: column.text });
```

and add `memberships, households,` to `AppSchema`.

`apps/mobile/src/household/membership.ts`:

```ts
/**
 * Spec §6: the synced membership row is the truth; the token's claims catch
 * up when refreshed. A difference means the household or role changed.
 */
export function membershipAction(
  row: { household_id: string; role: string } | undefined,
  claims: { householdId: string; role: string },
): 'refresh' | 'none' {
  if (!row) return 'none';
  return row.household_id !== claims.householdId || row.role !== claims.role ? 'refresh' : 'none';
}
```

`apps/mobile/src/household/useMembershipWatch.ts`:

```ts
import { useQuery } from '@powersync/react';
import { useEffect, useRef } from 'react';
import { auth } from '../session/auth';
import type { Claims } from '../session/claims';
import { membershipAction } from './membership';

const MEMBERSHIP_SQL = 'select household_id, role from memberships where user_id = ?';
const FIRST_DELAY_MS = 5_000;
const MAX_DELAY_MS = 5 * 60 * 1000;

/**
 * Refreshes the token when this user's synced membership no longer matches
 * it, so a role change or a move takes effect on the phone (spec §6). Retries
 * with backoff while offline (Review Focus 5).
 */
export function useMembershipWatch(claims: Claims | null, enabled: boolean): void {
  const { data } = useQuery<{ household_id: string; role: string }>(MEMBERSHIP_SQL, [claims?.userId ?? '']);
  const retry = useRef({ at: 0, delay: FIRST_DELAY_MS, busy: false });
  const row = data[0];
  const action = claims && enabled ? membershipAction(row, claims) : 'none';

  useEffect(() => {
    if (action !== 'refresh') return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = () => {
      const state = retry.current;
      if (state.busy) return;
      const wait = state.at - Date.now();
      if (wait > 0) {
        timer = setTimeout(attempt, wait);
        return;
      }
      state.busy = true;
      void auth.refreshSession().then(({ error }) => {
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
  }, [action, row?.household_id, row?.role]);
}
```

`apps/mobile/src/household/notice.ts`:

```ts
/** A one-time message after a change of household (spec §6). */
export type HouseholdNotice = { kind: 'joined' | 'moved'; name: string | null };
const KEY = 'recipes.householdNotice';

export function setNotice(notice: HouseholdNotice): void {
  globalThis.sessionStorage?.setItem(KEY, JSON.stringify(notice));
}

/** Pending notices that were already set are kept (a Join's notice wins over "moved"). */
export function hasNotice(): boolean {
  return globalThis.sessionStorage?.getItem(KEY) != null;
}

export function takeNotice(): HouseholdNotice | null {
  const raw = globalThis.sessionStorage?.getItem(KEY);
  globalThis.sessionStorage?.removeItem(KEY);
  try {
    const value = JSON.parse(raw ?? 'null') as Partial<HouseholdNotice> | null;
    return value && (value.kind === 'joined' || value.kind === 'moved')
      ? { kind: value.kind, name: typeof value.name === 'string' ? value.name : null }
      : null;
  } catch {
    return null;
  }
}
```

In `apps/mobile/src/db/DatabaseSessionBridge.tsx`:
- add `const householdId = state.status === 'signedIn' ? (state.claims?.householdId ?? null) : null;`;
- build the session as `{ status: 'signedIn', userId, householdId }`;
- import `householdChanged` and `ownerKey`;
- in the queued transition:

```ts
        if (localDataAction(session, dbOwner.get()) === 'wipe') {
          // FR-5: a move gets a one-time notice; a Join set its own already.
          if (householdChanged(session, dbOwner.get()) && !hasNotice()) {
            setNotice({ kind: 'moved', name: null });
          }
          // … the existing photo, cook-place and database clearing …
        }
        if (session.status === 'signedIn') {
          dbOwner.set(ownerKey(session.userId, session.householdId));
          setReadyFor(ownerKey(session.userId, session.householdId));
        }
```

- compare `readyFor` with `ownerKey(userId, householdId)` wherever it compared with `userId`, so screens wait during a household switch;
- add `householdId` to the effect's dependencies;
- add `useMembershipWatch(state.status === 'signedIn' ? state.claims : null, online && readyFor !== null);`.

- [ ] **Step 4: Run the tests, typecheck and lint**

Run: `pnpm vitest run apps/mobile/src && pnpm typecheck && pnpm lint`
Expected: PASS and clean.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src
git commit -m "feat(app): local data keyed by household; follow role and household changes from the synced membership (FR-4, FR-5)"
```

---

### Task 6: App screens: Household, the invite page; end-to-end

**Files:**
- Create: `apps/mobile/src/household/api.ts`, `apps/mobile/src/household/api.test.ts`, `apps/mobile/src/household/hooks.ts`, `apps/mobile/src/household/share.ts`, `apps/mobile/src/household/pendingInvite.ts`, `apps/mobile/src/screens/HouseholdScreen.tsx`, `apps/mobile/src/screens/InviteScreen.tsx`, `apps/mobile/src/components/HouseholdNoticeBanner.tsx`, `apps/mobile/app/household.tsx`, `apps/mobile/app/invite/[code].tsx`, `e2e/household.spec.ts`
- Modify: `apps/mobile/app/sign-in.tsx`, `apps/mobile/src/screens/RecipeListScreen.tsx`

**Interfaces:**
- Consumes: the endpoints (Task 4); notices, the local `memberships` and `households` tables (Task 5); `withSession`, `useNetworkOnline`, `auth`, `confirm`.
- Produces:
  - `type Result<T> = { ok: true; value: T } | { ok: false; message: string }`
  - client functions `createInvite`, `listInvites`, `cancelInvite`, `previewInvite`, `acceptInvite`, `setMemberRole`, `removeMember`, `leaveHousehold` and `renameHousehold`, all never throwing
  - `HOUSEHOLD_MESSAGES`, `inviteUrl(code)`, `shareLink(text, url): Promise<'shared' | 'copied' | 'cancelled'>`
  - `setPendingInvite(code)`, `takePendingInvite()`
  - `useMembers(householdId)`, `useHouseholdName(householdId)`
  - the routes `/household` and `/invite/[code]`
  - accessible names: "Household", "Invite link", "{Role} role for {email}", "Remove {email}"

- [ ] **Step 1: Write the failing tests**

`apps/mobile/src/household/api.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { acceptInvite, createInvite, previewInvite, setMemberRole } from './api';

const deps = (response: Response | Error) => ({
  fetch: vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  }) as unknown as typeof fetch,
  apiUrl: 'https://app.test/api',
  token: 'jwt',
});
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const CODE = 'k3J9xQ2mZb7LwP0aYc5RdT8vNf1HgE4sUo6IiKjMnBq';

describe('household api', () => {
  it('creates an invite with the token', async () => {
    const d = deps(json(201, { id: 'i1', code: CODE, expires_at: '2026-10-24T00:00:00.000Z' }));
    expect(await createInvite('member', d)).toEqual({
      ok: true,
      value: { id: 'i1', code: CODE, expires_at: '2026-10-24T00:00:00.000Z' },
    });
    expect(d.fetch).toHaveBeenCalledWith('https://app.test/api/invites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt' },
      body: JSON.stringify({ role: 'member' }),
    });
  });

  it.each([
    ['last_admin', 'Make someone else an Admin first'],
    ['invite_used', 'This invite has already been used'],
    ['only_admin', 'Make someone else an Admin of your household first'],
    ['forbidden', 'Only an Admin can do that'],
  ])('turns the %s refusal into its message', async (key, message) => {
    expect(await setMemberRole('u1', 'viewer', deps(json(409, { error: key })))).toEqual({ ok: false, message });
  });

  it('never throws: a network failure is a message', async () => {
    expect(await acceptInvite(CODE, deps(new Error('offline')))).toEqual({
      ok: false,
      message: 'Changing the household needs a connection',
    });
    expect((await previewInvite(CODE, deps(json(200, { status: 'ok', household_name: 'H', role: 'member', moving_recipes: 0, blocker: null })))).ok).toBe(true);
  });
});
```

`e2e/household.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test';
import { addRecipe, findRecipe, freshEmail, session, signIn, unique } from './helpers';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

async function inviteLink(admin: Page, role: 'Member' | 'Viewer' = 'Member'): Promise<string> {
  await admin.getByRole('link', { name: 'Household' }).click();
  await admin.getByRole('button', { name: role, exact: true }).click();
  await admin.getByRole('button', { name: 'Share invite' }).click();
  return (await admin.getByLabel('Invite link').textContent())!.trim();
}

test('an invited person joins, is made a Viewer, and is removed (FR-3, FR-4, FR-5)', async ({ page, browser }) => {
  const adminEmail = freshEmail('hh-admin');
  await signIn(page, adminEmail);
  const title = unique('Family soup');
  await addRecipe(page, title);
  const link = await inviteLink(page);

  const joinerEmail = freshEmail('hh-joiner');
  const joiner = await session(browser, joinerEmail);
  await joiner.goto(link);
  await expect(joiner.getByText(/^Join the .+ as a Member$/)).toBeVisible();
  await joiner.getByRole('button', { name: 'Join' }).click();
  await expect(joiner.getByText(/^You've joined the /)).toBeVisible({ timeout: 30_000 });
  await expect(await findRecipe(joiner, title)).toBeVisible({ timeout: 30_000 });

  await page.reload();
  await expect(page.getByText(joinerEmail)).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: `Viewer role for ${joinerEmail}` }).click();
  await (await findRecipe(joiner, title)).click();
  await expect(joiner.getByRole('button', { name: 'Edit' })).toHaveCount(0, { timeout: 60_000 });

  await page.getByRole('button', { name: `Remove ${joinerEmail}` }).click();
  await expect(joiner.getByText(/^You were moved to the /)).toBeVisible({ timeout: 60_000 });
  await expect(joiner.getByText('No recipes yet')).toBeVisible();
  await joiner.context().close();
});

test('a person with recipes brings them, then leaves (FR-3, FR-5)', async ({ page, browser }) => {
  await signIn(page, freshEmail('hh-host'));
  const link = await inviteLink(page);
  const joiner = await session(browser, freshEmail('hh-bringer'));
  const mine = unique('Brought pie');
  await addRecipe(joiner, mine);
  await joiner.goto(link);
  await expect(joiner.getByText('Your 1 recipe will move to the', { exact: false })).toBeVisible();
  await joiner.getByRole('button', { name: 'Join' }).click();
  await expect(joiner.getByText(/^You've joined the /)).toBeVisible({ timeout: 30_000 });
  await page.getByRole('link', { name: 'All recipes' }).click();
  await expect(await findRecipe(page, mine)).toBeVisible({ timeout: 30_000 });

  await joiner.getByRole('link', { name: 'Household' }).click();
  await joiner.getByRole('button', { name: 'Leave household' }).click();
  await expect(joiner.getByText(/^You were moved to the /)).toBeVisible({ timeout: 60_000 });
  await expect(joiner.getByText('No recipes yet')).toBeVisible();
  await joiner.context().close();
});

test('a used link says so (FR-3)', async ({ page, browser }) => {
  await signIn(page, freshEmail('hh-once'));
  const link = await inviteLink(page);
  const first = await session(browser, freshEmail('hh-first'));
  await first.goto(link);
  await first.getByRole('button', { name: 'Join' }).click();
  await expect(first.getByText(/^You've joined the /)).toBeVisible({ timeout: 30_000 });
  const second = await session(browser, freshEmail('hh-second'));
  await second.goto(link);
  await expect(second.getByText('This invite has already been used')).toBeVisible();
  await expect(second.getByRole('button', { name: 'Join' })).toHaveCount(0);
  await first.context().close();
  await second.context().close();
});

test('the Household screen offline shows members and disables changes', async ({ page, context }) => {
  const email = freshEmail('hh-offline');
  await signIn(page, email);
  await page.getByRole('link', { name: 'Household' }).click();
  await expect(page.getByText(email)).toBeVisible({ timeout: 30_000 });
  await context.setOffline(true);
  await expect(page.getByText('Changing the household needs a connection')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Share invite' })).toHaveCount(0);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run apps/mobile/src/household && pnpm dev:backend:test && npx playwright test e2e/household.spec.ts -g "offline"`
Expected: FAIL. `./api` does not exist, and there is no Household link.

- [ ] **Step 3: The client modules**

`apps/mobile/src/household/api.ts`:

```ts
import type { HouseholdRoleName } from '@recipe-app/domain';
import type { ApiDeps } from '../imports/api';

export type Result<T> = { ok: true; value: T } | { ok: false; message: string };
export type PendingInvite = { id: string; role: HouseholdRoleName; expires_at: string; created_at: string };
export type InvitePreview = {
  status: 'ok' | 'used' | 'expired' | 'cancelled' | 'unknown' | 'already_member';
  household_name: string | null;
  role: HouseholdRoleName | null;
  moving_recipes: number;
  blocker: 'only_admin' | null;
};

const OFFLINE = 'Changing the household needs a connection';
export const HOUSEHOLD_MESSAGES: Record<string, string> = {
  forbidden: 'Only an Admin can do that',
  not_member: "That person isn't in this household",
  last_admin: 'Make someone else an Admin first',
  only_admin: 'Make someone else an Admin of your household first',
  alone: "You're the only one in this household",
  invite_used: 'This invite has already been used',
  invite_expired: 'This invite has expired',
  invite_cancelled: 'This invite was cancelled',
  invite_unknown: "This invite isn't valid",
  already_member: "You're already in this household",
  too_many_invites: 'Too many pending invites. Cancel some first.',
};

async function request<T>(
  deps: ApiDeps,
  method: string,
  path: string,
  body?: unknown,
): Promise<Result<T>> {
  try {
    const response = await deps.fetch(`${deps.apiUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${deps.token}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (response.status === 204) return { ok: true, value: undefined as T };
    const json = (await response.json().catch(() => null)) as { error?: string } | null;
    if (!response.ok) {
      return { ok: false, message: HOUSEHOLD_MESSAGES[json?.error ?? ''] ?? 'Something went wrong. Try again.' };
    }
    return { ok: true, value: json as T };
  } catch {
    return { ok: false, message: OFFLINE };
  }
}

export const createInvite = (role: HouseholdRoleName, deps: ApiDeps) =>
  request<{ id: string; code: string; expires_at: string }>(deps, 'POST', '/invites', { role });
export const listInvites = (deps: ApiDeps) => request<PendingInvite[]>(deps, 'GET', '/invites');
export const cancelInvite = (id: string, deps: ApiDeps) => request<void>(deps, 'DELETE', `/invites/${id}`);
export const previewInvite = (code: string, deps: ApiDeps) =>
  request<InvitePreview>(deps, 'POST', '/invites/preview', { token: code });
export const acceptInvite = (code: string, deps: ApiDeps) =>
  request<{ household_id: string; moved_recipes: number }>(deps, 'POST', '/invites/accept', { token: code });
export const setMemberRole = (userId: string, role: HouseholdRoleName, deps: ApiDeps) =>
  request<void>(deps, 'PATCH', `/members/${userId}`, { role });
export const removeMember = (userId: string, deps: ApiDeps) => request<void>(deps, 'DELETE', `/members/${userId}`);
export const leaveHousehold = (deps: ApiDeps) => request<void>(deps, 'POST', '/household/leave');
export const renameHousehold = (name: string, deps: ApiDeps) => request<void>(deps, 'PATCH', '/household', { name });

/** The link a person opens; built here so it is right on any host (Decisions). */
export function inviteUrl(code: string): string {
  return `${globalThis.location?.origin ?? ''}/invite/${code}`;
}
```

`apps/mobile/src/household/share.ts`:

```ts
/** Opens the share sheet where there is one; otherwise copies the link. */
export async function shareLink(text: string, url: string): Promise<'shared' | 'copied' | 'cancelled'> {
  const nav = globalThis.navigator as Navigator | undefined;
  if (nav?.share) {
    try {
      await nav.share({ text, url });
      return 'shared';
    } catch {
      return 'cancelled';
    }
  }
  await nav?.clipboard?.writeText(url).catch(() => undefined);
  return 'copied';
}
```

`apps/mobile/src/household/pendingInvite.ts`:

```ts
// An invite opened while signed out, picked up after sign-in (spec §6).
const KEY = 'recipes.pendingInvite';
export function setPendingInvite(code: string): void {
  globalThis.sessionStorage?.setItem(KEY, code);
}
export function takePendingInvite(): string | null {
  const code = globalThis.sessionStorage?.getItem(KEY) ?? null;
  globalThis.sessionStorage?.removeItem(KEY);
  return code && /^[A-Za-z0-9_-]{43}$/.test(code) ? code : null;
}
```

`apps/mobile/src/household/hooks.ts`:

```ts
import { useQuery } from '@powersync/react';

export type Member = { user_id: string; email: string | null; role: string; created_at: string | null };

export function useMembers(householdId: string): Member[] {
  const { data } = useQuery<Member>(
    'select user_id, email, role, created_at from memberships where household_id = ? order by created_at',
    [householdId],
  );
  return data;
}

export function useHouseholdName(householdId: string | null): string | null {
  const { data } = useQuery<{ name: string }>('select name from households where id = ?', [householdId ?? '']);
  return data[0]?.name ?? null;
}
```

- [ ] **Step 4: The screens**

`apps/mobile/src/components/HouseholdNoticeBanner.tsx`:

```tsx
import { useState } from 'react';
import { Text } from 'react-native';
import { useHouseholdName } from '../household/hooks';
import { takeNotice } from '../household/notice';
import type { Claims } from '../session/claims';

/** "You've joined the …" / "You were moved to the …", once (spec §6). */
export function HouseholdNoticeBanner({ claims }: { claims: Claims }) {
  const [notice] = useState(() => takeNotice());
  const synced = useHouseholdName(claims.householdId);
  if (!notice) return null;
  const name = notice.name ?? synced ?? 'new household';
  return (
    <Text role="status" style={{ backgroundColor: '#e6f0ea', padding: 10, borderRadius: 6 }}>
      {notice.kind === 'joined' ? `You've joined the ${name}` : `You were moved to the ${name}`}
    </Text>
  );
}
```

`apps/mobile/src/screens/HouseholdScreen.tsx`:

```tsx
import type { HouseholdRoleName } from '@recipe-app/domain';
import { Link } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { confirm } from '../components/confirm';
import { useNetworkOnline } from '../db/useNetworkOnline';
import { withSession } from '../imports/api';
import {
  cancelInvite,
  createInvite,
  inviteUrl,
  leaveHousehold,
  listInvites,
  removeMember,
  renameHousehold,
  setMemberRole,
  type PendingInvite,
  type Result,
} from '../household/api';
import { useHouseholdName, useMembers } from '../household/hooks';
import { shareLink } from '../household/share';
import type { Claims } from '../session/claims';

const ROLES: [HouseholdRoleName, string][] = [
  ['admin', 'Admin'],
  ['member', 'Member'],
  ['viewer', 'Viewer'],
];
const link = { textDecorationLine: 'underline' } as const;
const box = { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 } as const;
const days = (iso: string) => Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000));

/** FR-3–FR-6: who is in the household, and (for Admins) invites and roles. */
export function HouseholdScreen({ claims }: { claims: Claims }) {
  const online = useNetworkOnline();
  const members = useMembers(claims.householdId);
  const name = useHouseholdName(claims.householdId);
  const admin = claims.role === 'admin';
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [inviteRole, setInviteRole] = useState<HouseholdRoleName>('member');
  const [shared, setShared] = useState<string | null>(null);
  const [newName, setNewName] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!admin || !online) return;
    const result = await withSession(listInvites);
    if (result?.ok) setInvites(result.value);
  }, [admin, online]);
  useEffect(() => void refresh(), [refresh]);

  async function act<T>(run: () => Promise<Result<T> | null>, then?: (value: T) => void) {
    setMessage(null);
    const result = await run();
    if (!result) setMessage('Sign in again to change the household');
    else if (!result.ok) setMessage(result.message);
    else then?.(result.value);
  }

  async function invite() {
    await act(
      () => withSession((deps) => createInvite(inviteRole, deps)),
      async (created) => {
        const url = inviteUrl(created.code);
        setShared(url);
        const how = await shareLink(`Join the ${name ?? 'household'} on Recipes: ${url}`, url);
        if (how === 'copied') setMessage('Link copied');
        void refresh();
      },
    );
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14, maxWidth: 640 }}>
      <Link href="/" style={link}>
        All recipes
      </Link>
      <Text role="heading" aria-level={1} style={{ fontSize: 24, fontWeight: '600' }}>
        Household
      </Text>
      {newName === null ? (
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
          <Text style={{ fontSize: 18 }}>{name ?? ''}</Text>
          {admin && online ? (
            <Pressable role="button" onPress={() => setNewName(name ?? '')} style={box}>
              <Text style={link}>Rename</Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <TextInput
            aria-label="Household name"
            value={newName}
            onChangeText={setNewName}
            style={{ borderWidth: 1, borderColor: '#888', borderRadius: 6, padding: 8, flex: 1 }}
          />
          <Pressable
            role="button"
            style={box}
            onPress={() => void act(() => withSession((deps) => renameHousehold(newName, deps)), () => setNewName(null))}
          >
            <Text style={link}>Save</Text>
          </Pressable>
        </View>
      )}

      {!online ? <Text style={{ color: '#555' }}>Changing the household needs a connection</Text> : null}
      {message ? (
        <Text role="alert" style={{ color: message === 'Link copied' ? '#1a5d3a' : '#b00020' }}>
          {message}
        </Text>
      ) : null}

      <Text role="heading" aria-level={2} style={{ fontSize: 18, fontWeight: '600' }}>
        Members
      </Text>
      {members.map((member) => {
        const label = member.email ?? 'Email not known yet';
        const me = member.user_id === claims.userId;
        return (
          <View key={member.user_id} style={{ gap: 4, borderTopWidth: 1, borderColor: '#ddd', paddingTop: 8 }}>
            <Text>
              {label}
              {me ? ' (you)' : ''}
            </Text>
            <Text style={{ color: '#555' }}>
              {ROLES.find(([role]) => role === member.role)?.[1] ?? member.role}
              {member.created_at ? ` · joined ${new Date(member.created_at).toLocaleDateString()}` : ''}
            </Text>
            {admin && online ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                {ROLES.map(([role, text]) => (
                  <Pressable
                    key={role}
                    role="button"
                    aria-label={`${text} role for ${label}`}
                    aria-pressed={member.role === role}
                    style={box}
                    onPress={() => void act(() => withSession((deps) => setMemberRole(member.user_id, role, deps)))}
                  >
                    <Text style={{ fontWeight: member.role === role ? '700' : '400' }}>{text}</Text>
                  </Pressable>
                ))}
                {!me ? (
                  <Pressable
                    role="button"
                    aria-label={`Remove ${label}`}
                    style={box}
                    onPress={async () => {
                      if (
                        await confirm(
                          `Remove ${label} from the household? They'll keep their account and get an empty household of their own. Recipes they added stay here.`,
                        )
                      ) {
                        await act(() => withSession((deps) => removeMember(member.user_id, deps)));
                      }
                    }}
                  >
                    <Text style={{ ...link, color: '#b00020' }}>Remove</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </View>
        );
      })}

      {admin && online ? (
        <View style={{ gap: 8 }}>
          <Text role="heading" aria-level={2} style={{ fontSize: 18, fontWeight: '600' }}>
            Invite someone
          </Text>
          <View style={{ flexDirection: 'row', gap: 4 }}>
            {ROLES.map(([role, text]) => (
              <Pressable
                key={role}
                role="button"
                aria-pressed={inviteRole === role}
                onPress={() => setInviteRole(role)}
                style={{ ...box, borderRadius: 6, backgroundColor: inviteRole === role ? '#e6f0ea' : 'transparent' }}
              >
                <Text style={{ fontWeight: inviteRole === role ? '700' : '400' }}>{text}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable
            role="button"
            onPress={() => void invite()}
            style={{ backgroundColor: '#1a5d3a', borderRadius: 8, minHeight: 44, justifyContent: 'center', alignItems: 'center' }}
          >
            <Text style={{ color: '#fff', fontSize: 16 }}>Share invite</Text>
          </Pressable>
          {shared ? (
            <Text aria-label="Invite link" selectable style={{ backgroundColor: '#f4f4f4', padding: 8, borderRadius: 6 }}>
              {shared}
            </Text>
          ) : null}
          {invites.length > 0 ? (
            <>
              <Text role="heading" aria-level={3} style={{ fontWeight: '600' }}>
                Pending invites
              </Text>
              {invites.map((pending) => (
                <View key={pending.id} style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                  <Text style={{ flex: 1 }}>
                    {ROLES.find(([role]) => role === pending.role)?.[1]} · expires in {days(pending.expires_at)} days
                  </Text>
                  <Pressable
                    role="button"
                    style={box}
                    onPress={() => void act(() => withSession((deps) => cancelInvite(pending.id, deps)), () => void refresh())}
                  >
                    <Text style={link}>Cancel</Text>
                  </Pressable>
                </View>
              ))}
            </>
          ) : null}
        </View>
      ) : null}

      {members.length > 1 && online ? (
        <Pressable
          role="button"
          style={box}
          onPress={async () => {
            if (await confirm('Leave the household? You will get an empty household of your own. The recipes stay here.')) {
              await act(() => withSession(leaveHousehold));
            }
          }}
        >
          <Text style={{ ...link, color: '#b00020' }}>Leave household</Text>
        </Pressable>
      ) : null}
      <Pressable
        role="button"
        style={box}
        onPress={() => {
          const url = globalThis.location?.origin ?? '';
          void shareLink(`Make your own recipe collection: ${url}`, url).then((how) => {
            if (how === 'copied') setMessage('Link copied');
          });
        }}
      >
        <Text style={link}>Invite a friend to Recipes</Text>
      </Pressable>
    </ScrollView>
  );
}
```

`apps/mobile/src/screens/InviteScreen.tsx`:

```tsx
import { usePowerSync } from '@powersync/react';
import { Link, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { withSession } from '../imports/api';
import { acceptInvite, HOUSEHOLD_MESSAGES, previewInvite, type InvitePreview } from '../household/api';
import { setNotice } from '../household/notice';
import { setPendingInvite } from '../household/pendingInvite';
import { auth } from '../session/auth';
import { useSession } from '../session/SessionProvider';

const ROLE_LABEL: Record<string, string> = { admin: 'Admin', member: 'Member', viewer: 'Viewer' };
const STATUS_TEXT: Record<string, string> = {
  used: HOUSEHOLD_MESSAGES.invite_used!,
  expired: HOUSEHOLD_MESSAGES.invite_expired!,
  cancelled: HOUSEHOLD_MESSAGES.invite_cancelled!,
  unknown: HOUSEHOLD_MESSAGES.invite_unknown!,
};
const UPLOAD_WAIT_TRIES = 60;

/** FR-3: the page an invite link opens (spec §6). */
export function InviteScreen({ code }: { code: string }) {
  const { state } = useSession();
  useEffect(() => {
    if (state.status === 'signedOut') setPendingInvite(code);
  }, [state.status, code]);
  if (state.status === 'loading') return null;
  if (state.status === 'signedOut') {
    return (
      <View style={{ padding: 16, gap: 12, maxWidth: 480 }}>
        <Text style={{ fontSize: 18 }}>You've been invited to a household. Sign in to see the invite.</Text>
        <Link href="/sign-in" style={{ textDecorationLine: 'underline' }}>
          Sign in
        </Link>
      </View>
    );
  }
  return <SignedInInvite code={code} />;
}

function SignedInInvite({ code }: { code: string }) {
  const db = usePowerSync();
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    void withSession((deps) => previewInvite(code, deps)).then((result) => {
      if (!result) return;
      if (result.ok) setPreview(result.value);
      else setMessage(result.message);
    });
  }, [code]);

  async function join() {
    if (!preview) return;
    setJoining(true);
    setMessage(null);
    // Unsent edits must reach the server before the data moves (Review Focus 1).
    for (let tries = 0; (await db.getUploadQueueStats()).count > 0; tries++) {
      if (tries >= UPLOAD_WAIT_TRIES) {
        setJoining(false);
        setMessage('Still saving your changes. Try again in a moment.');
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const result = await withSession((deps) => acceptInvite(code, deps));
    if (!result?.ok) {
      setJoining(false);
      setMessage(result?.message ?? 'Sign in again to join');
      return;
    }
    setNotice({ kind: 'joined', name: preview.household_name });
    await auth.refreshSession();
    router.replace('/');
  }

  const name = preview?.household_name ?? 'household';
  const blocked = preview?.blocker === 'only_admin';
  return (
    <View style={{ padding: 16, gap: 12, maxWidth: 480 }}>
      {!preview && !message ? <ActivityIndicator /> : null}
      {preview?.status === 'ok' ? (
        <>
          <Text style={{ fontSize: 20 }}>
            Join the {name} as a {ROLE_LABEL[preview.role ?? 'member']}
          </Text>
          {preview.moving_recipes > 0 ? (
            <Text>
              Your {preview.moving_recipes} {preview.moving_recipes === 1 ? 'recipe' : 'recipes'} will move to the {name}
            </Text>
          ) : null}
          {blocked ? <Text role="alert">{HOUSEHOLD_MESSAGES.only_admin}</Text> : null}
          {!blocked ? (
            <Pressable
              role="button"
              aria-disabled={joining}
              onPress={() => void join()}
              style={{ backgroundColor: '#1a5d3a', borderRadius: 8, minHeight: 44, justifyContent: 'center', alignItems: 'center' }}
            >
              <Text style={{ color: '#fff', fontSize: 16 }}>{joining ? 'Joining…' : 'Join'}</Text>
            </Pressable>
          ) : null}
        </>
      ) : null}
      {preview?.status === 'already_member' ? <Text>You're already in the {name}</Text> : null}
      {preview && STATUS_TEXT[preview.status] ? <Text role="alert">{STATUS_TEXT[preview.status]}</Text> : null}
      {message ? <Text role="alert">{message}</Text> : null}
      <Link href="/" style={{ textDecorationLine: 'underline' }}>
        All recipes
      </Link>
    </View>
  );
}
```

The spec's "Your recipes stay with the <old name>" line is left out: the preview can't tell a person alone with no recipes from one in a shared household (see Decisions).

Routes:
- `apps/mobile/app/household.tsx`: `<SignedIn>{(claims) => <HouseholdScreen claims={claims} />}</SignedIn>`.
- `apps/mobile/app/invite/[code].tsx`: `export default function Invite() { const { code } = useLocalSearchParams<{ code: string }>(); return <InviteScreen code={String(code)} />; }` (not wrapped in `SignedIn`).
- `apps/mobile/app/sign-in.tsx`: on `signedIn`, run `const pending = takePendingInvite();` and `return <Redirect href={pending ? `/invite/${pending}` : '/'} />;`.

In `apps/mobile/src/screens/RecipeListScreen.tsx`:
- next to the Trash link (for every role), add `<Link href="/household" style={link}>Household</Link>`;
- at the top of the screen's content, add `<HouseholdNoticeBanner claims={claims} />`.

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run apps/mobile/src && pnpm typecheck && pnpm lint && pnpm dev:backend:test && docker compose restart sync && npx playwright test e2e/household.spec.ts`
Expected: PASS. Then run the whole e2e suite with `pnpm test:e2e`, which is expected to PASS. The sign-in, session and sync specs check the wipe behaviour.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile e2e
git commit -m "feat(app): Household screen with invites, roles, remove and leave; the invite page (FR-3, FR-4, FR-5, FR-6)"
```

---

### Task 7: Documentation

**Files:**
- Create: `docs/adr/0015-household-moves-and-live-roles.md`
- Modify: `docs/adr/README.md`, `CLAUDE.md`, `ARCHITECTURE.md`, `docs/SPEC.md`

- [ ] **Step 1: ADR-0015**

`docs/adr/0015-household-moves-and-live-roles.md`:

```markdown
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
```

Add the 0015 row to `docs/adr/README.md`.

- [ ] **Step 2: CLAUDE.md, ARCHITECTURE and SPEC**

- **`CLAUDE.md` rule 1:** after "…for background work; ADR-0012)", add: "; cross-household changes go only through the `SECURITY DEFINER` household functions of ADR-0015, which check the caller themselves".
- **`ARCHITECTURE.md`:**
  - add the Household screen to the mobile components (`Component(household, "Household", "Screen", "Members, roles, invites; follows membership changes (FR-3–6)")`);
  - add `Component(invites, "Household API", "/api/invites, /api/members, /api/household", "Calls the household definer functions (ADR-0015)")` to the API;
  - add `HOUSEHOLD ||--o{ INVITE : issues` (already present as an entity) with its columns noted in the conventions list.
- **`docs/SPEC.md`:** append "(built in sub-project 6)" to FR-3, FR-5 and FR-6.

- [ ] **Step 3: Full verification**

```bash
pnpm lint && pnpm typecheck && pnpm test
pnpm dev:backend:test && docker compose restart sync
pnpm test:stack && pnpm test:rls && pnpm test:api
pnpm test:e2e
pnpm dev:backend
```

Expected: every suite passes, and the last command returns the stack to the real AI. Then confirm the owner's account still has its household and recipes:

```bash
docker compose exec -T db psql -U postgres -d app -Atc "select count(*) from public.memberships; select count(*) from public.recipes"
```

The counts should be at least what they were before the migration (445 users and 891 recipes, plus the test runs).

- [ ] **Step 4: Commit**

```bash
git add docs CLAUDE.md ARCHITECTURE.md
git commit -m "docs: ADR-0015 household moves and live roles; CLAUDE.md rule 1, ARCHITECTURE, SPEC (FR-3, FR-4, FR-5, FR-6)"
```
