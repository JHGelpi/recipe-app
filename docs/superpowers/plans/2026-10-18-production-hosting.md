# Running Dishkept for Real: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run Dishkept at https://dishkept.geltech.dev from a production Compose project on the owner's PC, apart from dev, gated to invited people, with nightly encrypted off-site backups and a tested restore.

**Architecture:** Production is the same `docker-compose.yml` plus a small `docker-compose.prod.yml` (no host ports, its own Caddy data, the `cloudflared` tunnel) run as project `dishkept` with `.env.production`. A `backup` service (profile `backup`, so the tests can run it against the dev stack) dumps, encrypts with `age`, and uploads with `rclone`. A GoTrue `before_user_created` Postgres hook enforces the sign-up gate; signed-out link flows first ask the API for a 24-hour pass. Ops commands live in `scripts/prod/cli.mjs`, with their decisions in a pure `scripts/prod/lib.mjs`.

**Tech Stack:** Docker Compose v5, Postgres 17 (`pg_dump`/`pg_restore`), GoTrue 2.197 hooks, Hono, Expo Router, Caddy, `cloudflare/cloudflared`, `age`, `rclone`, `msmtp`, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-18-production-hosting-design.md`

## Global Constraints

- Address `https://dishkept.geltech.dev`; Compose project **`dishkept`**; env file **`.env.production`** with `APP_ENV=production` and `COMPOSE_PROJECT_NAME=dishkept`.
- `prod:*` scripts always pass `-p dishkept --env-file .env.production -f docker-compose.yml -f docker-compose.prod.yml` and never read `.env`; they refuse if `COMPOSE_FILE` is set.
- **No host ports in production.** Tunnel target `http://proxy:8080`.
- The guard runs first in `db:reset`, `db:seed`, `dev:backend`, `dev:backend:test`, `dev:backend:stop` and every `test:*` command.
- Email: `SMTP_HOST=smtp.zoho.com`, `SMTP_PORT=465`, `SMTP_FROM` = `SMTP_USER` = `wes@data2insightsllc.com` for now; `SMTP_SENDER_NAME` default `Dishkept`. Never hard-code the sender.
- Production rate limits: `AUTH_RATE_LIMIT=10`, `AUTH_EMAIL_MAX_FREQUENCY=60s`.
- Gate refusal key `invite_only`, HTTP 403. Copy: **"Dishkept is invite-only for now. Ask someone who uses it to send you an invite."**
- Passes last **24 hours**; friend links **30 days**; local backup copies **7**; GCS lifecycle **30 days**; stale backup warning after **26 hours**; `BACKUP_TIME` default `03:30`, `TZ` default `America/New_York`.
- Backup file name `dishkept-YYYY-MM-DD.tar.age`, holding `app.dump`, `photos.tar`, `manifest.json`.
- Signup tables hold only emails, times and the gate flag; RLS on, **no policies, no grants** to `authenticated`/`anon`; not synced.
- CLAUDE.md rule 1 still holds: the API uses `api_login` only, signed-out reads go through `asAnonymous` and security definer functions. The backup's `postgres` login is an operations path only.
- **Never run `pnpm db:reset`** on this machine during this work (it deleted the owner's account before). Restart sync after stack changes: `docker compose restart sync`.
- Conventional Commits with requirement IDs; commits end with the Co-Authored-By line.

## Review Focus

1. **Existing accounts with the gate on**: someone who already has an account but opens a dead invite or friend link must still sign in. Pinned in Task 3 (e2e "an existing account signs in through a dead friend link").
2. **A drill or test touching production**: `prod:restore-test` must never start `cloudflared`; a second connector with the same token would serve the drill to the public. Pinned in Task 5 (the drill command leaves out the `tunnel` profile; `lib.test.mjs` "drill compose args never include the tunnel profile").
3. **Case and spaces in emails**: `Wes@X.com ` on the allowed list or in a pass must match `wes@x.com` at the hook. Pinned in Task 1 (hook test with mixed case and spaces) and Task 4 (`prod:allow` normalizes).
4. **The gate left on after a failing test**: a gate test that throws must still switch the gate off, or every later fresh sign-up in the run fails. Pinned in Tasks 1 and 3 (`finally`/`afterEach` gate off; the e2e spec turns it off in `afterEach`).
5. **Restore with the wrong key or a corrupt file** must stop before anything is dropped. Pinned in Task 5 (`test:backup` "restore with the wrong key fails and the database is untouched").

## Where this plan departs from the spec

Each item is the smallest change that keeps the spec's intent. Each is recorded as a ruling during execution.

- **Gate on and owner listed at the first `prod:deploy`, not at `prod:init`.** `init` runs before any database exists. `deploy` does it once, when the allowed list is empty.
- **Rate limiting is new code.** The spec said "like the other signed-out routes", but the API has no limiter today. Task 2 adds an in-memory one for `/api/signup-pass`.
- **A dead friend link shows "This link has expired" after the email is entered,** not on page load. This avoids a new lookup endpoint. Existing accounts still sign in through it.
- **The `backup` service lives in `docker-compose.yml` under profile `backup`,** not in the overlay, so `test:backup` can run it against the test stack. `cloudflared` stays in the overlay under profile `tunnel`. The overlay also gives `proxy` its own `caddy_data` volume, so dev's bind-mounted `.local/caddy` is never shared.

---

### Task 1: The sign-up gate in the database

**Files:**
- Create: `db/migrations/20261023000000_create_signup_gate.sql`
- Modify: `docker-compose.yml` (auth: hook env, sender name)
- Modify: `apps/api/tests/rls/registry.ts`, `apps/api/tests/rls/coverage.test.ts`, `apps/api/tests/rls/roles.test.ts`
- Create: `apps/api/tests/helpers/gate.ts`
- Test: `apps/api/tests/rls/signup-gate.test.ts`, `apps/api/tests/stack/signup-gate.test.ts`

**Interfaces:**
- Produces (SQL):
  - `public.before_user_created_hook(event jsonb) returns jsonb`, which returns `{}` to allow or `{"error":{"http_code":403,"message":"invite_only"}}`;
  - `public.grant_signup_pass(link_kind text, link_code text, address text) returns boolean`, executable by `authenticated`;
  - `public.create_friend_link() returns table (id uuid, token text, expires_at timestamptz)`, executable by `authenticated`;
  - tables `signup_settings(id, gate_on)`, `signup_allowed(email, created_at)`, `signup_passes(email, expires_at)` and `friend_links`.
- Produces (TS, `apps/api/tests/helpers/gate.ts`): `setGate(on: boolean): Promise<void>`, `allow(email: string): Promise<void>`, `clearGateRows(emails: string[]): Promise<void>`.
- Produces (registry): `SYSTEM_TABLES` = `['signup_allowed', 'signup_passes', 'signup_settings']`.

- [ ] **Step 1: Write the gate helper and the failing RLS tests**

`apps/api/tests/helpers/gate.ts`:

```ts
import { adminSql } from './db';

/** The gate is shared state: callers must switch it off in a finally/afterEach. */
export async function setGate(on: boolean): Promise<void> {
  await adminSql`update public.signup_settings set gate_on = ${on}`;
}

export async function allow(email: string): Promise<void> {
  await adminSql`insert into public.signup_allowed (email) values (${email.trim().toLowerCase()})
    on conflict do nothing`;
}

export async function clearGateRows(emails: string[]): Promise<void> {
  const lower = emails.map((email) => email.trim().toLowerCase());
  await adminSql`delete from public.signup_allowed where email = any(${lower})`;
  await adminSql`delete from public.signup_passes where email = any(${lower})`;
}
```

`apps/api/tests/rls/signup-gate.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { SEED, signInAs, signInFresh, type Actor } from '../../../../test-support/auth';
import { adminSql, as, refusalCode } from '../helpers/db';
import { asAnonymous } from '../helpers/anonymous';
import { allow, clearGateRows, setGate } from '../helpers/gate';

const address = (tag: string) => `${tag}-${randomUUID()}@example.test`;
const used: string[] = [];
afterEach(async () => {
  await setGate(false);
  await clearGateRows(used.splice(0));
});

async function hook(email: string): Promise<unknown> {
  const [row] = await adminSql<{ out: unknown }[]>`
    select public.before_user_created_hook(${adminSql.json({ user: { email } })}) as out`;
  return row!.out;
}
const REFUSED = { error: { http_code: 403, message: 'invite_only' } };

async function grant(kind: string, code: string, email: string): Promise<boolean> {
  const [row] = await asAnonymous(
    (tx) => tx<{ ok: boolean }[]>`select public.grant_signup_pass(${kind}, ${code}, ${email}) as ok`,
  );
  return row!.ok;
}

async function inviteCode(admin: Actor): Promise<string> {
  const [row] = await as(
    admin,
    (tx) => tx<{ token: string }[]>`select token from public.create_invite('member')`,
  );
  return row!.token;
}

async function friendCode(actor: Actor): Promise<string> {
  const [row] = await as(
    actor,
    (tx) => tx<{ token: string }[]>`select token from public.create_friend_link()`,
  );
  return row!.token;
}

describe('the sign-up gate hook', () => {
  it('lets everyone through while the gate is off', async () => {
    expect(await hook(address('open'))).toEqual({});
  });

  it('with the gate on, allows listed emails and live passes, ignoring case and spaces', async () => {
    const listed = address('listed');
    const passed = address('passed');
    used.push(listed, passed);
    await setGate(true);
    await allow(listed);
    await adminSql`insert into public.signup_passes (email, expires_at)
      values (${passed}, now() + interval '1 hour')`;
    expect(await hook(`  ${listed.toUpperCase()} `)).toEqual({});
    expect(await hook(passed)).toEqual({});
    expect(await hook(address('stranger'))).toEqual(REFUSED);
  });

  it('refuses an expired pass', async () => {
    const late = address('late');
    used.push(late);
    await setGate(true);
    await adminSql`insert into public.signup_passes (email, expires_at)
      values (${late}, now() - interval '1 minute')`;
    expect(await hook(late)).toEqual(REFUSED);
  });
});

describe('passes from links', () => {
  it('a live invite, share or friend code grants a 24-hour pass to the lowercased email', async () => {
    const admin = await signInFresh(address('pass-admin'));
    const email = address('Invited');
    used.push(email);
    expect(await grant('invite', await inviteCode(admin), ` ${email.toUpperCase()}`)).toBe(true);
    const [row] = await adminSql<{ email: string; hours: number }[]>`
      select email, extract(epoch from expires_at - now()) / 3600 as hours
      from public.signup_passes where email = ${email.toLowerCase()}`;
    expect(row?.email).toBe(email.toLowerCase());
    expect(row!.hours).toBeGreaterThan(23.9);

    const recipe = randomUUID();
    await as(admin, (tx) => tx`insert into public.recipes (id, household_id, title)
      values (${recipe}, ${admin.householdId}, 'Pass soup')`);
    const [share] = await as(admin, (tx) => tx<{ token: string }[]>`
      select token from public.create_share(${randomUUID()}, ${recipe}, ${tx.json({ title: 'Pass soup' })})`);
    expect(await grant('share', share!.token, email)).toBe(true);
    expect(await grant('friend', await friendCode(admin), email)).toBe(true);
  });

  it('dead codes, wrong kinds and bad emails grant nothing', async () => {
    const admin = await signInFresh(address('dead-admin'));
    const email = address('nobody');
    used.push(email);
    const invite = await inviteCode(admin);
    await adminSql`update public.invites set deleted_at = now()
      where token_hash = sha256(convert_to(${invite}, 'UTF8'))`;
    expect(await grant('invite', invite, email)).toBe(false);
    const friend = await friendCode(admin);
    await adminSql`update public.friend_links set expires_at = now() - interval '1 second'
      where token_hash = sha256(convert_to(${friend}, 'UTF8'))`;
    expect(await grant('friend', friend, email)).toBe(false);
    expect(await grant('share', 'x'.repeat(43), email)).toBe(false);
    expect(await grant('household', await friendCode(admin), email)).toBe(false);
    expect(await grant('friend', await friendCode(admin), 'not-an-email')).toBe(false);
    expect(
      await adminSql`select 1 from public.signup_passes where email = ${email}`,
    ).toHaveLength(0);
  });

  it('expired passes are cleared whenever a pass is granted', async () => {
    const stale = address('stale');
    used.push(stale);
    await adminSql`insert into public.signup_passes (email, expires_at)
      values (${stale}, now() - interval '1 hour')`;
    await grant('share', 'x'.repeat(43), address('any'));
    expect(await adminSql`select 1 from public.signup_passes where email = ${stale}`).toHaveLength(0);
  });
});

describe('who can reach the gate tables', () => {
  it('nobody signed in, and no anonymous caller, can read or write them', async () => {
    const admin = await signInAs(SEED.adminA);
    for (const table of ['signup_settings', 'signup_allowed', 'signup_passes']) {
      expect(await refusalCode(as(admin, (tx) => tx`select * from public.${tx(table)}`))).toBe('42501');
      expect(await refusalCode(asAnonymous((tx) => tx`select * from public.${tx(table)}`))).toBe('42501');
    }
    expect(
      await refusalCode(as(admin, (tx) => tx`insert into public.signup_allowed (email) values ('x@y.z')`)),
    ).toBe('42501');
  });
});

describe('friend links', () => {
  it('any member, viewers included, can make one; only admins and members can list them', async () => {
    const viewer = await signInAs(SEED.viewerA);
    const member = await signInAs(SEED.memberA);
    expect(await friendCode(viewer)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await as(viewer, (tx) => tx`select id from public.friend_links`)).toHaveLength(0);
    const rows = await as(member, (tx) => tx<{ household_id: string }[]>`
      select household_id from public.friend_links`);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.household_id === member.householdId)).toBe(true);
  });
});
```

Note: the `create_share` snapshot above is minimal. If `create_share` validates the snapshot shape, copy the `snapshot()` helper from `apps/api/tests/rls/shares.test.ts` instead.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm test:rls -- signup-gate`
Expected: FAIL. The functions and tables don't exist (`function public.before_user_created_hook(jsonb) does not exist`).

- [ ] **Step 3: Write the migration**

`db/migrations/20261023000000_create_signup_gate.sql`:

```sql
-- migrate:up
-- Who may sign up (production spec §4; ADR-0018). Runs as app_owner.
-- GoTrue calls before_user_created_hook before it creates any account. With
-- the gate on, only listed emails and emails holding a live pass get through.
-- Passes come from live invite, share or friend links (grant_signup_pass).

create table public.signup_settings (
  id boolean primary key default true check (id), -- one row
  gate_on boolean not null default false
);
insert into public.signup_settings default values;

create table public.signup_allowed (
  email text primary key check (email = lower(btrim(email))),
  created_at timestamptz not null default now()
);

create table public.signup_passes (
  email text primary key check (email = lower(btrim(email))),
  expires_at timestamptz not null
);

-- RLS on and no policies or grants: only the functions below (owned by
-- app_owner) and the postgres login of the prod:* scripts reach these rows.
alter table public.signup_settings enable row level security;
alter table public.signup_allowed enable row level security;
alter table public.signup_passes enable row level security;
revoke all on public.signup_settings, public.signup_allowed, public.signup_passes from public;

-- "Make your own collection" links (FR-6). Not synced.
create table public.friend_links (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id),
  token_hash bytea not null unique, -- sha256 of the link's code; the code is never stored
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  deleted_at timestamptz
);
create index friend_links_household_id_idx on public.friend_links (household_id);

create trigger friend_links_stamp before insert or update on public.friend_links
for each row execute function public.stamp_row();

grant select on public.friend_links to authenticated;
alter table public.friend_links enable row level security;

create policy friend_links_select on public.friend_links
for select to authenticated
using (
  household_id = (select public.auth_household_id())
  and (select public.auth_household_role()) in ('admin', 'member')
);

create function public.create_friend_link()
returns table (id uuid, token text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  home uuid;
  code text;
  new_id uuid;
  new_expiry timestamptz;
begin
  -- Any member may invite a friend to start their own household: it adds
  -- nothing to this one, so viewers may too.
  select l.household into home from public.lock_my_household() l;
  if (select count(*) from public.friend_links f
      where f.household_id = home and f.deleted_at is null and f.expires_at > now()) >= 50 then
    perform public.household_refuse('too_many_invites');
  end if;
  code := translate(rtrim(encode(decode(
    replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'hex'), 'base64'), '='), '+/', '-_');
  insert into public.friend_links (household_id, token_hash, expires_at)
  values (home, sha256(convert_to(code, 'UTF8')), now() + interval '30 days')
  returning friend_links.id, friend_links.expires_at into new_id, new_expiry;
  return query select new_id, code, new_expiry;
end;
$$;

-- Called signed out (asAnonymous). Says only yes or no.
create function public.grant_signup_pass(link_kind text, link_code text, address text)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  who text := lower(btrim(coalesce(address, '')));
  hash bytea := sha256(convert_to(coalesce(link_code, ''), 'UTF8'));
  live boolean;
begin
  delete from public.signup_passes p where p.expires_at <= now();
  if length(who) > 254 or who !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    return false;
  end if;
  live := case link_kind
    when 'invite' then exists (
      select 1 from public.invites i
      where i.token_hash = hash and i.deleted_at is null and i.accepted_at is null
        and i.expires_at > now())
    when 'share' then coalesce((select r.status = 'ok' from public.read_share(link_code) r), false)
    when 'friend' then exists (
      select 1 from public.friend_links f
      join public.households h on h.id = f.household_id
      where f.token_hash = hash and f.deleted_at is null and f.expires_at > now()
        and h.deleted_at is null)
    else false
  end;
  if not live then return false; end if;
  insert into public.signup_passes (email, expires_at) values (who, now() + interval '24 hours')
  on conflict (email) do update set expires_at = excluded.expires_at;
  return true;
end;
$$;

-- GoTrue's before_user_created hook (pg-functions). Returning an error object
-- refuses the sign-up with that status and message.
create function public.before_user_created_hook(event jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  who text := lower(btrim(coalesce(event -> 'user' ->> 'email', '')));
begin
  if not (select s.gate_on from public.signup_settings s)
     or exists (select 1 from public.signup_allowed a where a.email = who)
     or exists (select 1 from public.signup_passes p where p.email = who and p.expires_at > now()) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'invite_only'));
end;
$$;

revoke execute on function public.create_friend_link(), public.grant_signup_pass(text, text, text),
  public.before_user_created_hook(jsonb) from public;
grant execute on function public.create_friend_link(), public.grant_signup_pass(text, text, text)
  to authenticated;
grant execute on function public.before_user_created_hook(jsonb) to supabase_auth_admin;

-- migrate:down
drop function public.before_user_created_hook(jsonb);
drop function public.grant_signup_pass(text, text, text);
drop function public.create_friend_link();
drop table public.friend_links;
drop table public.signup_passes;
drop table public.signup_allowed;
drop table public.signup_settings;
```

In `docker-compose.yml` under `auth.environment`, after the custom access token hook lines, add:

```yaml
      GOTRUE_HOOK_BEFORE_USER_CREATED_ENABLED: 'true'
      GOTRUE_HOOK_BEFORE_USER_CREATED_URI: pg-functions://postgres/public/before_user_created_hook
```

and change `GOTRUE_SMTP_SENDER_NAME: Dishkept` to `GOTRUE_SMTP_SENDER_NAME: ${SMTP_SENDER_NAME:-Dishkept}`.

In `.env.example`, under `# --- Email ---`, add `SMTP_SENDER_NAME=Dishkept`.

- [ ] **Step 4: Update the registry, the coverage guard and the grants test**

`apps/api/tests/rls/registry.ts`: add `'friend_links'` to `TENANT_TABLES` and `friend_links: 'household_id'` to `TENANT_COLUMN`, then append:

```ts
/**
 * Public tables that hold no household data (production spec §4): RLS on,
 * no policies, no grants. Only security definer functions and postgres reach them.
 */
export const SYSTEM_TABLES = ['signup_allowed', 'signup_passes', 'signup_settings'] as const;
```

`apps/api/tests/rls/coverage.test.ts`: import `SYSTEM_TABLES` and compare against `[...TENANT_TABLES, ...SYSTEM_TABLES].sort()`.

`apps/api/tests/rls/roles.test.ts`, in "holds exactly the intended table grants": add `friend_links: ['SELECT'],` and after that expectation add:

```ts
    expect(grants.filter((grant) => grant.table_name.startsWith('signup_'))).toEqual([]);
```

- [ ] **Step 5: Restart the test stack and run the RLS suite**

Run: `pnpm dev:backend:test && docker compose restart sync && pnpm test:rls`
Expected: PASS, including the 7 new tests in `signup-gate.test.ts`, `coverage`, `roles`, and the per-table isolation tests for `friend_links`.

- [ ] **Step 6: Write the failing stack test for GoTrue's refusal**

`apps/api/tests/stack/signup-gate.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { AuthClient } from '@supabase/auth-js';
import { afterEach, expect, it } from 'vitest';
import { env } from '../../../../test-support/env';
import { SEED, signInFresh } from '../../../../test-support/auth';
import { adminSql } from '../helpers/db';
import { clearGateRows, setGate } from '../helpers/gate';

const used: string[] = [];
afterEach(async () => {
  await setGate(false);
  await clearGateRows(used.splice(0));
});

const client = () =>
  new AuthClient({
    url: env.authUrl,
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  });

it('with the gate on, GoTrue refuses an unknown email with invite_only and creates no account', async () => {
  const email = `stranger-${randomUUID()}@example.test`;
  used.push(email);
  await setGate(true);
  const { error } = await client().signInWithOtp({ email });
  expect(error?.status).toBe(403);
  expect(error?.message).toContain('invite_only');
  expect(await adminSql`select 1 from auth.users where email = ${email}`).toHaveLength(0);
});

it('the same email signs up once it holds a pass; existing accounts always sign in', async () => {
  const email = `passed-${randomUUID()}@example.test`;
  used.push(email);
  await setGate(true);
  await adminSql`insert into public.signup_passes (email, expires_at) values (${email}, now() + interval '1 hour')`;
  expect((await signInFresh(email)).householdId).toMatch(/^[0-9a-f-]{36}$/);
  expect((await signInFresh(SEED.memberA)).userId).toMatch(/^[0-9a-f-]{36}$/);
});
```

- [ ] **Step 7: Run it**

Run: `pnpm test:stack -- signup-gate`
Expected: PASS. If GoTrue reports the refusal in another shape (another status, or the message under `error.code`), record the observed shape as a ruling, assert it here, and use it in Task 3's `isInviteOnly`. If both tests fail because the hook never ran, check `docker compose logs auth` for a hook config error.

- [ ] **Step 8: Run the whole backend suite and commit**

Run: `pnpm test:stack && pnpm test:rls && pnpm test:api`
Expected: all PASS. The existing fresh sign-ups still work because the gate defaults to off.

```bash
git add db/migrations/20261023000000_create_signup_gate.sql docker-compose.yml .env.example apps/api/tests/helpers/gate.ts apps/api/tests/rls apps/api/tests/stack/signup-gate.test.ts
git commit -m "feat(auth): sign-up gate: allowed emails and passes from live links (FR-1, FR-6)"
```

---

### Task 2: API routes for passes and friend links

**Files:**
- Create: `apps/api/src/rateLimit.ts`, `apps/api/src/rateLimit.test.ts`
- Create: `apps/api/src/signup/service.ts`, `apps/api/src/signup/routes.ts`, `apps/api/src/signup/routes.test.ts`
- Modify: `apps/api/src/household/service.ts`, `apps/api/src/household/routes.ts`, `apps/api/src/app.ts`, `apps/api/src/server.ts`
- Modify: `package.json` (`test:api` gains `apps/api/tests/signup`)
- Test: `apps/api/tests/signup/signup.test.ts`

**Interfaces:**
- Consumes: `public.grant_signup_pass(text, text, text)` and `public.create_friend_link()` from Task 1.
- Produces (HTTP):
  - `POST /api/signup-pass` with body `{ kind: 'invite'|'share'|'friend', code, email }`. Answers 204 on a pass, 404 `{error:'link_expired'}`, 400 `{error:'invalid_body'}`, 429 `{error:'too_many'}`. Needs no token.
  - `POST /api/friend-links` with a token. Answers 201 `{ code, expires_at }`.
- Produces (TS):
  - `createRateLimiter(opts: { limit: number; windowMs: number; now?: () => number }): (key: string) => boolean`;
  - `SignupService = { grant(kind: PassKind, code: string, email: string): Promise<boolean> }`, with `PassKind = 'invite' | 'share' | 'friend'`;
  - `HouseholdService.createFriendLink(token: string): Promise<{ code: string; expires_at: string }>`.

- [ ] **Step 1: Write the failing unit tests**

`apps/api/src/rateLimit.test.ts`:

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
```

`apps/api/src/signup/routes.test.ts`:

```ts
import { Hono } from 'hono';
import { expect, it, vi } from 'vitest';
import { createRateLimiter } from '../rateLimit';
import { registerSignupRoutes } from './routes';

const CODE = 'k3J9xQ2mZb7LwP0aYc5RdT8vNf1HgE4sUo6IiKjMnBq';

function app(granted = true, limit = 100) {
  const grant = vi.fn(async () => granted);
  const hono = new Hono();
  registerSignupRoutes(hono, {
    signup: { grant },
    limitEmail: createRateLimiter({ limit, windowMs: 60_000 }),
    limitCode: createRateLimiter({ limit, windowMs: 60_000 }),
  });
  const post = (body: unknown) =>
    hono.request('/api/signup-pass', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  return { grant, post };
}

it('grants a pass for a valid body, with the email trimmed and lowercased', async () => {
  const { grant, post } = app();
  const response = await post({ kind: 'invite', code: CODE, email: ' Ann@Example.com ' });
  expect(response.status).toBe(204);
  expect(grant).toHaveBeenCalledWith('invite', CODE, 'ann@example.com');
});

it('a dead link is 404 link_expired', async () => {
  const response = await app(false).post({ kind: 'friend', code: CODE, email: 'a@b.co' });
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: 'link_expired' });
});

it.each([
  { kind: 'household', code: CODE, email: 'a@b.co' },
  { kind: 'share', code: 'short', email: 'a@b.co' },
  { kind: 'share', code: CODE, email: 'not-an-email' },
  { kind: 'share', code: CODE, email: `${'a'.repeat(250)}@b.co` },
  null,
])('a bad body is 400 and grants nothing: %j', async (body) => {
  const { grant, post } = app();
  expect((await post(body)).status).toBe(400);
  expect(grant).not.toHaveBeenCalled();
});

it('too many requests for one email are 429 before the database is asked', async () => {
  const { grant, post } = app(true, 1);
  await post({ kind: 'share', code: CODE, email: 'a@b.co' });
  const response = await post({ kind: 'share', code: CODE, email: 'a@b.co' });
  expect(response.status).toBe(429);
  expect(grant).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run apps/api/src/rateLimit.test.ts apps/api/src/signup`
Expected: FAIL. The modules `./rateLimit` and `./routes` can't be found.

- [ ] **Step 3: Implement the limiter, the service and the routes**

`apps/api/src/rateLimit.ts`:

```ts
/** In-memory sliding window per key. One API process (family scale), so no shared store. */
export function createRateLimiter(opts: {
  limit: number;
  windowMs: number;
  now?: () => number;
}): (key: string) => boolean {
  const now = opts.now ?? Date.now;
  const hits = new Map<string, number[]>();
  return (key) => {
    const at = now();
    const recent = (hits.get(key) ?? []).filter((t) => at - t < opts.windowMs);
    const allowed = recent.length < opts.limit;
    if (allowed) recent.push(at);
    hits.set(key, recent);
    if (hits.size > 10_000) {
      for (const [k, times] of hits) if (times.every((t) => at - t >= opts.windowMs)) hits.delete(k);
    }
    return allowed;
  };
}
```

`apps/api/src/signup/service.ts`:

```ts
import type { UserTx } from '../db/asUser';

export type PassKind = 'invite' | 'share' | 'friend';
export type SignupService = { grant(kind: PassKind, code: string, email: string): Promise<boolean> };

type Anonymous = <T>(fn: (tx: UserTx) => Promise<T>) => Promise<T>;

/** Production spec §4: a 24-hour sign-up pass from a live link, asked for signed out. */
export function createSignupService(deps: { asAnonymous: Anonymous }): SignupService {
  return {
    async grant(kind, code, email) {
      const [row] = await deps.asAnonymous(
        (tx) =>
          tx<{ ok: boolean }[]>`select public.grant_signup_pass(${kind}, ${code}, ${email}) as ok`,
      );
      return row?.ok === true;
    },
  };
}
```

`apps/api/src/signup/routes.ts`:

```ts
import type { Hono } from 'hono';
import type { PassKind, SignupService } from './service';

const KINDS: readonly string[] = ['invite', 'share', 'friend'];
const CODE = /^[A-Za-z0-9_-]{43}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Production spec §4. Signed out; answers only "pass" or "link_expired". */
export function registerSignupRoutes(
  app: Hono,
  deps: {
    signup: SignupService;
    limitEmail: (key: string) => boolean;
    limitCode: (key: string) => boolean;
  },
): void {
  app.post('/api/signup-pass', async (c) => {
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    const kind = body?.kind;
    const code = body?.code;
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (
      typeof kind !== 'string' ||
      !KINDS.includes(kind) ||
      typeof code !== 'string' ||
      !CODE.test(code) ||
      email.length > 254 ||
      !EMAIL.test(email)
    ) {
      return c.json({ error: 'invalid_body' }, 400);
    }
    if (!deps.limitEmail(email) || !deps.limitCode(code)) return c.json({ error: 'too_many' }, 429);
    const granted = await deps.signup.grant(kind as PassKind, code, email);
    return granted ? c.body(null, 204) : c.json({ error: 'link_expired' }, 404);
  });
}
```

In `apps/api/src/app.ts`:
- add `signup: SignupService` and `limits: { email: (key: string) => boolean; code: (key: string) => boolean }` to `AppDeps`;
- call `registerSignupRoutes(app, { signup: deps.signup, limitEmail: deps.limits.email, limitCode: deps.limits.code })` next to `registerSharingRoutes`;
- update `app.test.ts`'s deps factory with `signup: { grant: async () => true }` and `limits: { email: () => true, code: () => true }`.

In `apps/api/src/server.ts`:

```ts
const signup = createSignupService({ asAnonymous: createAsAnonymous(sql) });
// 10 asks per email and 30 per link an hour; GoTrue rate-limits the emails themselves.
const limits = {
  email: createRateLimiter({ limit: 10, windowMs: 3_600_000 }),
  code: createRateLimiter({ limit: 30, windowMs: 3_600_000 }),
};
```

Then pass `signup` and `limits` to `createApp`.

In `apps/api/src/household/service.ts`, add to `HouseholdService` `createFriendLink(token: string): Promise<{ code: string; expires_at: string }>;` and implement it:

```ts
    async createFriendLink(token) {
      const [row] = await run(
        token,
        (tx) => tx<{ token: string; expires_at: Date }[]>`
        select token, expires_at from public.create_friend_link()`,
      );
      return { code: row!.token, expires_at: iso(row!.expires_at) };
    },
```

In `apps/api/src/household/routes.ts`, after `POST /api/invites`:

```ts
  // FR-6: a link for a friend to start their own household (production spec §4).
  app.post('/api/friend-links', (c) =>
    handle(c, async (token) => c.json(await household.createFriendLink(token), 201)),
  );
```

Any test double of `HouseholdService` that typecheck flags gets `createFriendLink: async () => ({ code: 'c', expires_at: new Date(0).toISOString() })`.

- [ ] **Step 4: Run the unit tests**

Run: `pnpm vitest run apps/api && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Write the failing API integration test**

`apps/api/tests/signup/signup.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { env } from '../../../../test-support/env';
import { signInFresh, type Actor } from '../../../../test-support/auth';
import { adminSql } from '../helpers/db';
import { clearGateRows } from '../helpers/gate';

const used: string[] = [];
afterEach(async () => clearGateRows(used.splice(0)));

const post = (path: string, body: unknown, actor?: Actor) =>
  fetch(`${env.apiUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(actor ? { Authorization: `Bearer ${actor.accessToken}` } : {}),
    },
    body: JSON.stringify(body),
  });

it('a friend link from POST /api/friend-links grants a pass signed out; a made-up code does not', async () => {
  const owner = await signInFresh(`friend-owner-${randomUUID()}@example.test`);
  const created = await post('/friend-links', {}, owner);
  expect(created.status).toBe(201);
  const { code } = (await created.json()) as { code: string };
  const email = `friend-${randomUUID()}@example.test`;
  used.push(email);
  expect((await post('/signup-pass', { kind: 'friend', code, email })).status).toBe(204);
  expect(await adminSql`select 1 from public.signup_passes where email = ${email}`).toHaveLength(1);

  const fake = await post('/signup-pass', { kind: 'friend', code: 'z'.repeat(43), email });
  expect(fake.status).toBe(404);
  expect(await fake.json()).toEqual({ error: 'link_expired' });
});

it('friend links need a token', async () => {
  expect((await post('/friend-links', {})).status).toBe(401);
});
```

Add `apps/api/tests/signup` to the `test:api` script's directory list in `package.json`.

- [ ] **Step 6: Rebuild the API and run it**

Run: `pnpm dev:backend:test && pnpm test:api`
Expected: PASS, including both new tests.

- [ ] **Step 7: Commit**

```bash
git add apps/api package.json
git commit -m "feat(api): sign-up passes from live links and friend links, rate limited (FR-1, FR-6)"
```

---

### Task 3: The app: passes first, the invite-only message, friend links

**Files:**
- Create: `apps/mobile/src/session/pendingFriend.ts`, `apps/mobile/src/session/signupPass.ts`, `apps/mobile/src/session/signupPass.test.ts`
- Create: `apps/mobile/src/screens/WelcomeScreen.tsx`, `apps/mobile/app/welcome/[code].tsx`
- Modify:
  - `apps/mobile/src/household/pendingInvite.ts` (add `peekPendingInvite`);
  - `apps/mobile/src/session/SessionProvider.tsx` (`requestCode`);
  - `apps/mobile/src/session/resume.ts` (clear a friend code after sign-in);
  - `apps/mobile/src/screens/SignInScreen.tsx` (optional `intro`);
  - `apps/mobile/src/navigation/tabs.ts` and `tabs.test.ts` (hide on `/welcome/`);
  - `apps/mobile/src/household/api.ts` (`createFriendLink`, `friendUrl`);
  - `apps/mobile/src/screens/HouseholdScreen.tsx`.
- Create: `e2e/signup-gate.spec.ts`; Modify: `e2e/helpers.ts` (gate helpers)

**Interfaces:**
- Consumes: `POST /api/signup-pass` and `POST /api/friend-links` from Task 2; the GoTrue refusal shape pinned in Task 1 Step 7.
- Produces:
  - `peekPendingInvite(): string | null`;
  - `setPendingFriend(code)`, `peekPendingFriend(): string | null` and `takePendingFriend(): string | null`;
  - `passSource(): { kind: 'invite' | 'share' | 'friend'; code: string } | null`;
  - `askForPass(source, email, deps: { fetch: typeof fetch; apiUrl: string }): Promise<'granted' | 'expired' | 'offline'>`;
  - `isInviteOnly(error: { status?: number; message?: string } | null): boolean`;
  - the constants `INVITE_ONLY` and `LINK_EXPIRED`.

- [ ] **Step 1: Write the failing unit tests**

`apps/mobile/src/session/signupPass.test.ts`:

```ts
import { beforeEach, expect, it, vi } from 'vitest';
import { setPendingInvite } from '../household/pendingInvite';
import { setPendingShare } from '../sharing/pending';
import { setPendingFriend, takePendingFriend } from './pendingFriend';
import { askForPass, isInviteOnly, passSource } from './signupPass';

const memory = new Map<string, string>();
beforeEach(() => {
  memory.clear();
  globalThis.sessionStorage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => void memory.set(key, value),
    removeItem: (key: string) => void memory.delete(key),
  } as Storage;
});

const A = 'k3J9xQ2mZb7LwP0aYc5RdT8vNf1HgE4sUo6IiKjMnBq';
const B = 'B'.repeat(43);

it('takes the link the visitor came through, invite first, without consuming it', () => {
  expect(passSource()).toBeNull();
  setPendingFriend(B);
  expect(passSource()).toEqual({ kind: 'friend', code: B });
  setPendingShare({ code: A, title: 'Pie' });
  expect(passSource()).toEqual({ kind: 'share', code: A });
  setPendingInvite(B);
  expect(passSource()).toEqual({ kind: 'invite', code: B });
  expect(passSource()).toEqual({ kind: 'invite', code: B });
  expect(takePendingFriend()).toBe(B);
});

it('ignores a malformed friend code', () => {
  setPendingFriend('nope');
  expect(passSource()).toBeNull();
});

it('asks the API for a pass and reads its answer', async () => {
  const answer = (status: number) =>
    vi.fn(async () => new Response(status === 204 ? null : '{}', { status }));
  const deps = (fetch: typeof globalThis.fetch) => ({ fetch, apiUrl: 'https://x/api' });
  const ok = answer(204);
  expect(await askForPass({ kind: 'friend', code: B }, 'a@b.co', deps(ok))).toBe('granted');
  expect(ok).toHaveBeenCalledWith('https://x/api/signup-pass', expect.objectContaining({
    method: 'POST',
    body: JSON.stringify({ kind: 'friend', code: B, email: 'a@b.co' }),
  }));
  expect(await askForPass({ kind: 'friend', code: B }, 'a@b.co', deps(answer(404)))).toBe('expired');
  expect(await askForPass({ kind: 'friend', code: B }, 'a@b.co', deps(answer(429)))).toBe('expired');
  const down = vi.fn(async () => Promise.reject(new TypeError('offline')));
  expect(await askForPass({ kind: 'friend', code: B }, 'a@b.co', deps(down))).toBe('offline');
});

it('recognizes the gate refusal and nothing else', () => {
  expect(isInviteOnly({ status: 403, message: 'invite_only' })).toBe(true);
  expect(isInviteOnly({ status: 403, message: 'Email rate limit exceeded' })).toBe(false);
  expect(isInviteOnly({ status: 500, message: 'invite_only' })).toBe(false);
  expect(isInviteOnly(null)).toBe(false);
});
```

In `apps/mobile/src/navigation/tabs.test.ts`, add `'/welcome/abc'` to the list of paths where `showTabBar` is false (follow that file's existing `it.each` for hidden routes).

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run apps/mobile/src/session/signupPass.test.ts apps/mobile/src/navigation`
Expected: FAIL. `./pendingFriend` and `./signupPass` can't be found, and the tabs test fails on `/welcome/abc`.

- [ ] **Step 3: Implement**

`apps/mobile/src/household/pendingInvite.ts`: add

```ts
export function peekPendingInvite(): string | null {
  const code = globalThis.sessionStorage?.getItem(KEY) ?? null;
  return code && /^[A-Za-z0-9_-]{43}$/.test(code) ? code : null;
}
```

and make `takePendingInvite` call it: `const code = peekPendingInvite(); globalThis.sessionStorage?.removeItem(KEY); return code;`.

`apps/mobile/src/session/pendingFriend.ts`:

```ts
// A friend link (/welcome/<code>) opened while signed out (production spec §4).
const KEY = 'recipes.pendingFriend';
const CODE = /^[A-Za-z0-9_-]{43}$/;

export function setPendingFriend(code: string): void {
  globalThis.sessionStorage?.setItem(KEY, code);
}
export function peekPendingFriend(): string | null {
  const code = globalThis.sessionStorage?.getItem(KEY) ?? null;
  return code && CODE.test(code) ? code : null;
}
export function takePendingFriend(): string | null {
  const code = peekPendingFriend();
  globalThis.sessionStorage?.removeItem(KEY);
  return code;
}
```

`apps/mobile/src/session/signupPass.ts`:

```ts
import { peekPendingInvite } from '../household/pendingInvite';
import { peekPendingShare } from '../sharing/pending';
import { peekPendingFriend } from './pendingFriend';

export type PassSource = { kind: 'invite' | 'share' | 'friend'; code: string };

export const INVITE_ONLY =
  'Dishkept is invite-only for now. Ask someone who uses it to send you an invite.';
export const LINK_EXPIRED = 'This link has expired. Ask for a new one.';

/** The link this visitor arrived through, if any (production spec §4). Not consumed. */
export function passSource(): PassSource | null {
  const invite = peekPendingInvite();
  if (invite) return { kind: 'invite', code: invite };
  const share = peekPendingShare();
  if (share) return { kind: 'share', code: share.code };
  const friend = peekPendingFriend();
  return friend ? { kind: 'friend', code: friend } : null;
}

/** Asks for a 24-hour sign-up pass. Any refusal, rate limits included, reads as expired. */
export async function askForPass(
  source: PassSource,
  email: string,
  deps: { fetch: typeof fetch; apiUrl: string },
): Promise<'granted' | 'expired' | 'offline'> {
  try {
    const response = await deps.fetch(`${deps.apiUrl}/signup-pass`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: source.kind, code: source.code, email }),
    });
    return response.ok ? 'granted' : 'expired';
  } catch {
    return 'offline';
  }
}

/** GoTrue's answer when the before_user_created hook refuses (Task 1, stack test). */
export function isInviteOnly(error: { status?: number; message?: string } | null): boolean {
  return error?.status === 403 && (error.message ?? '').includes('invite_only');
}
```

(If Task 1 Step 7 recorded another refusal shape, match that shape here and in the test.)

In `apps/mobile/src/session/SessionProvider.tsx`, change `requestCode` to:

```ts
      async requestCode(input) {
        const email = normalizeEmail(input);
        if (!email) return { ok: false, message: 'Enter a valid email address.' };
        // A visitor from an invite, share or friend link gets a sign-up pass
        // first; existing accounts sign in whatever the pass says.
        const source = passSource();
        const pass = source
          ? await askForPass(source, email, { fetch: (i, init) => fetch(i, init), apiUrl: config.apiUrl })
          : null;
        if (pass === 'offline') return { ok: false, message: UNREACHABLE };
        try {
          const { error } = await auth.signInWithOtp({ email });
          if (!error) return { ok: true };
          if (isInviteOnly(error)) {
            return { ok: false, message: pass === 'expired' ? LINK_EXPIRED : INVITE_ONLY };
          }
          return {
            ok: false,
            message: error.status ? 'Could not send a code. Try again in a moment.' : UNREACHABLE,
          };
        } catch {
          return { ok: false, message: UNREACHABLE };
        }
      },
```

and import `config` from `'../config'`, plus `askForPass`, `INVITE_ONLY`, `isInviteOnly`, `LINK_EXPIRED` and `passSource` from `'./signupPass'`.

`apps/mobile/src/session/resume.ts`: at the start of `resumeAfterSignIn`, call `takePendingFriend();`. A friend link has nothing to resume; clearing it keeps it from being reused. Import it from `'./pendingFriend'`.

`apps/mobile/src/navigation/tabs.ts`: add `/^\/welcome\//` to `HIDDEN`.

`apps/mobile/src/screens/SignInScreen.tsx`: take `{ intro }: { intro?: string } = {}`, and render `{intro ? <Text>{intro}</Text> : null}` inside the `Card` before the `pendingShare` line.

`apps/mobile/src/screens/WelcomeScreen.tsx`:

```tsx
import { Redirect } from 'expo-router';
import { useEffect } from 'react';
import { setPendingFriend } from '../session/pendingFriend';
import { useSession } from '../session/SessionProvider';
import { SignInScreen } from './SignInScreen';

/** FR-6: a friend link. Signed out, it is sign-in with a pass to make an account. */
export function WelcomeScreen({ code }: { code: string }) {
  const { state } = useSession();
  useEffect(() => {
    if (state.status === 'signedOut') setPendingFriend(code);
  }, [state.status, code]);
  if (state.status === 'loading') return null;
  if (state.status === 'signedIn') return <Redirect href="/" />;
  return <SignInScreen intro="Someone invited you to make your own recipe collection." />;
}
```

`apps/mobile/app/welcome/[code].tsx`:

```tsx
import { useLocalSearchParams } from 'expo-router';
import { WelcomeScreen } from '../../src/screens/WelcomeScreen';

// Not wrapped in SignedIn: the visitor has no account yet.
export default function Welcome() {
  const { code } = useLocalSearchParams<{ code: string }>();
  return <WelcomeScreen code={String(code)} />;
}
```

`apps/mobile/src/household/api.ts`: add

```ts
export const createFriendLink = (deps: ApiDeps) =>
  request<{ code: string; expires_at: string }>(deps, 'POST', '/friend-links', {});

/** The friend link a person opens (production spec §4). */
export function friendUrl(code: string): string {
  return `${globalThis.location?.origin ?? ''}/welcome/${code}`;
}
```

`apps/mobile/src/screens/HouseholdScreen.tsx`: change the "Invite a friend to Dishkept" button so it only shows when `online`, and make its `onPress`:

```tsx
        onPress={() =>
          void act(
            () => withSession(createFriendLink),
            async ({ code }) => {
              const url = friendUrl(code);
              const how = await shareLink(`Make your own recipe collection on Dishkept: ${url}`, url);
              if (how === 'copied') setMessage('Link copied');
            },
          )
        }
```

Import `createFriendLink` and `friendUrl` from `'../household/api'`.

- [ ] **Step 4: Run the unit tests, lint and typecheck**

Run: `pnpm vitest run apps/mobile && pnpm lint && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Write the failing e2e spec**

Add to `e2e/helpers.ts`:

```ts
/** The sign-up gate is shared state; specs that turn it on turn it off in afterEach. */
export async function setGate(on: boolean): Promise<void> {
  const sql = postgres(env.adminDbUrl, { max: 1, onnotice: () => {} });
  try {
    await sql`update public.signup_settings set gate_on = ${on}`;
  } finally {
    await sql.end();
  }
}
```

(Import `postgres` from `'postgres'` if `helpers.ts` doesn't already.)

`e2e/signup-gate.spec.ts`:

```ts
import { expect, test } from './fixtures';
import { createRecipe, freshEmail, requestCode, SEED, setGate, signIn, unique } from './helpers';
import { watchMailbox } from '../test-support/mail';
import { env } from '../test-support/env';

test.afterEach(async () => setGate(false));

const INVITE_ONLY = 'Dishkept is invite-only for now. Ask someone who uses it to send you an invite.';

async function enterEmail(page: import('@playwright/test').Page, email: string) {
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send code' }).click();
}

async function finishSignIn(page: import('@playwright/test').Page, email: string) {
  const mailbox = await watchMailbox(env.mailUrl, email);
  await enterEmail(page, email);
  await page.getByLabel('Code').fill(await mailbox.nextCode());
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('with the gate on, a stranger is told Dishkept is invite-only', async ({ page }) => {
  await setGate(true);
  await page.goto('/');
  await enterEmail(page, freshEmail('stranger'));
  await expect(page.getByText(INVITE_ONLY)).toBeVisible();
});

test('an existing account signs in normally with the gate on', async ({ page }) => {
  await setGate(true);
  await signIn(page, SEED.memberA);
});

test('a friend link from Household lets a new person sign up (FR-6)', async ({ page, browser, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await signIn(page, freshEmail('friend-owner'));
  await page.getByRole('link', { name: 'Household', exact: true }).click();
  await page.getByRole('button', { name: 'Invite a friend to Dishkept' }).click();
  await expect(page.getByText('Link copied')).toBeVisible();
  const url = await page.evaluate(() => navigator.clipboard.readText());
  expect(url).toMatch(/\/welcome\/[A-Za-z0-9_-]{43}$/);

  await setGate(true);
  const friend = await (await browser.newContext()).newPage();
  await friend.goto(url);
  await expect(friend.getByText('Someone invited you to make your own recipe collection.')).toBeVisible();
  await finishSignIn(friend, freshEmail('friend'));
  await expect(friend.getByRole('heading', { name: 'Recipes' })).toBeVisible();
  await friend.context().close();
});

test('an invite link lets a new person sign up with the gate on (FR-3)', async ({ page, browser, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await signIn(page, freshEmail('gate-inviter'));
  await page.getByRole('link', { name: 'Household', exact: true }).click();
  await page.getByRole('button', { name: 'Share invite' }).click();
  const url = (await page.getByLabel('Invite link').textContent())!.trim();

  await setGate(true);
  const guest = await (await browser.newContext()).newPage();
  await guest.goto(url);
  await guest.getByRole('link', { name: 'Sign in' }).click();
  await finishSignIn(guest, freshEmail('gate-invitee'));
  await expect(guest.getByRole('button', { name: /^Join/ })).toBeVisible();
  await guest.context().close();
});

test('a shared recipe lets a new person sign up to save it (FR-27)', async ({ page, browser }) => {
  await signIn(page, freshEmail('gate-sharer'));
  const title = unique('Gate soup');
  await createRecipe(page, { title, ingredients: '1 egg', steps: 'Cook.' });
  await page.getByRole('button', { name: 'Share' }).click();
  await page.getByRole('button', { name: 'Link' }).click();
  const url = (await page.getByLabel('Share link').textContent())!.trim();

  await setGate(true);
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(url);
  await visitor.getByRole('button', { name: 'Save to my recipes' }).click();
  await finishSignIn(visitor, freshEmail('gate-saver'));
  await expect(visitor.getByRole('heading', { name: title })).toBeVisible();
  await visitor.context().close();
});

test('an existing account signs in through a dead friend link; a new one is told it expired', async ({ page }) => {
  await setGate(true);
  await page.goto(`/welcome/${'d'.repeat(43)}`);
  await enterEmail(page, freshEmail('late-friend'));
  await expect(page.getByText('This link has expired. Ask for a new one.')).toBeVisible();
  const code = await requestCode(page, SEED.adminA);
  expect(code).toMatch(/^\d{6}$/);
});
```

Check the invite button and join button names against `HouseholdScreen` ("Share invite") and `InviteScreen` before running. Adjust the locators to the real names; the flows stay the same.

- [ ] **Step 6: Run it against the rebuilt app**

Run: `pnpm dev:backend:test && docker compose restart sync && npx playwright test e2e/signup-gate.spec.ts`
Expected: 6 passed.

- [ ] **Step 7: Run the whole e2e suite and commit**

Run: `pnpm test:e2e`
Expected: everything passes (one skipped as before).

```bash
git add apps/mobile e2e
git commit -m "feat(app): invite-only sign-up message, passes from links, friend links (FR-1, FR-6)"
```

---

### Task 4: The production stack, the guard and the prod commands

**Files:**
- Create: `docker-compose.prod.yml`, `.env.production.example`
- Create: `scripts/guard.mjs`, `scripts/prod/lib.mjs`, `scripts/prod/lib.test.mjs`, `scripts/prod/cli.mjs`, `scripts/prod/check-config.mjs`
- Modify: `deploy/Caddyfile` (trusted proxies), `docker-compose.yml` (proxy `TRUSTED_PROXIES` env), `package.json`, `vitest.config.ts`, `.gitignore`, `.github/workflows/ci.yml`

**Interfaces:**
- Produces (`scripts/prod/lib.mjs`, all pure):
  - `productionSignals({ env, argv, dotenv }): string[]`, which is empty when it's safe;
  - `deployBlockers({ branch, dirty, head, originMain }): string[]`;
  - `backupAge(lastSuccessIso: string | null, now: Date): { hours: number | null; stale: boolean }`;
  - `normalizeEmail(input: string): string | null`;
  - `buildProdEnv(template: string, values: Record<string, string>): string`;
  - `composeArgs(project?: string): string[]`, defaulting to `'dishkept'`;
  - `PROD_PROFILES`, which is `['backup', 'tunnel']`;
  - `DRILL_PROFILES`, which is `['backup']`.
- Produces (`package.json`): the scripts `prod:init`, `prod:deploy`, `prod:status`, `prod:logs`, `prod:stop`, `prod:allow`, `prod:disallow`, `prod:allowed`, `prod:gate`, `prod:backup-now`, `prod:restore`, `prod:restore-test` and `test:prod-config`. Task 5 fills in the restore commands.

- [ ] **Step 1: Write the failing unit tests**

`scripts/prod/lib.test.mjs`:

```js
import { describe, expect, it } from 'vitest';
import {
  backupAge,
  buildProdEnv,
  composeArgs,
  deployBlockers,
  DRILL_PROFILES,
  normalizeEmail,
  productionSignals,
} from './lib.mjs';

describe('the production guard', () => {
  const safe = { env: {}, argv: [], dotenv: 'PUBLIC_URL=http://localhost:8090\n' };
  it('passes plain dev', () => expect(productionSignals(safe)).toEqual([]));
  it.each([
    [{ ...safe, env: { COMPOSE_PROJECT_NAME: 'dishkept' } }],
    [{ ...safe, env: { COMPOSE_FILE: 'docker-compose.yml:docker-compose.prod.yml' } }],
    [{ ...safe, env: { COMPOSE_ENV_FILES: '.env.production' } }],
    [{ ...safe, argv: ['--env-file', '.env.production'] }],
    [{ ...safe, dotenv: 'APP_ENV=production\n' }],
    [{ ...safe, dotenv: 'COMPOSE_PROJECT_NAME=dishkept\n' }],
  ])('refuses on %j', (input) => expect(productionSignals(input).length).toBeGreaterThan(0));
});

describe('deploy preconditions', () => {
  const ok = { branch: 'main', dirty: false, head: 'abc', originMain: 'abc' };
  it('passes a clean, current main', () => expect(deployBlockers(ok)).toEqual([]));
  it('refuses another branch, a dirty tree, or being behind origin/main', () => {
    expect(deployBlockers({ ...ok, branch: 'feat/x' })).toHaveLength(1);
    expect(deployBlockers({ ...ok, dirty: true })).toHaveLength(1);
    expect(deployBlockers({ ...ok, head: 'old' })).toHaveLength(1);
  });
});

describe('backup age', () => {
  const now = new Date('2026-10-20T12:00:00Z');
  it('is fresh under 26 hours and stale over', () => {
    expect(backupAge('2026-10-19T11:00:00Z', now)).toEqual({ hours: 25, stale: false });
    expect(backupAge('2026-10-19T09:00:00Z', now)).toEqual({ hours: 27, stale: true });
  });
  it('is stale when there has never been one or the time is unreadable', () => {
    expect(backupAge(null, now)).toEqual({ hours: null, stale: true });
    expect(backupAge('garbage', now)).toEqual({ hours: null, stale: true });
  });
});

it('normalizes emails for the allowed list', () => {
  expect(normalizeEmail('  Wes@Data2InsightsLLC.com ')).toBe('wes@data2insightsllc.com');
  expect(normalizeEmail('nope')).toBeNull();
});

it('fills empty template values and keeps everything else', () => {
  const template = '# c\nA=\nB=keep\nC=\n';
  expect(buildProdEnv(template, { A: '1', B: 'x', C: 'a b' })).toBe("# c\nA=1\nB=keep\nC='a b'\n");
});

it('compose args name the project, env file and both files; the drill never starts the tunnel', () => {
  expect(composeArgs()).toEqual([
    '-p', 'dishkept', '--env-file', '.env.production',
    '-f', 'docker-compose.yml', '-f', 'docker-compose.prod.yml',
  ]);
  expect(composeArgs('dishkept-drill')[1]).toBe('dishkept-drill');
  expect(DRILL_PROFILES).not.toContain('tunnel');
});
```

In `vitest.config.ts`, add `'scripts/**/*.test.mjs'` to `include`.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run scripts`
Expected: FAIL. `./lib.mjs` can't be found.

- [ ] **Step 3: Implement `lib.mjs` and the guard**

`scripts/prod/lib.mjs`:

```js
// Decisions behind the prod:* commands and the guard, kept pure for tests.

export const PROJECT = 'dishkept';
export const ENV_FILE = '.env.production';
/** backup: the nightly job. tunnel: cloudflared, which only production may run. */
export const PROD_PROFILES = ['backup', 'tunnel'];
/** A drill must never start the tunnel: a second connector would serve it publicly. */
export const DRILL_PROFILES = ['backup'];

export function composeArgs(project = PROJECT) {
  return ['-p', project, '--env-file', ENV_FILE, '-f', 'docker-compose.yml', '-f', 'docker-compose.prod.yml'];
}

/** Reasons a dev or test command must not run here; empty when it is safe. */
export function productionSignals({ env, argv, dotenv }) {
  const reasons = [];
  if (env.COMPOSE_PROJECT_NAME === PROJECT) reasons.push('COMPOSE_PROJECT_NAME is dishkept');
  if ((env.COMPOSE_FILE ?? '').includes('docker-compose.prod.yml')) reasons.push('COMPOSE_FILE names the production overlay');
  if ((env.COMPOSE_ENV_FILES ?? '').includes(ENV_FILE)) reasons.push('COMPOSE_ENV_FILES names .env.production');
  if (argv.some((arg) => arg.includes(ENV_FILE))) reasons.push('the command names .env.production');
  if (/^APP_ENV=production\s*$/m.test(dotenv)) reasons.push('.env says APP_ENV=production');
  if (/^COMPOSE_PROJECT_NAME=dishkept\s*$/m.test(dotenv)) reasons.push('.env names the dishkept project');
  return reasons;
}

export function deployBlockers({ branch, dirty, head, originMain }) {
  const blockers = [];
  if (branch !== 'main') blockers.push(`on ${branch}, not main`);
  if (dirty) blockers.push('the working tree has uncommitted changes');
  if (head !== originMain) blockers.push('HEAD is not origin/main (pull or push first)');
  return blockers;
}

export function backupAge(lastSuccessIso, now) {
  const at = lastSuccessIso ? Date.parse(lastSuccessIso) : NaN;
  if (Number.isNaN(at)) return { hours: null, stale: true };
  const hours = Math.round((now.getTime() - at) / 3_600_000);
  return { hours, stale: hours > 26 };
}

export function normalizeEmail(input) {
  const email = input.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

/**
 * Fills each empty `NAME=` line. Single quotes keep values literal for Compose;
 * Compose has no escape inside them, so callers refuse values containing `'`.
 */
export function buildProdEnv(template, values) {
  return template
    .split('\n')
    .map((line) => {
      const name = /^([A-Z0-9_]+)=$/.exec(line)?.[1];
      if (!name || values[name] === undefined) return line;
      const value = values[name];
      return /^[A-Za-z0-9_.:/@+-]*$/.test(value) ? `${name}=${value}` : `${name}='${value}'`;
    })
    .join('\n');
}
```

`scripts/guard.mjs`:

```js
// Runs before every dev, seed, reset and test command (production spec §2).
import { existsSync, readFileSync } from 'node:fs';
import { productionSignals } from './prod/lib.mjs';

const reasons = productionSignals({
  env: process.env,
  argv: process.argv.slice(2),
  dotenv: existsSync('.env') ? readFileSync('.env', 'utf8') : '',
});
if (reasons.length > 0) {
  console.error(`Refusing: this would touch production (project dishkept).\n- ${reasons.join('\n- ')}`);
  process.exit(1);
}
```

- [ ] **Step 4: Run the unit tests**

Run: `pnpm vitest run scripts`
Expected: PASS.

- [ ] **Step 5: Write the overlay, env template, Caddy change and CLI**

`docker-compose.prod.yml`:

```yaml
# Production (production spec §2): `docker compose` + this file, project
# dishkept, .env.production. Only the scripts in scripts/prod run it.
services:
  db:
    ports: !reset []
  proxy:
    ports: !reset []
    environment:
      # The tunnel connector is on the Docker network.
      TRUSTED_PROXIES: private_ranges
    volumes: !override
      - caddy_data:/data
  backup:
    volumes:
      - ${GCS_KEY_FILE:-./.local/gcs-backup-key.json}:/run/secrets/gcs.json:ro
  cloudflared:
    image: cloudflare/cloudflared:2026.10.0
    profiles: [tunnel]
    restart: unless-stopped
    command: ['tunnel', '--no-autoupdate', 'run']
    environment:
      TUNNEL_TOKEN: ${TUNNEL_TOKEN:?set TUNNEL_TOKEN in .env.production}
    depends_on:
      proxy:
        condition: service_healthy

volumes:
  caddy_data:
```

Pin `cloudflared` to the newest tag that exists on Docker Hub when you run this. Check with `docker manifest inspect cloudflare/cloudflared:<tag>`, and record the tag as a ruling if it differs. The `backup` service itself is defined in Task 5. Until then, comment out the overlay's `backup:` block and restore it in Task 5.

In `docker-compose.yml`, under `proxy.environment`, add `TRUSTED_PROXIES: ${TRUSTED_PROXIES:-127.0.0.1/32}`. In `deploy/Caddyfile`'s global block, add:

```
	# Production: the tunnel connector forwards the visitor's scheme and address.
	servers :8080 {
		trusted_proxies static {$TRUSTED_PROXIES:127.0.0.1/32}
	}
```

`.env.production.example` is `.env.example` with these differences:
- `APP_ENV=production` and `COMPOSE_PROJECT_NAME=dishkept`;
- `PUBLIC_URL=https://dishkept.geltech.dev`;
- `SITE_ADDRESS=:8080`;
- no `PROXY_PORT`, LAN, CORS, `DB_HOST_PORT` or `MAIL_HOST_PORT` lines;
- `SMTP_HOST=smtp.zoho.com`, `SMTP_PORT=465`, and empty `SMTP_USER=`, `SMTP_PASS=`, `SMTP_FROM=`, plus `SMTP_SENDER_NAME=Dishkept`;
- `AUTH_EMAIL_MAX_FREQUENCY=60s` and `AUTH_RATE_LIMIT=10`;
- empty `TUNNEL_TOKEN=`, `BACKUP_BUCKET=`, `BACKUP_AGE_RECIPIENT=`, `BACKUP_ALERT_TO=` and `OWNER_EMAIL=`;
- `BACKUP_TIME=03:30`, `TZ=America/New_York` and `GCS_KEY_FILE=./.local/gcs-backup-key.json`;
- the AI section unchanged.

Each group keeps a comment explaining it, as in `.env.example`.

`.gitignore`: add `.env.production`. Leave `.env.production.example` tracked.

`scripts/prod/cli.mjs`:

```js
// The prod:* commands (production spec §2–§5). Never reads .env.
import { execFileSync, spawnSync } from 'node:child_process';
import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import {
  backupAge, buildProdEnv, composeArgs, deployBlockers, ENV_FILE, normalizeEmail, PROD_PROFILES,
} from './lib.mjs';

const profiles = (list) => list.flatMap((p) => ['--profile', p]);
const compose = (args, opts = {}) =>
  spawnSync('docker', ['compose', ...composeArgs(), ...profiles(PROD_PROFILES), ...args], {
    stdio: 'inherit',
    ...opts,
  });
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const fail = (message) => {
  console.error(message);
  process.exit(1);
};
const psql = (sql) => {
  const result = compose(
    ['exec', '-T', 'db', 'psql', '-U', 'postgres', '-d', 'app', '-v', 'ON_ERROR_STOP=1', '-Atc', sql],
    { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' },
  );
  if (result.status !== 0) fail('psql failed');
  return result.stdout.trim();
};
const literal = (value) => `'${value.replaceAll("'", "''")}'`;

if (process.env.COMPOSE_FILE) fail('Unset COMPOSE_FILE first: prod:* names its own files.');
const [command, ...rest] = process.argv.slice(2);

const commands = {
  async init() {
    if (existsSync(ENV_FILE)) fail(`${ENV_FILE} exists; edit it by hand.`);
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const ask = async (name, hint) => {
      for (;;) {
        const value = (await rl.question(`${name} (${hint}): `)).trim();
        if (value && !value.includes("'")) return value;
        console.log("Required, and may not contain a single quote ('). Try again.");
      }
    };
    const hex = () => randomBytes(24).toString('hex');
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = { ...privateKey.export({ format: 'jwk' }), kid: randomUUID(), alg: 'ES256', use: 'sig', key_ops: ['sign', 'verify'] };
    const values = {
      POSTGRES_PASSWORD: hex(), APP_OWNER_PASSWORD: hex(), API_LOGIN_PASSWORD: hex(),
      AUTH_DB_PASSWORD: hex(), POWERSYNC_REPL_PASSWORD: hex(), POWERSYNC_STORAGE_PASSWORD: hex(),
      JWT_SECRET: randomBytes(32).toString('hex'), JWT_KEYS: JSON.stringify([jwk]),
      TUNNEL_TOKEN: await ask('TUNNEL_TOKEN', 'Cloudflare tunnel token'),
      SMTP_USER: await ask('SMTP_USER', 'Zoho login, e.g. wes@data2insightsllc.com'),
      SMTP_PASS: await ask('SMTP_PASS', 'Zoho app-specific password'),
      SMTP_FROM: await ask('SMTP_FROM', 'must equal SMTP_USER for Zoho'),
      ANTHROPIC_API_KEY: await ask('ANTHROPIC_API_KEY', 'sk-ant-...'),
      BACKUP_BUCKET: await ask('BACKUP_BUCKET', 'GCS bucket name'),
      BACKUP_AGE_RECIPIENT: await ask('BACKUP_AGE_RECIPIENT', 'age1... public key'),
      OWNER_EMAIL: await ask('OWNER_EMAIL', 'your sign-in address, added to the allowed list'),
    };
    rl.close();
    values.BACKUP_ALERT_TO = values.SMTP_FROM;
    writeFileSync(ENV_FILE, buildProdEnv(readFileSync('.env.production.example', 'utf8'), values), { mode: 0o600 });
    console.log(`Wrote ${ENV_FILE}. Next: pnpm prod:deploy`);
  },

  deploy() {
    git('fetch', 'origin', 'main');
    const blockers = deployBlockers({
      branch: git('rev-parse', '--abbrev-ref', 'HEAD'),
      dirty: git('status', '--porcelain') !== '',
      head: git('rev-parse', 'HEAD'),
      originMain: git('rev-parse', 'origin/main'),
    });
    if (blockers.length) fail(`Not deploying:\n- ${blockers.join('\n- ')}`);
    if (compose(['up', '-d', '--build', '--wait', '--remove-orphans']).status !== 0) fail('Deploy failed: pnpm prod:logs');
    compose(['restart', 'sync']);
    const owner = readFileSync(ENV_FILE, 'utf8').match(/^OWNER_EMAIL=(.+)$/m)?.[1]?.trim();
    // First deploy: turn the gate on and list the owner. Later deploys change nothing here.
    if (owner && psql(`select count(*) from public.signup_allowed`) === '0') {
      psql(`insert into public.signup_allowed (email) values (${literal(normalizeEmail(owner) ?? fail('OWNER_EMAIL is not an email'))})`);
      psql(`update public.signup_settings set gate_on = true`);
      console.log(`Gate on; ${owner} is allowed.`);
    }
    commands.status();
  },

  status() {
    compose(['ps']);
    // The build time baked into the served bundle (the app footer's "Build ...").
    const build = compose(['exec', '-T', 'proxy', 'sh', '-c',
      "grep -rhoE '20[0-9]{2}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}' /srv/web/_expo/static/js | head -n 1"],
      { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' });
    console.log(`Deployed build: ${build.stdout?.trim() || 'unknown'}`);
    const last = compose(['exec', '-T', 'backup', 'cat', '/backups/last-success'], {
      stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8',
    });
    const age = backupAge(last.status === 0 ? last.stdout.trim() : null, new Date());
    console.log(age.hours === null ? 'Backups: none yet' : `Last backup: ${age.hours} h ago`);
    if (age.stale) console.log('WARNING: no successful backup in the last 26 hours.');
  },

  logs: () => compose(['logs', '--tail', '200', ...rest]),
  stop: () => compose(['stop']),

  allow() {
    const email = normalizeEmail(rest[0] ?? '') ?? fail('Usage: pnpm prod:allow you@example.com');
    psql(`insert into public.signup_allowed (email) values (${literal(email)}) on conflict do nothing`);
    console.log(`Allowed ${email}`);
  },
  disallow() {
    const email = normalizeEmail(rest[0] ?? '') ?? fail('Usage: pnpm prod:disallow you@example.com');
    psql(`delete from public.signup_allowed where email = ${literal(email)}`);
    console.log(`Removed ${email}`);
  },
  allowed: () => console.log(psql(`select email from public.signup_allowed order by email`) || '(none)'),
  gate() {
    if (!['on', 'off'].includes(rest[0] ?? '')) fail('Usage: pnpm prod:gate on|off');
    psql(`update public.signup_settings set gate_on = ${rest[0] === 'on'}`);
    console.log(`Gate ${rest[0]}`);
  },

  'backup-now': () => compose(['run', '--rm', 'backup', 'now']),
};

const run = commands[command];
if (!run) fail(`Unknown command: ${command}. One of: ${Object.keys(commands).join(', ')}`);
await run();
```

`scripts/prod/check-config.mjs` checks, with `docker compose config`, what the overlay produces:

```js
// CI: the production overlay publishes no ports and keeps the tunnel out of drills.
import { execFileSync } from 'node:child_process';
import { composeArgs, DRILL_PROFILES, PROD_PROFILES } from './lib.mjs';

const config = (profiles) =>
  JSON.parse(
    execFileSync('docker', [
      'compose', ...composeArgs().map((a) => (a === '.env.production' ? '.env.production.example' : a)),
      ...profiles.flatMap((p) => ['--profile', p]), 'config', '--format', 'json',
    ], { encoding: 'utf8', env: { ...process.env, TUNNEL_TOKEN: 'check', POSTGRES_PASSWORD: 'x', JWT_SECRET: 'x' } }),
  );
const prod = config(PROD_PROFILES);
const published = Object.entries(prod.services).filter(([, s]) => (s.ports ?? []).length > 0);
if (published.length) throw new Error(`Production publishes ports: ${published.map(([n]) => n).join(', ')}`);
if (!prod.services.cloudflared) throw new Error('Production has no tunnel');
if (config(DRILL_PROFILES).services.cloudflared) throw new Error('A drill would start the tunnel');
console.log('Production compose config: no published ports; tunnel only in production.');
```

Add any other `:?`-required variables the config step asks for to that `env` object.

`package.json`:
- put `node scripts/guard.mjs && ` in front of `dev:backend`, `dev:backend:test`, `dev:backend:stop`, `db:seed` and `db:reset`, and in front of `test:stack`, `test:rls`, `test:api` and `test:e2e`. Leave `test` alone: it is pure unit tests;
- add `"prod:init": "node scripts/prod/cli.mjs init"`, and the same for `deploy`, `status`, `logs`, `stop`, `allow`, `disallow`, `allowed`, `gate` and `backup-now`;
- add `"test:prod-config": "node scripts/prod/check-config.mjs"`.

`.github/workflows/ci.yml`: in the `backend` job, after `pnpm test:api`, add `- run: pnpm test:prod-config`.

- [ ] **Step 6: Run the checks**

Run: `pnpm vitest run scripts && pnpm test:prod-config && COMPOSE_PROJECT_NAME=dishkept pnpm db:seed; echo "exit $?"`
Expected: unit tests PASS; the config check prints its success line; `db:seed` prints "Refusing: this would touch production" and `exit 1`.

Run: `pnpm lint && pnpm typecheck && pnpm dev:backend:test && pnpm test:stack`
Expected: PASS. The guard lets dev through, and Caddy starts with `trusted_proxies`.

- [ ] **Step 7: Commit**

```bash
git add docker-compose.prod.yml .env.production.example scripts deploy/Caddyfile docker-compose.yml package.json vitest.config.ts .gitignore .github/workflows/ci.yml
git commit -m "feat(ops): production Compose project behind Cloudflare Tunnel, guard, prod commands (NFR-8)"
```

---

### Task 5: Nightly backups, restore and the drill

**Files:**
- Create: `deploy/backup.Dockerfile`, `scripts/backup/run.sh`, `scripts/backup/backup.sh`, `scripts/backup/restore.sh`, `scripts/backup/alert.sh`
- Modify: `docker-compose.yml` (the `backup` service, profile `backup`; `backups` volume), `docker-compose.prod.yml` (restore the `backup:` key mount), `scripts/prod/cli.mjs` (`restore`, `restore-test`), `scripts/prod/lib.mjs` (`drillCounts`), `scripts/prod/lib.test.mjs`
- Create: `scripts/test-backup.mjs`; Modify: `package.json` (`test:backup`), `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `composeArgs`, `DRILL_PROFILES`, `PROD_PROFILES` from Task 4; `signup_passes` from Task 1.
- Produces:
  - the container commands `run.sh now | loop | restore <file> | status`;
  - the manifest keys `date`, `build`, `migration` and `counts`, where `counts` holds `users`, `households`, `memberships`, `recipes`, `photos`, `shares` and `photo_files`;
  - `drillCounts(manifest, actual): string[]`, listing the mismatches.

- [ ] **Step 1: Write the failing unit test for the drill comparison**

Append to `scripts/prod/lib.test.mjs`:

```js
import { drillCounts } from './lib.mjs';

it('the drill reports every count that differs from the manifest', () => {
  const manifest = { counts: { users: 2, recipes: 10, photo_files: 3 } };
  expect(drillCounts(manifest, { users: 2, recipes: 10, photo_files: 3 })).toEqual([]);
  expect(drillCounts(manifest, { users: 2, recipes: 9, photo_files: 3 })).toEqual(['recipes: backup 10, restored 9']);
  expect(drillCounts(manifest, { users: 2, recipes: 10 })).toEqual(['photo_files: backup 3, restored missing']);
});
```

Run: `pnpm vitest run scripts`
Expected: FAIL (`drillCounts` is not exported).

- [ ] **Step 2: Implement `drillCounts`**

Append to `scripts/prod/lib.mjs`:

```js
export function drillCounts(manifest, actual) {
  return Object.entries(manifest.counts).flatMap(([name, expected]) =>
    actual[name] === expected ? [] : [`${name}: backup ${expected}, restored ${actual[name] ?? 'missing'}`],
  );
}
```

Run: `pnpm vitest run scripts`
Expected: PASS.

- [ ] **Step 3: Write the backup image and scripts**

`deploy/backup.Dockerfile`:

```dockerfile
# Nightly backup (production spec §5): pg_dump, tar, age, rclone, msmtp.
FROM postgres:17-alpine
RUN apk add --no-cache age rclone msmtp tzdata coreutils
COPY scripts/backup/ /opt/backup/
RUN chmod +x /opt/backup/*.sh
ENTRYPOINT ["/opt/backup/run.sh"]
CMD ["loop"]
```

`scripts/backup/run.sh`:

```sh
#!/bin/sh
# now: one backup. loop: one a day at BACKUP_TIME (TZ). restore <file>: see restore.sh.
set -eu
case "${1:-loop}" in
  now) exec /opt/backup/backup.sh ;;
  restore) shift; exec /opt/backup/restore.sh "$@" ;;
  status) cat /backups/last-success 2>/dev/null || echo never ;;
  loop)
    while :; do
      target=$(date -d "today ${BACKUP_TIME:-03:30}" +%s)
      now=$(date +%s)
      [ "$target" -le "$now" ] && target=$(date -d "tomorrow ${BACKUP_TIME:-03:30}" +%s)
      sleep $((target - now))
      /opt/backup/backup.sh || true # backup.sh has already sent the alert
    done ;;
  *) echo "usage: run.sh now|loop|status|restore <file>" >&2; exit 2 ;;
esac
```

`scripts/backup/backup.sh`:

```sh
#!/bin/sh
# One backup: app database + photos + manifest, age-encrypted, uploaded, 7 kept locally.
set -eu
export PGHOST=db PGUSER=postgres PGDATABASE=app PGPASSWORD="$POSTGRES_PASSWORD"
step=start
work=$(mktemp -d)
trap 'status=$?; rm -rf "$work"; [ $status -eq 0 ] || /opt/backup/alert.sh "$step" "$work"; exit $status' EXIT

day=$(date +%F)
name="dishkept-$day.tar.age"

step=prune-passes
psql -v ON_ERROR_STOP=1 -qc "delete from public.signup_passes where expires_at <= now()"

step=dump
pg_dump --format=custom --file="$work/app.dump" app

step=photos
tar -C /data/photos -cf "$work/photos.tar" .

step=manifest
count() { psql -Atc "select count(*) from $1"; }
cat > "$work/manifest.json" <<EOF
{"date":"$day","build":"${BUILD_TIME:-unknown}",
 "migration":"$(psql -Atc 'select max(version) from dbmate.schema_migrations')",
 "counts":{"users":$(count auth.users),"households":$(count public.households),
  "memberships":$(count public.memberships),"recipes":$(count public.recipes),
  "photos":$(count public.photos),"shares":$(count public.shares),
  "photo_files":$(find /data/photos -type f | wc -l)}}
EOF

step=encrypt
tar -C "$work" -cf - app.dump photos.tar manifest.json | age -r "$BACKUP_AGE_RECIPIENT" -o "/backups/$name"

step=upload
rclone copyto "/backups/$name" "${BACKUP_REMOTE:-offsite:$BACKUP_BUCKET}/$name"

step=prune-local
ls -1 /backups/dishkept-*.tar.age | sort | head -n -7 | xargs -r rm --

date -u +%FT%TZ > /backups/last-success
echo "backup ok: $name"
```

`scripts/backup/alert.sh`:

```sh
#!/bin/sh
# Emails the owner that a backup failed, through the stack's SMTP settings.
set -u
to="${BACKUP_ALERT_TO:-$SMTP_FROM}"
tls=on; [ "${SMTP_PORT:-}" = 1025 ] && tls=off # Mailpit in tests
{
  printf 'From: %s <%s>\nTo: %s\nSubject: Dishkept backup FAILED (%s)\n\n' \
    "${SMTP_SENDER_NAME:-Dishkept}" "$SMTP_FROM" "$to" "$1"
  echo "The nightly backup failed at step: $1"
  echo "Run: pnpm prod:logs backup"
} | msmtp --host="$SMTP_HOST" --port="$SMTP_PORT" --tls="$tls" --tls-starttls=off \
    --auth="$([ -n "${SMTP_USER:-}" ] && echo on || echo off)" --user="${SMTP_USER:-}" \
    --passwordeval="printf %s \"\$SMTP_PASS\"" --from="$SMTP_FROM" "$to"
```

`scripts/backup/restore.sh`:

```sh
#!/bin/sh
# restore <file.tar.age>: decrypt with /run/secrets/age.key, then replace the
# app database and the photos. The caller has stopped api, auth, sync, proxy.
set -eu
file="$1"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
export PGHOST=db PGUSER=postgres PGPASSWORD="$POSTGRES_PASSWORD"

# Decrypt and unpack first: a wrong key or a corrupt file stops here, before anything is dropped.
age -d -i /run/secrets/age.key "$file" | tar -C "$work" -xf -
[ -s "$work/app.dump" ] && [ -f "$work/photos.tar" ] && [ -f "$work/manifest.json" ]
cat "$work/manifest.json"

psql -d postgres -v ON_ERROR_STOP=1 -qc "drop database if exists app with (force)"
pg_restore --create --dbname=postgres --exit-on-error "$work/app.dump"
find /data/photos -mindepth 1 -delete
tar -C /data/photos -xf "$work/photos.tar"
echo "restore ok"
```

In `docker-compose.yml`, add:

```yaml
  backup:
    build:
      context: .
      dockerfile: deploy/backup.Dockerfile
    profiles: [backup]
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    environment:
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      TZ: ${TZ:-America/New_York}
      BACKUP_TIME: ${BACKUP_TIME:-03:30}
      BACKUP_BUCKET: ${BACKUP_BUCKET:-}
      BACKUP_REMOTE: ${BACKUP_REMOTE:-}
      BACKUP_AGE_RECIPIENT: ${BACKUP_AGE_RECIPIENT:-}
      BACKUP_ALERT_TO: ${BACKUP_ALERT_TO:-}
      SMTP_HOST: ${SMTP_HOST}
      SMTP_PORT: ${SMTP_PORT}
      SMTP_USER: ${SMTP_USER}
      SMTP_PASS: ${SMTP_PASS}
      SMTP_FROM: ${SMTP_FROM}
      SMTP_SENDER_NAME: ${SMTP_SENDER_NAME:-Dishkept}
      # rclone's GCS remote, named "offsite", from the environment.
      RCLONE_CONFIG_OFFSITE_TYPE: 'google cloud storage'
      RCLONE_CONFIG_OFFSITE_SERVICE_ACCOUNT_FILE: /run/secrets/gcs.json
      RCLONE_CONFIG_OFFSITE_BUCKET_POLICY_ONLY: 'true'
    volumes:
      # Read-write: a restore replaces the files. Back up with the database (ADR-0013).
      - photos:/data/photos
      - backups:/backups
```

Add `backups:` under `volumes:`. Restore the overlay's `backup:` block from Task 4.

The `${BACKUP_REMOTE:-}` default is empty, but `backup.sh` uses `${BACKUP_REMOTE:-offsite:$BACKUP_BUCKET}`, so an empty value falls through to GCS.

- [ ] **Step 4: Write the failing round trip**

`scripts/test-backup.mjs` runs against the dev or test stack (project `recipe-app`, `.env`):

```js
// CI and local: backup → restore drill round trip, with a throwaway key and a
// local folder in place of GCS (production spec §6). Never touches dishkept.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { drillCounts } from './prod/lib.mjs';

const dc = (args, opts = {}) =>
  execFileSync('docker', ['compose', '--profile', 'backup', ...args], { encoding: 'utf8', ...opts });
const fail = (m) => { console.error(`FAIL: ${m}`); process.exit(1); };

// A throwaway key pair, made inside the backup image.
dc(['build', 'backup']);
const keys = dc(['run', '--rm', '--entrypoint', 'age-keygen', 'backup']);
const secret = keys.match(/^AGE-SECRET-KEY-\S+$/m)?.[0] ?? fail('no key');
const recipient = keys.match(/public key: (age1\S+)/)?.[1] ?? fail('no public key');
const wrong = dc(['run', '--rm', '--entrypoint', 'age-keygen', 'backup']).match(/^AGE-SECRET-KEY-\S+$/m)[0];

const env = ['-e', `BACKUP_AGE_RECIPIENT=${recipient}`, '-e', 'BACKUP_REMOTE=/backups/offsite'];
// 1. Retention: nine old local copies; after one backup only seven remain.
dc(['run', '--rm', '--entrypoint', 'sh', 'backup', '-c',
  'mkdir -p /backups/offsite && for d in 01 02 03 04 05 06 07 08 09; do : > /backups/dishkept-2000-01-$d.tar.age; done']);
dc(['run', '--rm', ...env, 'backup', 'now'], { stdio: 'inherit' });
const listing = dc(['run', '--rm', '--entrypoint', 'sh', 'backup', '-c', 'ls -1 /backups/dishkept-*.tar.age /backups/offsite']);
const local = listing.split('\n').filter((l) => l.startsWith('/backups/dishkept-'));
if (local.length !== 7) fail(`kept ${local.length} local copies, not 7`);
const newest = local.sort().at(-1);
if (!/dishkept-\d{4}-\d{2}-\d{2}\.tar\.age$/.test(newest)) fail(`bad name ${newest}`);
if (!listing.includes(newest.split('/').pop())) fail('not uploaded to the remote');

// 2. A failing upload emails an alert (Mailpit).
const failed = spawnSync('docker', ['compose', '--profile', 'backup', 'run', '--rm', ...env.slice(0, 2),
  '-e', 'BACKUP_REMOTE=/nonexistent-root-only/x', '-e', 'BACKUP_ALERT_TO=ops@example.test', 'backup', 'now']);
if (failed.status === 0) fail('a broken upload reported success');
const mail = await (await fetch('http://127.0.0.1:8025/api/v1/search?query=to:ops@example.test')).json();
if (!mail.messages?.some((m) => m.Subject.includes('backup FAILED'))) fail('no alert email');

// 3. Restore into a drill project; the wrong key fails before anything is dropped.
const drill = ['-p', 'recipe-app-drill'];
const ddc = (args, opts = {}) => dc([...drill, ...args], opts);
try {
  ddc(['up', '-d', '--wait', 'db']);
  const copy = `/tmp/${newest.split('/').pop()}`;
  execFileSync('sh', ['-c', `docker compose --profile backup run --rm --entrypoint cat backup ${newest} > ${copy}`]);
  const run = (key) => spawnSync('sh', ['-c',
    `printf '%s\\n' '${key}' > /tmp/age.key && docker compose -p recipe-app-drill --profile backup run --rm ` +
    `-v ${copy}:/restore/in.tar.age:ro -v /tmp/age.key:/run/secrets/age.key:ro backup restore /restore/in.tar.age`],
    { encoding: 'utf8' });
  const good = run(secret);
  if (good.status !== 0) fail(`restore failed:\n${good.stderr}`);
  const recipesBefore = Number(ddc(['exec', '-T', 'db', 'psql', '-U', 'postgres', '-d', 'app', '-Atc', 'select count(*) from public.recipes']).trim());
  // The wrong key must fail before anything is dropped (Review Focus 5).
  const bad = run(wrong);
  if (bad.status === 0) fail('restore with the wrong key succeeded');
  const recipesAfter = Number(ddc(['exec', '-T', 'db', 'psql', '-U', 'postgres', '-d', 'app', '-Atc', 'select count(*) from public.recipes']).trim());
  if (recipesAfter !== recipesBefore) fail('a failed restore changed the database');
  const manifest = JSON.parse(good.stdout.slice(good.stdout.indexOf('{'), good.stdout.lastIndexOf('}') + 1));
  const q = (sql) => Number(ddc(['exec', '-T', 'db', 'psql', '-U', 'postgres', '-d', 'app', '-Atc', sql]).trim());
  const actual = {
    users: q('select count(*) from auth.users'), households: q('select count(*) from public.households'),
    memberships: q('select count(*) from public.memberships'), recipes: q('select count(*) from public.recipes'),
    photos: q('select count(*) from public.photos'), shares: q('select count(*) from public.shares'),
    photo_files: Number(ddc(['run', '--rm', '--entrypoint', 'sh', 'backup', '-c', 'find /data/photos -type f | wc -l']).trim()),
  };
  const diffs = drillCounts(manifest, actual);
  if (diffs.length) fail(`counts differ:\n- ${diffs.join('\n- ')}`);
  console.log(`test:backup ok: ${JSON.stringify(actual)}`);
} finally {
  spawnSync('docker', ['compose', ...drill, '--profile', 'backup', 'down', '-v'], { stdio: 'inherit' });
}
```

The drill project's `db` volume is fresh. `db/init/00-roles.sh` creates the roles from `.env`'s passwords, which is what `pg_restore --create` needs.

`package.json`: add `"test:backup": "node scripts/guard.mjs && node scripts/test-backup.mjs"`. In `ci.yml`'s `backend` job, add `- run: pnpm test:backup` after `pnpm test:prod-config`.

- [ ] **Step 5: Run it**

Run: `pnpm dev:backend:test && pnpm test:backup`
Expected: ends with `test:backup ok: {...}` and exit 0; `docker compose -p recipe-app-drill ps -a` shows nothing afterwards.

When a step fails, fix the script, not the expectation. Common causes:
- `head -n -7` needs GNU `coreutils`, which is installed;
- `date -d "today 03:30"` needs GNU date, also from `coreutils`;
- `pg_restore --create` can fail on extensions the dev database has. Ruling: restore with `--clean --if-exists` into a freshly created `app` database instead, and ledger it.

- [ ] **Step 6: Add `prod:restore` and `prod:restore-test`**

Add to `commands` in `scripts/prod/cli.mjs`:

```js
  async restore() {
    const date = rest[0];
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) fail('Usage: pnpm prod:restore [YYYY-MM-DD]');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const keyPath = (await rl.question('Path to your age private key file: ')).trim();
    if (!existsSync(keyPath)) fail(`No file at ${keyPath}`);
    const file = await fetchBackup(date);
    console.log(`Restoring ${file}. Everything saved after it is lost unless a phone still holds it unsynced.`);
    if ((await rl.question('Type "restore" to continue: ')).trim() !== 'restore') fail('Cancelled.');
    rl.close();
    compose(['stop', 'api', 'auth', 'sync', 'proxy']);
    const result = compose(['run', '--rm', '-v', `${keyPath}:/run/secrets/age.key:ro`, 'backup', 'restore', file]);
    if (result.status !== 0) fail('Restore failed; the stack is stopped. pnpm prod:logs backup');
    compose(['up', '-d', '--wait']);
    compose(['restart', 'sync']);
    commands.status();
  },

  async 'restore-test'() {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const keyPath = (await rl.question('Path to your age private key file: ')).trim();
    rl.close();
    const file = await fetchBackup();
    const drill = (args, opts = {}) =>
      spawnSync('docker', ['compose', ...composeArgs('dishkept-drill'), ...profiles(DRILL_PROFILES), ...args], { encoding: 'utf8', ...opts });
    try {
      drill(['up', '-d', '--wait', 'db']);
      // The drill has its own backups volume: copy the file in through stdin.
      const copy = drill(['run', '--rm', '-T', '--entrypoint', 'sh', 'backup', '-c', `cat > /backups/drill.tar.age`], {
        input: compose(['run', '--rm', '-T', '--entrypoint', 'cat', 'backup', file], { stdio: ['ignore', 'pipe', 'inherit'] }).stdout,
      });
      if (copy.status !== 0) fail('Could not copy the backup into the drill');
      const restored = drill(['run', '--rm', '-v', `${keyPath}:/run/secrets/age.key:ro`, 'backup', 'restore', '/backups/drill.tar.age']);
      if (restored.status !== 0) fail(`Drill restore failed:\n${restored.stderr}`);
      const manifest = JSON.parse(restored.stdout.slice(restored.stdout.indexOf('{'), restored.stdout.lastIndexOf('}') + 1));
      if (drill(['up', '-d', '--wait']).status !== 0) fail('The restored drill stack did not become healthy');
      const q = (sql) => Number(drill(['exec', '-T', 'db', 'psql', '-U', 'postgres', '-d', 'app', '-Atc', sql]).stdout.trim());
      const actual = Object.fromEntries(
        [['users', 'auth.users'], ['households', 'public.households'], ['memberships', 'public.memberships'],
          ['recipes', 'public.recipes'], ['photos', 'public.photos'], ['shares', 'public.shares']]
          .map(([k, t]) => [k, q(`select count(*) from ${t}`)]),
      );
      actual.photo_files = Number(drill(['exec', '-T', 'api', 'sh', '-c', 'find /data/photos -type f | wc -l']).stdout.trim());
      const diffs = drillCounts(manifest, actual);
      console.log(diffs.length ? `DRILL FAILED:\n- ${diffs.join('\n- ')}` : `DRILL PASSED: ${JSON.stringify(actual)}`);
      if (diffs.length) process.exitCode = 1;
    } finally {
      drill(['down', '-v'], { stdio: 'inherit' });
    }
  },
```

and the helper above `commands`:

```js
/** The newest local copy, or the named day's; fetched from GCS when it is not local. */
async function fetchBackup(date) {
  const name = (args) => compose(['run', '--rm', '-T', '--entrypoint', 'sh', 'backup', '-c', args], {
    stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8',
  }).stdout.trim();
  const wanted = date ? `dishkept-${date}.tar.age` : name('ls -1 /backups/dishkept-*.tar.age 2>/dev/null | sort | tail -n 1 | xargs -r basename');
  if (!wanted) fail('No local backup; name a date to fetch one from GCS.');
  name(`[ -f /backups/${wanted} ] || rclone copyto "offsite:$BACKUP_BUCKET/${wanted}" /backups/${wanted}`);
  return `/backups/${wanted}`;
}
```

Import `drillCounts` and `DRILL_PROFILES` from `./lib.mjs`. Add `"prod:restore"` and `"prod:restore-test"` to `package.json`.

If the `api` image has no `sh` or `find`, count the files from the `backup` service instead, as `test-backup.mjs` does.

- [ ] **Step 7: Run all checks and commit**

Run: `pnpm vitest run scripts && pnpm test:prod-config && pnpm test:backup && pnpm lint && pnpm typecheck`
Expected: all PASS.

```bash
git add deploy/backup.Dockerfile scripts docker-compose.yml docker-compose.prod.yml package.json .github/workflows/ci.yml
git commit -m "feat(ops): nightly encrypted backups to GCS, restore and drill (NFR-9)"
```

---

### Task 6: Docs and the runbook

**Files:**
- Create: `docs/adr/0018-production-on-a-home-pc.md`, `docs/RUNBOOK.md`
- Modify: `docs/adr/README.md`, `ARCHITECTURE.md`, `docs/SPEC.md`, `CLAUDE.md`, `README.md` (point to the runbook)

**Interfaces:**
- Consumes: every command name from Tasks 4 and 5 (`prod:init`, `prod:deploy`, `prod:status`, `prod:logs`, `prod:stop`, `prod:allow`, `prod:disallow`, `prod:allowed`, `prod:gate`, `prod:backup-now`, `prod:restore`, `prod:restore-test`, `test:backup`, `test:prod-config`).

- [ ] **Step 1: ADR-0018**

Follow `docs/adr/template.md`. Status Accepted, date 2026-10-18, **Amends:** ADR-0008. Its sections:

- **Context:**
  - ADR-0008 left open how the server is reached and how it is backed up;
  - the owner chose their own PC, a subdomain of `geltech.dev` (registered at Porkbun), Zoho mail, GCS, and an invite-only start.
- **Decision**, one short paragraph each:
  1. a second Compose project `dishkept`, with `docker-compose.prod.yml` (no host ports, its own Caddy data, `cloudflared` under profile `tunnel`), `.env.production` and the guard;
  2. Cloudflare Tunnel, with DNS for `geltech.dev` on Cloudflare;
  3. nightly `pg_dump` plus photos, encrypted with `age` (private key held offline by the owner), uploaded with `rclone` to a GCS bucket with a 30-day lifecycle, by a service account that cannot delete; 7 local copies; email on failure; a manual monthly drill;
  4. the sign-up gate: GoTrue's `before_user_created` hook, an allowed list in the database, 24-hour passes from live links, and friend links.
- **Alternatives:** Tailscale, router port forwarding, R2 or B2, point-in-time recovery (WAL-G), an allowed list in `.env`, open sign-up with a global AI cap.
- **Consequences:**
  - downtime when the PC is off;
  - losing the `age` key makes every backup unreadable;
  - restores lose up to a day;
  - new dependencies: `cloudflared`, `age`, `rclone`, `msmtp`;
  - the drill must never start the tunnel;
  - a VM move is a restore plus pointing the tunnel at the new host.

Add it to `docs/adr/README.md`'s list.

- [ ] **Step 2: ARCHITECTURE, SPEC, CLAUDE.md**

- **ARCHITECTURE.md:**
  - add `cloudflared` and `backup` to the container table and diagram;
  - replace the environments paragraph (line ~266) with the real production setup;
  - change the Database row's backups note and the Backups row (line ~309) to describe nightly `age`-encrypted dumps to GCS, kept 30 days, with a manual drill, citing ADR-0018;
  - add the sign-up gate to the auth component's description.
- **docs/SPEC.md:**
  - NFR-8 becomes "Best effort on a home PC; move to a VM when uptime matters.";
  - NFR-9 becomes "Nightly encrypted off-site backups kept 30 days; restore tested.";
  - FR-1 gains " Sign-up is limited to allowed addresses and invited people (ADR-0018).";
  - FR-6 gains "*(friend links: production sub-project)*";
  - §7 question 4 becomes "~~Working app name.~~ Dishkept (ADR-0017)."
- **CLAUDE.md:**
  - under Commands, add `pnpm test:backup`, `pnpm test:prod-config`, and a `prod:*` line pointing to `docs/RUNBOOK.md`;
  - under Non-negotiable rules, add rule 9: "**Production is off-limits to dev and tests.** Never run test, seed or reset commands against the `dishkept` project; `scripts/guard.mjs` refuses them. Only `pnpm prod:*` touches production."

- [ ] **Step 3: The runbook**

`docs/RUNBOOK.md` has these sections, each step a command or a click path and ending in a **Check:** line:

1. **Cloudflare DNS for geltech.dev:**
   - add the site on the free plan;
   - at Porkbun, Domain Management → geltech.dev → Authoritative Nameservers, enter Cloudflare's two nameservers;
   - **Check:** Cloudflare shows the site Active (can take hours).
2. **Tunnel:**
   - Zero Trust → Networks → Tunnels → Create → Cloudflared, named `dishkept`;
   - copy the token;
   - Public Hostname `dishkept.geltech.dev`, service `HTTP` `proxy:8080`;
   - **Check:** after deploy, the tunnel shows Healthy.
3. **Zoho:**
   - Account → Security → App Passwords → generate one for "Dishkept";
   - SMTP is `smtp.zoho.com:465` (SSL). Paid Zoho plans only;
   - **Check:** step 7's test code arrives.
4. **Google Cloud Storage:** give the exact commands:
   - `gcloud storage buckets create gs://<bucket> --location=us-east1 --uniform-bucket-level-access --public-access-prevention`;
   - a lifecycle JSON `{"rule":[{"action":{"type":"Delete"},"condition":{"age":30}}]}` applied with `gcloud storage buckets update gs://<bucket> --lifecycle-file=lifecycle.json`;
   - `gcloud iam service-accounts create dishkept-backup`;
   - `gcloud storage buckets add-iam-policy-binding gs://<bucket> --member=serviceAccount:dishkept-backup@<project>.iam.gserviceaccount.com --role=roles/storage.objectCreator`, and the same with `roles/storage.objectViewer`;
   - `gcloud iam service-accounts keys create .local/gcs-backup-key.json --iam-account=...`;
   - **Check:** the step 8 backup appears in the bucket.
5. **Backup key:**
   - `docker run --rm --entrypoint age-keygen <backup image>`, or `age-keygen` if it's installed;
   - **put the AGE-SECRET-KEY line in your password manager and print it; without it no backup can be restored**;
   - put the `age1…` public key in `prod:init`.
6. **`pnpm prod:init`.** **Check:** `.env.production` exists with mode 600.
7. **`git checkout main && git pull && pnpm prod:deploy`:**
   - **Check:** `https://dishkept.geltech.dev` loads on the phone over mobile data;
   - sign in with your address. The code arrives from the Zoho sender;
   - remove the old home-screen app and add the new one from Safari.
8. **First backup and drill:**
   - `pnpm prod:backup-now`, then `pnpm prod:restore-test`;
   - **Check:** "DRILL PASSED". Repeat the drill monthly.
9. **Windows:**
   - Docker Desktop → Settings → General → Start Docker Desktop when you sign in;
   - Windows power settings: never sleep when plugged in;
   - **Check:** after a reboot, `pnpm prod:status` shows everything healthy without you doing anything.

Then reference sections:
- **Everyday:** `prod:status`, `prod:logs [service]`, updating with `prod:deploy`, `prod:allow`, `prod:disallow`, `prod:allowed` and `prod:gate`;
- **Restore:** `prod:restore [date]`, and what is lost;
- **Rotate:**
  - the SMTP password: edit `.env.production`, then `prod:deploy`;
  - the JWT key: replace `JWT_KEYS` and deploy. Everyone signs in again;
  - the backup key: a new recipient, then a new backup. Keep the old private key 30 days;
- **Switching the sender to a geltech.dev mailbox:** set `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` and `BACKUP_ALERT_TO`, then `prod:deploy`;
- **Running long e2e runs:** `pnpm prod:stop` first if memory is tight, and `pnpm prod:deploy` after;
- **Moving to a VM:** install Docker, copy `.env.production` and the GCS key, `prod:deploy`, `prod:restore`, then point the tunnel connector at the new host. Its token moves with `.env.production`; stop the PC's stack first.

`README.md`: add one line under the setup section: "Production: see `docs/RUNBOOK.md`."

- [ ] **Step 4: Check formatting and commit**

Run: `pnpm lint`
Expected: PASS (Prettier covers the Markdown).

```bash
git add docs ARCHITECTURE.md CLAUDE.md README.md
git commit -m "docs: ADR-0018 production on a home PC, runbook; SPEC NFR-8/9, CLAUDE.md rule 9"
```
