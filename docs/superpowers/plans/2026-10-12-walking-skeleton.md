# Walking Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Revision 2 (2026-10-13).** Tasks 1 and 2 are complete and stand as executed. The old Tasks 3 to 7 (Supabase platform) are replaced by Tasks 3 to 8 below (our own containers in one Compose stack). The Task 3 WIP commit `bc1420d` is superseded; Task 3 removes its Supabase files.

**Goal:** A locally running, web-first Expo app where a user signs in by email code, gets a household, adds title-only recipes offline, and sees them sync to other sessions in the same household and to no one else, with the whole backend running as containers from one `docker-compose.yml`.

**Architecture:** pnpm monorepo. `apps/mobile` (Expo web) reads and writes a browser SQLite database through the PowerSync web SDK. Queued writes upload through `/api/upload` on our Node API (`apps/api`), which validates with the zod schema in `packages/domain` and runs every statement as the caller inside a transaction (`asUser`), so RLS applies. Standalone GoTrue issues the tokens; a Postgres function adds `household_id` and `household_role` claims. A self-hosted PowerSync service streams each household's rows back down. A Caddy proxy is the single entry point and serves the built web app.

**Tech Stack:** pnpm workspaces, TypeScript (strict), Expo + Expo Router (web target), `@powersync/web` + `@powersync/react`, `@supabase/auth-js`, Node 22, Hono, `postgres` (driver), `jose`, zod 4, esbuild, Docker Compose, Postgres 17, GoTrue, PowerSync service (Postgres storage), dbmate, Caddy, Mailpit, Vitest, Playwright, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-12-walking-skeleton-design.md` (revision 2)

## Global Constraints

- TypeScript strict everywhere. No `any` without a comment explaining why (lint enforces `no-explicit-any`).
- Tenant isolation: every tenant table has `household_id NOT NULL`, RLS enabled, and policies in the same migration; the table is added to `apps/api/tests/rls/registry.ts` in the same change.
- No application code path connects to Postgres as a role that owns tables or bypasses RLS. The API logs in as `api_login` and reaches the database only through `asUser` in `apps/api/src/db/asUser.ts`. `powersync_repl` is the only non-superuser role with `BYPASSRLS`.
- The app bundle contains no keys and no host names: only the relative service paths `/auth`, `/api`, `/sync`.
- No image contains a host name, key, or password. Every service is configured from `.env`.
- Screens read and write the local database only, through the Recipe Repository and Session. No screen calls the API or `fetch`.
- Viewers cannot write: enforced in RLS and the add form is not rendered for them.
- Recipe IDs are client-generated UUIDs. Delete means setting `deleted_at`; no hard deletes, no delete policies, no delete grants.
- The client never sends server-owned fields (`created_at`, `updated_at`, `updated_by`).
- Sync config mirrors RLS: `recipes` select policy `household_id = auth_household_id()` ↔ stream filter `household_id = auth.parameter('household_id')`. Change one, change the other.
- Never edit an applied migration; add a new one. Migrations live in `db/migrations/`.
- Recipe title: 1 to 200 characters after trimming; unknown fields rejected.
- Sign-in: email one-time code, 6 digits.
- Token audience is `authenticated`. Custom claims are `household_id` and `household_role` (never `role`, which GoTrue uses itself).
- `/api/upload` accepts at most 500 ops.
- Postgres 17 with `wal_level=logical`.
- Sync latency target: a recipe appears in another session within 10 seconds (NFR-5).
- Conventional Commits with requirement IDs, e.g. `feat(sync): upload connector (FR-30)`.
- Work on branch `feat/walking-skeleton`, never directly on `main`.
- Package versions: install the current release of each dependency with the commands given. Do not hand-write version numbers. Where an installed package's types disagree with code in this plan, the installed `.d.ts` is the authority; adapt the call and keep the behaviour.
- Formatting: run `pnpm format` before each task's lint step. Prettier may wrap this plan's code blocks differently; that is expected and not a deviation.
- Image versions: where this plan writes `<pin>` after an image name, look up that image's current release tag and write it in. Do not use `latest`.
- The machine is WSL with a memory cap. The stack plus Chromium needs the cap at 6 GB or more; if containers are killed or the machine thrashes, stop and tell the owner instead of trimming the stack.

## Review Focus

Inputs the spec implies but does not spell out, most likely first. Each has a pinning test in the named task.

1. **Blank or over-long title typed into the add form** → an inline message, nothing saved, nothing queued. (Task 6: repository unit tests, e2e "rejects a blank title")
2. **Wrong or expired sign-in code; email typed with capitals or spaces** → a clear message, the user stays on the code step and can retry; the email is trimmed and lower-cased before use. (Task 6: `email.test.ts`, e2e "wrong code")
3. **Malformed or oversized `/api/upload` body** (not JSON, no `ops`, more than 500 ops, over 1 MB) → `400` or `413`, nothing applied; the client drops the batch so the queue is not blocked forever. (Task 5: `app.test.ts`, `upload.test.ts`; Task 7: client `upload.test.ts`)
4. **A `put` whose id already belongs to another household's recipe** → rejected, the other household's row unchanged. (Task 5: "id collision")
5. **The auth service is unreachable when the API checks a token** → a `5xx` so the client keeps the change queued and retries; never a `401`, which would sign the user out. (Task 3: `verify.test.ts` "unreachable key set"; Task 5: `app.test.ts`)
6. **A signed-in user whose token has no household claims** (membership missing or soft-deleted) → reads nothing, writes refused, and the app says so instead of showing an empty list. (Task 4: "no household claim"; Task 6: `claims.test.ts` and the list screen's message)

---

## File Structure

```
package.json                     workspace scripts
pnpm-workspace.yaml
tsconfig.base.json               shared strict compiler options
tsconfig.json                    typechecks root-level TS (test-support, e2e, configs)
eslint.config.mjs  .prettierrc.json  .prettierignore  .dockerignore
vitest.config.ts                 unit tests
vitest.integration.config.ts     tests that need the running stack (serial, long timeout)
playwright.config.ts
docker-compose.yml               the whole stack: proxy, api, auth, db, migrate, sync, mail
.env.example                     every setting the stack reads; secrets left empty
scripts/init-env.mjs             creates .env with generated secrets and a signing key
db/
  init/00-roles.sh               first boot: roles, auth schema, storage database
  migrations/20261013000000_create_households_memberships_recipes.sql
  seed.sql                       two households for local dev and tests
deploy/
  Caddyfile                      routes /auth, /api, /sync; serves the web app; dev CORS
  proxy.Dockerfile               builds the web app into the Caddy image
  email-templates/otp.html
powersync/service.yaml  powersync/sync-config.yaml
test-support/
  env.ts                         lazy access to values from .env
  mail.ts                        reads sign-in codes from Mailpit
  auth.ts                        signInAs / signInFresh through the real email-code flow
  tokens.ts                      signs test tokens with the stack's own key
packages/domain/src/index.ts     recipe zod schemas
packages/domain/src/index.test.ts
apps/api/
  Dockerfile  package.json  tsconfig.json
  src/auth/verify.ts             token verification (signature, expiry, audience)
  src/db/asUser.ts               the only database entry point
  src/upload/ops.ts              body schema and per-op apply logic
  src/app.ts                     Hono routes: /api/health, /api/upload
  src/config.ts                  reads the API's environment
  src/server.ts                  process entry point
  src/auth/verify.test.ts  src/app.test.ts
  tests/helpers/db.ts
  tests/stack/signin.test.ts
  tests/rls/registry.ts  isolation.test.ts  signup.test.ts  coverage.test.ts  roles.test.ts  as-user.test.ts
  tests/upload/upload.test.ts
apps/mobile/
  app/_layout.tsx  app/index.tsx  app/sign-in.tsx     thin routes
  src/config.ts                  service paths (same-origin by default)
  src/db/schema.ts               local table definitions
  src/db/database.web.ts         opens the browser database (platform-specific)
  src/db/database.ts             native stub (throws; native comes later)
  src/db/DatabaseProvider.tsx
  src/db/DatabaseSessionBridge.tsx   connect on sign-in, wipe on sign-out
  src/session/claims.ts  email.ts  auth.ts  SessionProvider.tsx
  src/recipes/repository.ts  useRecipes.ts
  src/sync/upload.ts  connector.ts
  src/components/StatusLine.tsx  AddRecipeForm.tsx
  src/screens/SignInScreen.tsx  RecipeListScreen.tsx
e2e/helpers.ts  auth.spec.ts  recipes.spec.ts  sync.spec.ts
.github/workflows/ci.yml
docs/adr/0007-web-first-delivery-via-expo-web.md
docs/adr/0008-self-hosted-containerized-backend.md
```

Task order follows risk. Task 2 proved PowerSync under Expo. Task 3 proves standalone GoTrue against plain Postgres and settles token signing before any other backend work.

---

### Task 1: Workspace and domain package (complete)

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `tsconfig.json`, `eslint.config.mjs`, `.prettierrc.json`, `.prettierignore`, `vitest.config.ts`
- Create: `packages/domain/package.json`, `packages/domain/tsconfig.json`, `packages/domain/src/index.ts`
- Test: `packages/domain/src/index.test.ts`

**Interfaces:**
- Produces (from `@recipe-app/domain`):
  - `TITLE_MAX: 200`
  - `recipeTitleSchema` — zod string, trimmed, 1..200
  - `recipeSchema` — strict object `{ id, household_id, title, deleted_at? }`
  - `recipePatchSchema` — strict partial of the above with `id` required and at least one other field
  - `RECIPE_CLIENT_FIELDS: readonly ['household_id', 'title', 'deleted_at']`
  - types `Recipe`, `RecipePatch`

- [ ] **Step 1: Create the branch and workspace files**

```bash
git checkout main && git checkout -b feat/walking-skeleton
corepack enable
```

`package.json`:

```json
{
  "name": "recipe-app",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "lint": "eslint . && prettier --check .",
    "format": "prettier --write .",
    "typecheck": "tsc -p tsconfig.json && pnpm -r --if-present run typecheck"
  }
}
```

`pnpm-workspace.yaml`:

```yaml
packages:
  - apps/*
  - packages/*
```

Then:

```bash
corepack use pnpm@latest
pnpm add -Dw typescript @types/node vitest eslint @eslint/js typescript-eslint prettier
```

`corepack use` writes the `packageManager` field. If pnpm prints a warning about ignored build scripts, approve them with `pnpm approve-builds`.

- [ ] **Step 2: Add compiler, lint, format, and test config**

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true
  }
}
```

`tsconfig.json`:

```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["*.config.ts", "test-support", "supabase/tests", "e2e", "apps/mobile/src/**/*.test.ts"]
}
```

The app's unit tests are checked here, with Node types, because they use Node globals such as `Buffer`. The app's own `tsconfig.json` (Task 2) excludes them.

`eslint.config.mjs`:

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.expo/**',
      '**/expo-env.d.ts',
      'apps/mobile/public/@powersync/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { rules: { '@typescript-eslint/no-explicit-any': 'error' } },
  {
    files: ['**/*.js', '**/*.cjs'],
    languageOptions: {
      globals: { module: 'writable', require: 'readonly', __dirname: 'readonly' },
    },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
      },
    },
  },
);
```

`.prettierrc.json`:

```json
{ "singleQuote": true, "printWidth": 100 }
```

`.prettierignore`:

```
pnpm-lock.yaml
dist
.expo
apps/mobile/public/@powersync
playwright-report
test-results
supabase/.temp
supabase/.branches
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/mobile/src/**/*.test.ts'],
  },
});
```

- [ ] **Step 3: Create the domain package shell**

`packages/domain/package.json`:

```json
{
  "name": "@recipe-app/domain",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc -p tsconfig.json" }
}
```

`packages/domain/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

```bash
pnpm --filter @recipe-app/domain add zod
```

The package must stay a single source file with no relative imports. The Edge Function loads it under Deno, which requires file extensions on relative imports; one file avoids the problem.

- [ ] **Step 4: Write the failing tests**

`packages/domain/src/index.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { recipePatchSchema, recipeSchema, recipeTitleSchema, TITLE_MAX } from './index';

const id = '6f1c2f0e-8f0a-4a3b-9d5e-2b7c1a9e4d10';
const household_id = '00000000-0000-0000-0000-00000000000a';

describe('recipeTitleSchema', () => {
  it('trims surrounding whitespace', () => {
    expect(recipeTitleSchema.parse('  Pancakes  ')).toBe('Pancakes');
  });

  it('rejects an empty title', () => {
    expect(recipeTitleSchema.safeParse('').success).toBe(false);
  });

  it('rejects a whitespace-only title', () => {
    expect(recipeTitleSchema.safeParse('   ').success).toBe(false);
  });

  it('accepts a title of exactly the maximum length', () => {
    expect(recipeTitleSchema.safeParse('a'.repeat(TITLE_MAX)).success).toBe(true);
  });

  it('rejects a title one character over the maximum', () => {
    expect(recipeTitleSchema.safeParse('a'.repeat(TITLE_MAX + 1)).success).toBe(false);
  });
});

describe('recipeSchema', () => {
  it('accepts a valid recipe', () => {
    expect(recipeSchema.parse({ id, household_id, title: 'Pancakes' })).toEqual({
      id,
      household_id,
      title: 'Pancakes',
    });
  });

  it('accepts a seed-style id that is not a strict RFC UUID', () => {
    expect(recipeSchema.safeParse({ id: household_id, household_id, title: 'x' }).success).toBe(
      true,
    );
  });

  it('rejects unknown fields', () => {
    const result = recipeSchema.safeParse({ id, household_id, title: 'x', updated_by: id });
    expect(result.success).toBe(false);
  });

  it('rejects a household_id that is not a UUID', () => {
    expect(recipeSchema.safeParse({ id, household_id: 'nope', title: 'x' }).success).toBe(false);
  });

  it('accepts deleted_at as null or an ISO timestamp with offset', () => {
    expect(recipeSchema.safeParse({ id, household_id, title: 'x', deleted_at: null }).success).toBe(
      true,
    );
    expect(
      recipeSchema.safeParse({
        id,
        household_id,
        title: 'x',
        deleted_at: '2026-10-12T09:30:00.000Z',
      }).success,
    ).toBe(true);
  });

  it('rejects deleted_at that is not a timestamp', () => {
    expect(
      recipeSchema.safeParse({ id, household_id, title: 'x', deleted_at: 'yesterday' }).success,
    ).toBe(false);
  });
});

describe('recipePatchSchema', () => {
  it('accepts an id plus one field', () => {
    expect(recipePatchSchema.parse({ id, title: ' New ' })).toEqual({ id, title: 'New' });
  });

  it('rejects a patch with only an id', () => {
    expect(recipePatchSchema.safeParse({ id }).success).toBe(false);
  });

  it('rejects a patch without an id', () => {
    expect(recipePatchSchema.safeParse({ title: 'x' }).success).toBe(false);
  });

  it('rejects unknown fields', () => {
    expect(recipePatchSchema.safeParse({ id, updated_at: '2026-10-12T09:30:00Z' }).success).toBe(
      false,
    );
  });
});
```

- [ ] **Step 5: Run the tests and confirm they fail**

Run: `pnpm test`
Expected: FAIL, cannot resolve `./index` (the file does not exist yet).

- [ ] **Step 6: Implement the schema**

`packages/domain/src/index.ts`:

```ts
import { z } from 'zod';

export const TITLE_MAX = 200;

export const recipeTitleSchema = z
  .string()
  .trim()
  .min(1, 'Title is required')
  .max(TITLE_MAX, `Title must be ${TITLE_MAX} characters or fewer`);

const timestampSchema = z.iso.datetime({ offset: true });

// z.guid() accepts any 8-4-4-4-12 hex string. z.uuid() would reject the
// hand-written ids used in seed data.
export const recipeSchema = z.strictObject({
  id: z.guid(),
  household_id: z.guid(),
  title: recipeTitleSchema,
  deleted_at: timestampSchema.nullable().optional(),
});

export const recipePatchSchema = recipeSchema
  .partial()
  .required({ id: true })
  .refine((value) => Object.keys(value).length > 1, { message: 'Patch has no fields' });

/** Fields the client may send. Server-owned fields are never uploaded. */
export const RECIPE_CLIENT_FIELDS = ['household_id', 'title', 'deleted_at'] as const;

export type Recipe = z.infer<typeof recipeSchema>;
export type RecipePatch = z.infer<typeof recipePatchSchema>;
```

- [ ] **Step 7: Run all checks**

Run: `pnpm test && pnpm lint && pnpm typecheck`
Expected: all tests pass; lint and typecheck report no errors. If Prettier reports formatting differences, run `pnpm format` and re-run.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: pnpm workspace and domain recipe schema (FR-30, NFR-1)"
```

---

### Task 2: Expo web shell with the PowerSync browser database (risk gate) (complete)

This task proves the integration the spec flags as unverified. **If Step 9 still fails after the fixes listed there, stop and report to the owner.** The fallback (a Vite shell) needs their approval; do not start it on your own.

**Files:**
- Create: `apps/mobile/` (generated), `apps/mobile/metro.config.js`
- Create: `apps/mobile/src/db/schema.ts`, `database.web.ts`, `database.ts`, `DatabaseProvider.tsx`
- Create: `apps/mobile/src/components/StatusLine.tsx`
- Create: `apps/mobile/app/_layout.tsx`, `apps/mobile/app/index.tsx`
- Create: `playwright.config.ts`
- Test: `e2e/shell.spec.ts`
- Modify: `package.json` (scripts), `.gitignore`

**Interfaces:**
- Produces:
  - `AppSchema` and `RecipeRow` from `src/db/schema.ts`
  - `openDatabase(): AbstractPowerSyncDatabase` from `src/db/database` (Metro picks `database.web.ts` on web)
  - `<DatabaseProvider>` — puts the database in `PowerSyncContext` so `usePowerSync()`, `useQuery()`, `useStatus()` work beneath it
  - `<StatusLine />` — renders the text `Online · N unsynced` or `Offline · N unsynced`
  - Web app served at `http://localhost:8081`

- [ ] **Step 1: Generate the Expo app**

```bash
pnpm create expo-app@latest apps/mobile --template blank-typescript --no-install
rm apps/mobile/App.tsx apps/mobile/index.ts
```

Edit `apps/mobile/package.json`: set `"name": "mobile"`, set `"main": "expo-router/entry"`, and replace `scripts` with:

```json
{
  "copy-assets": "npx --no @powersync/web copy-assets",
  "web": "pnpm run copy-assets && expo start --web --port 8081",
  "build:web": "pnpm run copy-assets && expo export --platform web",
  "serve:web": "serve dist --single --listen 8081",
  "typecheck": "tsc --noEmit"
}
```

Then install:

```bash
pnpm install
cd apps/mobile
pnpm exec expo install expo-router react-native-safe-area-context react-native-screens expo-linking expo-constants expo-status-bar react-dom react-native-web @expo/metro-runtime
pnpm add @powersync/web @powersync/react @recipe-app/domain@workspace:*
pnpm add -D serve
cd ../..
```

If the generated `apps/mobile/package.json` pins a different major version of `typescript` than the root, change the root to match it (`pnpm add -Dw typescript@<that range>`), so one compiler checks the whole repo.

- [ ] **Step 2: Configure Expo for web and Expo Router**

In `apps/mobile/app.json`, inside `"expo"`, set or add:

```json
{
  "scheme": "recipeapp",
  "web": { "bundler": "metro", "output": "single" },
  "plugins": ["expo-router"]
}
```

`"output": "single"` builds a client-only single-page app. Do not use `"static"`: it pre-renders in Node, where the database workers do not exist.

`apps/mobile/metro.config.js`:

```js
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// @powersync/web publishes its entry points through package "exports".
config.resolver.unstable_enablePackageExports = true;

module.exports = config;
```

Make `apps/mobile/tsconfig.json`:

```json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": { "strict": true, "noUncheckedIndexedAccess": true },
  "include": ["**/*.ts", "**/*.tsx", ".expo/types/**/*.ts", "expo-env.d.ts"],
  "exclude": ["node_modules", "**/*.test.ts"]
}
```

Append to `.gitignore`:

```
# PowerSync worker assets (copied from node_modules by `copy-assets`)
apps/mobile/public/@powersync/

# Playwright
playwright-report/
test-results/
```

- [ ] **Step 3: Add Playwright and the failing shell test**

```bash
pnpm add -Dw @playwright/test
pnpm exec playwright install chromium
```

If Chromium reports missing system libraries on WSL, run `pnpm exec playwright install-deps chromium` (asks for sudo).

`playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  retries: 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: 'http://localhost:8081', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm --filter mobile run build:web && pnpm --filter mobile run serve:web',
    url: 'http://localhost:8081',
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
  },
});
```

Add to root `package.json` scripts:

```json
{
  "dev:web": "pnpm --filter mobile run web",
  "test:e2e": "playwright test"
}
```

`e2e/shell.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

test('the app opens its local database in the browser', async ({ page }) => {
  await page.goto('/');
  // The count comes from a query against the local database, so this text
  // only appears once SQLite is running in the browser.
  await expect(page.getByText('Offline · 0 unsynced')).toBeVisible({ timeout: 30_000 });
});
```

- [ ] **Step 4: Run the test and confirm it fails**

Run: `pnpm test:e2e e2e/shell.spec.ts`
Expected: FAIL. The build either errors (no routes in `app/`) or the page lacks the status text.

- [ ] **Step 5: Define the local schema**

`apps/mobile/src/db/schema.ts`:

```ts
import { column, Schema, Table } from '@powersync/web';

// PowerSync adds the `id` column itself. Timestamps are ISO strings.
const recipes = new Table(
  {
    household_id: column.text,
    title: column.text,
    created_at: column.text,
    updated_at: column.text,
    updated_by: column.text,
    deleted_at: column.text,
  },
  { indexes: { household: ['household_id'] } },
);

export const AppSchema = new Schema({ recipes });

export type Database = (typeof AppSchema)['types'];
export type RecipeRow = Database['recipes'];
```

- [ ] **Step 6: Open the database (web) and stub native**

`apps/mobile/src/db/database.web.ts`:

```ts
import { PowerSyncDatabase, WASQLiteOpenFactory } from '@powersync/web';
import type { AbstractPowerSyncDatabase } from '@powersync/web';
import { AppSchema } from './schema';

// Prebuilt worker copied into public/ by `pnpm run copy-assets`.
const WORKER = '/@powersync/worker.js';

export function openDatabase(): AbstractPowerSyncDatabase {
  const factory = new WASQLiteOpenFactory({
    open: { dbFilename: 'recipes.db', worker: WORKER },
  });
  return new PowerSyncDatabase({
    schema: AppSchema,
    factory,
    sync: { worker: WORKER },
  });
}
```

This mirrors PowerSync's `react-native-web-supabase-todolist` demo (`library/powersync/system.ts` in `powersync-ja/powersync-js`). If `tsc` rejects an option name, read the installed types (`node_modules/@powersync/web/lib/**/*.d.ts`) and that demo file, and adjust the option shape; keep the filename and worker path.

`apps/mobile/src/db/database.ts`:

```ts
import type { AbstractPowerSyncDatabase } from '@powersync/web';

// Native builds are not part of the web-first skeleton (ADR-0007).
// Metro resolves database.web.ts on web; this file exists for other platforms
// and for the type checker.
export function openDatabase(): AbstractPowerSyncDatabase {
  throw new Error('The native database is not implemented yet. Run the web target.');
}
```

`apps/mobile/src/db/DatabaseProvider.tsx`:

```tsx
import { PowerSyncContext } from '@powersync/react';
import type { ReactNode } from 'react';
import { openDatabase } from './database';

const database = openDatabase();

export function DatabaseProvider({ children }: { children: ReactNode }) {
  return <PowerSyncContext.Provider value={database}>{children}</PowerSyncContext.Provider>;
}
```

- [ ] **Step 7: Add the status line and routes**

`apps/mobile/src/components/StatusLine.tsx`:

```tsx
import { useQuery, useStatus } from '@powersync/react';
import { Text } from 'react-native';

export function StatusLine() {
  const status = useStatus();
  // ps_crud is PowerSync's queue of local writes not yet uploaded.
  const { data } = useQuery<{ pending: number }>('select count(*) as pending from ps_crud');
  const pending = data[0]?.pending ?? 0;
  const label = `${status.connected ? 'Online' : 'Offline'} · ${pending} unsynced`;
  return <Text aria-label="Sync status">{label}</Text>;
}
```

`apps/mobile/app/_layout.tsx`:

```tsx
import { Slot } from 'expo-router';
import { DatabaseProvider } from '../src/db/DatabaseProvider';

export default function RootLayout() {
  return (
    <DatabaseProvider>
      <Slot />
    </DatabaseProvider>
  );
}
```

`apps/mobile/app/index.tsx`:

```tsx
import { Text, View } from 'react-native';
import { StatusLine } from '../src/components/StatusLine';

export default function Home() {
  return (
    <View style={{ padding: 16, gap: 12 }}>
      <Text role="heading" aria-level={1} style={{ fontSize: 24, fontWeight: '600' }}>
        Recipes
      </Text>
      <StatusLine />
    </View>
  );
}
```

- [ ] **Step 8: Check the worker assets were copied**

Run: `pnpm --filter mobile run copy-assets && ls apps/mobile/public/@powersync`
Expected: a list that includes `worker.js` and at least one `.wasm` file. If the worker file has a different name, use that name for `WORKER` in `database.web.ts`.

- [ ] **Step 9: Run the test and confirm it passes**

Run: `pnpm test:e2e e2e/shell.spec.ts`
Expected: PASS.

If it fails, run `pnpm dev:web`, open `http://localhost:8081`, and read the browser console. Apply the matching fix, one at a time, re-running the test after each:

| Symptom | Fix |
|---|---|
| Metro cannot resolve `@powersync/web` or one of its dependencies | Add `nodeLinker: hoisted` to `pnpm-workspace.yaml`, delete `node_modules`, `pnpm install`. |
| Metro error about a `.wasm` file | In `metro.config.js` add `config.resolver.assetExts.push('wasm');`. |
| Console: 404 for `/@powersync/...` | Re-check Step 8; the path in `WORKER` must match a file under `public/@powersync`. |
| Status text renders but the count never appears (query on `ps_crud` does not update) | Replace the `useQuery` in `StatusLine` with state fed by `usePowerSync().getUploadQueueStats()` called on mount and inside `db.onChangeWithCallback({ onChange }, { tables: ['ps_crud'] })`. |
| Console error mentioning `SharedArrayBuffer` or cross-origin isolation | Pass `flags: { enableMultiTabs: false }` to `PowerSyncDatabase` and retry. |

If none of these resolves it, stop and report the exact console and build errors.

- [ ] **Step 10: Run all checks and commit**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: clean.

```bash
git add -A
git commit -m "feat(app): Expo web shell with PowerSync browser database (FR-28)"
```

---

### Task 3: Compose stack foundation and token verification (risk gate) (complete)

After this task `db`, `auth`, `mail`, and `proxy` run from `docker-compose.yml`, a person can sign in with an emailed code, and the API's verifier accepts the resulting token. This is the spec's first risk (§13): standalone GoTrue against plain Postgres, and asymmetric token signing.

**Files:**
- Delete: `supabase/` (all of it), `scripts/write-env.mjs`
- Move: `supabase/templates/otp.html` → `deploy/email-templates/otp.html`
- Create: `.env.example` (replace), `scripts/init-env.mjs`, `.dockerignore`
- Create: `docker-compose.yml`, `db/init/00-roles.sh`, `deploy/Caddyfile`, `deploy/proxy.Dockerfile`
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/src/auth/verify.ts`
- Create: `test-support/env.ts` (replace), `test-support/auth.ts`, `test-support/tokens.ts`
- Modify: `package.json`, `tsconfig.json`, `vitest.config.ts`, `vitest.integration.config.ts`, `.gitignore`
- Test: `apps/api/src/auth/verify.test.ts`, `apps/api/tests/stack/signin.test.ts`

**Interfaces:**
- Consumes: `watchMailbox(mailUrl, email)` from `test-support/mail.ts` (exists, unchanged)
- Produces:
  - Stack reachable at `http://localhost:8080`: `/auth/*` → GoTrue (prefix stripped), `/api/*` → API (prefix kept), `/sync/*` → PowerSync (prefix stripped), `/healthz`, everything else → the web app
  - Database `app` on `127.0.0.1:54329` with roles `app_owner`, `authenticated`, `api_login`, `supabase_auth_admin`, `powersync_repl`, `powersync_storage`; schemas `auth`, `dbmate`; database `powersync_storage`
  - `createVerifier(config: VerifierConfig): VerifyToken` where `VerifierConfig = { audience: string; jwksUrl: string } | { audience: string; secret: string }`, `VerifyToken = (token: string) => Promise<TokenClaims>`, `TokenClaims = JWTPayload & { sub: string }`; `class UnauthorizedError extends Error`
  - `env` from `test-support/env.ts`: `{ publicUrl, authUrl, apiUrl, mailUrl, jwksUrl, adminDbUrl, apiDbUrl, jwtKeys, jwtSecret, corsDevOrigin }` (lazy getters)
  - `SEED`, `type Actor = { email: string; accessToken: string; userId: string; householdId: string | null; role: string | null }`, `signInFresh(email): Promise<Actor>`, `signInAs(email): Promise<Actor>` (cached per test file) from `test-support/auth.ts`
  - `signTestToken(claims: Record<string, unknown>, options?: { audience?: string; expiresInSeconds?: number }): Promise<string>` from `test-support/tokens.ts`
  - Scripts: `pnpm env:init`, `pnpm dev:backend`, `pnpm dev:backend:stop`, `pnpm test:stack`

- [ ] **Step 1: Remove the Supabase platform files**

```bash
mkdir -p deploy/email-templates
git mv supabase/templates/otp.html deploy/email-templates/otp.html
git rm -r -q supabase scripts/write-env.mjs
rm -rf supabase
pnpm remove -w supabase @supabase/supabase-js
pnpm add -Dw @supabase/auth-js jose
```

In `.gitignore`, delete these lines: `supabase/.env`, `supabase/functions/.env`, the `# Supabase local` comment, `supabase/.branches/`, `supabase/.temp/`.

Replace the `scripts` block in root `package.json` with:

```json
{
  "test": "vitest run",
  "lint": "eslint . && prettier --check .",
  "format": "prettier --write .",
  "typecheck": "tsc -p tsconfig.json && pnpm -r --if-present run typecheck",
  "env:init": "node scripts/init-env.mjs",
  "dev:backend": "node scripts/init-env.mjs && docker compose --profile dev up -d --build --wait",
  "dev:backend:stop": "docker compose --profile dev down",
  "dev:web": "pnpm --filter mobile run web",
  "test:stack": "vitest run -c vitest.integration.config.ts apps/api/tests/stack",
  "test:e2e": "playwright test"
}
```

`tsconfig.json` (root), replace the `include` array:

```json
["*.config.ts", "test-support", "e2e", "apps/mobile/src/**/*.test.ts"]
```

`vitest.config.ts`, replace the `include` array:

```ts
['packages/*/src/**/*.test.ts', 'apps/mobile/src/**/*.test.ts', 'apps/api/src/**/*.test.ts']
```

`vitest.integration.config.ts`, replace the `include` array:

```ts
['apps/api/tests/**/*.test.ts']
```

- [ ] **Step 2: Add the env tooling**

`.env.example` (replace the whole file):

```bash
# Run `pnpm env:init` to create .env from this file. It fills every empty
# secret below with a generated value. Nothing here is bundled into the web app.

# --- Where the stack is reached ---
PUBLIC_URL=http://localhost:8080
# Caddy site address. ":8080" serves plain HTTP; a domain name turns on HTTPS.
SITE_ADDRESS=:8080
PROXY_PORT=8080
# The one other origin allowed to call the stack: the Expo dev server.
CORS_DEV_ORIGIN=http://localhost:8081

# --- Database passwords (hex only: they are placed inside connection URLs) ---
POSTGRES_PASSWORD=
APP_OWNER_PASSWORD=
API_LOGIN_PASSWORD=
AUTH_DB_PASSWORD=
POWERSYNC_REPL_PASSWORD=
POWERSYNC_STORAGE_PASSWORD=

# --- Token signing ---
# JWT_KEYS is a JSON array holding one private ES256 key. GoTrue signs with it
# and publishes the public half; the API and sync service verify against that.
JWT_SECRET=
JWT_KEYS=

# --- Email ---
SMTP_HOST=mail
SMTP_PORT=1025
SMTP_USER=
SMTP_PASS=
SMTP_FROM=no-reply@recipes.localhost
# Loose limits for local development and tests. Tighten for production.
AUTH_EMAIL_MAX_FREQUENCY=1s
AUTH_RATE_LIMIT=1000

# --- Local development and tests only ---
DB_HOST_PORT=54329
MAIL_HOST_PORT=8025

# --- AI (server-only; first used in sub-project 4) ---
ANTHROPIC_API_KEY=
LLM_MODEL_PARSE=
LLM_MODEL_SUBSTITUTE=
AI_MONTHLY_TOKEN_QUOTA_PER_HOUSEHOLD=2000000
```

`scripts/init-env.mjs`:

```js
// Creates .env from .env.example, generating every secret.
// Safe to re-run: an existing .env is never touched.
import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

if (existsSync('.env')) {
  console.log('.env already exists; leaving it alone.');
  process.exit(0);
}

const hex = () => randomBytes(24).toString('hex');

function signingKeys() {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = privateKey.export({ format: 'jwk' });
  const key = { ...jwk, kid: randomUUID(), alg: 'ES256', use: 'sig', key_ops: ['sign', 'verify'] };
  // Single quotes keep the JSON literal for both Docker Compose and Node.
  return `'${JSON.stringify([key])}'`;
}

const generated = {
  POSTGRES_PASSWORD: hex(),
  APP_OWNER_PASSWORD: hex(),
  API_LOGIN_PASSWORD: hex(),
  AUTH_DB_PASSWORD: hex(),
  POWERSYNC_REPL_PASSWORD: hex(),
  POWERSYNC_STORAGE_PASSWORD: hex(),
  JWT_SECRET: randomBytes(32).toString('hex'),
  JWT_KEYS: signingKeys(),
};

const lines = readFileSync('.env.example', 'utf8')
  .split('\n')
  .map((line) => {
    const name = /^([A-Z_]+)=$/.exec(line)?.[1];
    return name && generated[name] ? `${name}=${generated[name]}` : line;
  });

writeFileSync('.env', lines.join('\n'), { mode: 0o600 });
console.log('Wrote .env with generated secrets.');
```

`.dockerignore`:

```
**/node_modules
**/dist
**/.expo
.git
.env
.env.*
!.env.example
test-results
playwright-report
.superpowers
docs
```

Run: `pnpm env:init && grep -c '=' .env`
Expected: `Wrote .env with generated secrets.` and a line count. `git status` must not list `.env` (it is ignored).

- [ ] **Step 3: Create the API package and write the failing verifier tests**

`apps/api/package.json`:

```json
{
  "name": "@recipe-app/api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "typecheck": "tsc -p tsconfig.json"
  }
}
```

`apps/api/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["src", "tests"]
}
```

```bash
pnpm --filter @recipe-app/api add jose
pnpm install
```

`apps/api/src/auth/verify.test.ts`:

```ts
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createVerifier, UnauthorizedError } from './verify';

const SECRET = 'unit-test-secret-unit-test-secret';
const secretKey = new TextEncoder().encode(SECRET);
const now = () => Math.floor(Date.now() / 1000);

function hs256(claims: Record<string, unknown>, key = secretKey, expiresAt = now() + 60) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setAudience((claims.aud as string | undefined) ?? 'authenticated')
    .setExpirationTime(expiresAt)
    .sign(key);
}

describe('createVerifier with a shared secret', () => {
  const verify = createVerifier({ audience: 'authenticated', secret: SECRET });

  it('returns the claims of a valid token', async () => {
    const claims = await verify(await hs256({ sub: 'user-1', household_id: 'house-1' }));
    expect(claims.sub).toBe('user-1');
    expect(claims.household_id).toBe('house-1');
  });

  it('refuses a token signed with another secret', async () => {
    const other = new TextEncoder().encode('another-secret-another-secret-00');
    await expect(verify(await hs256({ sub: 'user-1' }, other))).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('refuses an expired token', async () => {
    const token = await hs256({ sub: 'user-1' }, secretKey, now() - 60);
    await expect(verify(token)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('refuses a token for another audience', async () => {
    await expect(verify(await hs256({ sub: 'user-1', aud: 'someone-else' }))).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('refuses a token with no subject', async () => {
    await expect(verify(await hs256({}))).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('refuses a token with no expiry', async () => {
    const token = await new SignJWT({ sub: 'user-1' })
      .setProtectedHeader({ alg: 'HS256' })
      .setAudience('authenticated')
      .sign(secretKey);
    await expect(verify(token)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it.each(['', 'not-a-jwt', 'a.b.c'])('refuses %j', async (token) => {
    await expect(verify(token)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('refuses an unsigned token', async () => {
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const token = `${encode({ alg: 'none' })}.${encode({ sub: 'user-1', aud: 'authenticated', exp: now() + 60 })}.`;
    await expect(verify(token)).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

describe('createVerifier with a published key set', () => {
  let server: Server;
  let jwksUrl: string;
  let sign: (claims: Record<string, unknown>) => Promise<string>;
  let publicKeyBytes: Uint8Array;

  beforeAll(async () => {
    const { publicKey, privateKey } = await generateKeyPair('ES256');
    const jwk = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'ES256', use: 'sig' };
    publicKeyBytes = new TextEncoder().encode(JSON.stringify(jwk));
    sign = (claims) =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: 'ES256', kid: 'test-key' })
        .setAudience('authenticated')
        .setExpirationTime(now() + 60)
        .sign(privateKey);

    server = createServer((_request, response) => {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ keys: [jwk] }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    jwksUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/jwks.json`;
  });

  afterAll(() => new Promise((resolve) => server.close(resolve)));

  it('accepts a token signed by the published key', async () => {
    const verify = createVerifier({ audience: 'authenticated', jwksUrl });
    expect((await verify(await sign({ sub: 'user-1' }))).sub).toBe('user-1');
  });

  it('refuses a token signed by a key that is not published', async () => {
    const verify = createVerifier({ audience: 'authenticated', jwksUrl });
    const stranger = await generateKeyPair('ES256');
    const token = await new SignJWT({ sub: 'user-1' })
      .setProtectedHeader({ alg: 'ES256', kid: 'test-key' })
      .setAudience('authenticated')
      .setExpirationTime(now() + 60)
      .sign(stranger.privateKey);
    await expect(verify(token)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('refuses an HS256 token signed with the public key as the secret', async () => {
    const verify = createVerifier({ audience: 'authenticated', jwksUrl });
    const token = await hs256({ sub: 'user-1' }, publicKeyBytes);
    await expect(verify(token)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('reports an unreachable key set as a server problem, not a refusal', async () => {
    // Port 9 (discard) is closed: the key set cannot be fetched.
    const verify = createVerifier({ audience: 'authenticated', jwksUrl: 'http://127.0.0.1:9/jwks.json' });
    const outcome = await verify(await sign({ sub: 'user-1' })).then(
      () => 'accepted',
      (error: unknown) => (error instanceof UnauthorizedError ? 'unauthorized' : 'server-error'),
    );
    expect(outcome).toBe('server-error');
  });
});
```

- [ ] **Step 4: Run the tests and confirm they fail**

Run: `pnpm test`
Expected: FAIL, `./verify` does not exist. The domain tests still pass.

- [ ] **Step 5: Implement the verifier**

`apps/api/src/auth/verify.ts`:

```ts
import { createRemoteJWKSet, errors, jwtVerify, type JWTPayload } from 'jose';

export type TokenClaims = JWTPayload & { sub: string };
export type VerifyToken = (token: string) => Promise<TokenClaims>;

export type VerifierConfig =
  | { audience: string; jwksUrl: string }
  | { audience: string; secret: string };

/** The token is missing, malformed, expired, for another audience, or not signed by our auth service. */
export class UnauthorizedError extends Error {
  constructor(reason: string) {
    super(`Unauthorized: ${reason}`);
    this.name = 'UnauthorizedError';
  }
}

// Failures caused by the token itself. Anything else (for example the key set
// could not be fetched) is a server problem and must not look like a refusal:
// a 401 signs the user out, a 5xx makes the client retry.
const TOKEN_FAULTS = [
  errors.JWTExpired,
  errors.JWTClaimValidationFailed,
  errors.JWTInvalid,
  errors.JWSInvalid,
  errors.JWSSignatureVerificationFailed,
  errors.JWKSNoMatchingKey,
  errors.JOSEAlgNotAllowed,
  errors.JOSENotSupported,
];

export function createVerifier(config: VerifierConfig): VerifyToken {
  // One key source and one algorithm family per deployment. Accepting both
  // would let a token signed with the public key as an HMAC secret pass.
  let check: (token: string) => Promise<JWTPayload>;
  if ('jwksUrl' in config) {
    const keys = createRemoteJWKSet(new URL(config.jwksUrl));
    check = async (token) =>
      (await jwtVerify(token, keys, { audience: config.audience, algorithms: ['ES256', 'RS256'] }))
        .payload;
  } else {
    const key = new TextEncoder().encode(config.secret);
    check = async (token) =>
      (await jwtVerify(token, key, { audience: config.audience, algorithms: ['HS256'] })).payload;
  }

  return async (token) => {
    let payload: JWTPayload;
    try {
      payload = await check(token);
    } catch (error) {
      if (TOKEN_FAULTS.some((kind) => error instanceof kind)) {
        throw new UnauthorizedError((error as Error).message);
      }
      throw error;
    }
    if (typeof payload.sub !== 'string' || payload.sub === '') {
      throw new UnauthorizedError('token has no subject');
    }
    if (typeof payload.exp !== 'number') throw new UnauthorizedError('token has no expiry');
    return payload as TokenClaims;
  };
}
```

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `pnpm test`
Expected: PASS. If one refusal case reports `server-error`, the installed `jose` raised an error class not in `TOKEN_FAULTS`: print `error.constructor.name` in the test, add that class from `jose`'s `errors` export, and keep the "unreachable key set" test passing.

- [ ] **Step 7: Write the test support and the failing gate test**

`test-support/env.ts` (replace the whole file):

```ts
import { existsSync } from 'node:fs';

if (existsSync('.env')) process.loadEnvFile('.env');

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Run \`pnpm env:init\` first.`);
  return value;
}

const dbHost = () => `127.0.0.1:${process.env.DB_HOST_PORT ?? '54329'}`;

export const env = {
  get publicUrl() {
    return required('PUBLIC_URL');
  },
  get authUrl() {
    return `${required('PUBLIC_URL')}/auth`;
  },
  get apiUrl() {
    return `${required('PUBLIC_URL')}/api`;
  },
  get jwksUrl() {
    return `${required('PUBLIC_URL')}/auth/.well-known/jwks.json`;
  },
  get mailUrl() {
    return `http://127.0.0.1:${process.env.MAIL_HOST_PORT ?? '8025'}`;
  },
  /** Superuser. Tests use it only to arrange or inspect state no client can reach. */
  get adminDbUrl() {
    return `postgres://postgres:${required('POSTGRES_PASSWORD')}@${dbHost()}/app`;
  },
  /** The same login the API container uses. */
  get apiDbUrl() {
    return `postgres://api_login:${required('API_LOGIN_PASSWORD')}@${dbHost()}/app`;
  },
  get jwtKeys() {
    return process.env.JWT_KEYS ?? '';
  },
  get jwtSecret() {
    return required('JWT_SECRET');
  },
  get corsDevOrigin() {
    return required('CORS_DEV_ORIGIN');
  },
};
```

`test-support/auth.ts`:

```ts
import { AuthClient } from '@supabase/auth-js';
import { env } from './env';
import { watchMailbox } from './mail';

export const SEED = {
  adminA: 'admin-a@example.test',
  memberA: 'member-a@example.test',
  viewerA: 'viewer-a@example.test',
  adminB: 'admin-b@example.test',
} as const;

export type Actor = {
  email: string;
  accessToken: string;
  userId: string;
  householdId: string | null;
  role: string | null;
};

/** Signs in through the real email-code flow, so the token hook runs. */
export async function signInFresh(email: string): Promise<Actor> {
  const client = new AuthClient({
    url: env.authUrl,
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  });
  const mailbox = await watchMailbox(env.mailUrl, email);
  const requested = await client.signInWithOtp({ email });
  if (requested.error) throw requested.error;
  const code = await mailbox.nextCode();
  const verified = await client.verifyOtp({ email, token: code, type: 'email' });
  if (verified.error || !verified.data.session) {
    throw verified.error ?? new Error(`No session for ${email}`);
  }
  const accessToken = verified.data.session.access_token;
  const payload = JSON.parse(
    Buffer.from(accessToken.split('.')[1] ?? '', 'base64url').toString('utf8'),
  ) as { sub: string; household_id?: string; household_role?: string };
  return {
    email,
    accessToken,
    userId: payload.sub,
    householdId: payload.household_id ?? null,
    role: payload.household_role ?? null,
  };
}

const cache = new Map<string, Promise<Actor>>();

export function signInAs(email: string): Promise<Actor> {
  let actor = cache.get(email);
  if (!actor) {
    actor = signInFresh(email);
    cache.set(email, actor);
  }
  return actor;
}
```

`test-support/tokens.ts`:

```ts
import { importJWK, SignJWT, type JWK } from 'jose';
import { env } from './env';

type Options = { audience?: string; expiresInSeconds?: number };

/**
 * Signs a token with the stack's own signing key. Tests use it to make tokens
 * GoTrue would never issue: already expired, for another audience, or for a
 * user with no household.
 */
export async function signTestToken(
  claims: Record<string, unknown>,
  options: Options = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const jwt = new SignJWT(claims)
    .setAudience(options.audience ?? 'authenticated')
    .setIssuedAt(now - 600)
    .setExpirationTime(now + (options.expiresInSeconds ?? 300));

  const keys = env.jwtKeys ? (JSON.parse(env.jwtKeys) as (JWK & { kid?: string })[]) : [];
  const jwk = keys[0];
  if (!jwk) {
    // Shared-secret fallback (see Task 3, "If the gate fails on signing").
    return jwt.setProtectedHeader({ alg: 'HS256' }).sign(new TextEncoder().encode(env.jwtSecret));
  }
  const key = await importJWK({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d }, 'ES256');
  return jwt.setProtectedHeader({ alg: 'ES256', kid: jwk.kid }).sign(key);
}
```

`apps/api/tests/stack/signin.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { decodeProtectedHeader } from 'jose';
import { describe, expect, it } from 'vitest';
import { env } from '../../../../test-support/env';
import { signInFresh } from '../../../../test-support/auth';
import { signTestToken } from '../../../../test-support/tokens';
import { createVerifier, UnauthorizedError } from '../../src/auth/verify';

const verify = createVerifier({ audience: 'authenticated', jwksUrl: env.jwksUrl });

describe('the auth service', () => {
  it('emails a 6-digit code and issues an ES256 token the API verifier accepts', async () => {
    const actor = await signInFresh(`gate-${randomUUID()}@example.test`);
    expect(decodeProtectedHeader(actor.accessToken).alg).toBe('ES256');
    const claims = await verify(actor.accessToken);
    expect(claims.sub).toBe(actor.userId);
    expect(claims.aud).toBe('authenticated');
  });

  it('publishes its public key and never the private half', async () => {
    const response = await fetch(env.jwksUrl);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { keys: Record<string, unknown>[] };
    expect(body.keys.length).toBeGreaterThan(0);
    expect(body.keys.every((key) => key.d === undefined && key.k === undefined)).toBe(true);
  });

  it('a token with a tampered signature is refused', async () => {
    const actor = await signInFresh(`tamper-${randomUUID()}@example.test`);
    const [header, payload, signature = ''] = actor.accessToken.split('.');
    const flipped = (signature.startsWith('A') ? 'B' : 'A') + signature.slice(1);
    await expect(verify(`${header}.${payload}.${flipped}`)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('test tokens signed with the stack key verify, so refusals below are meaningful', async () => {
    const claims = await verify(await signTestToken({ sub: randomUUID() }));
    expect(claims.aud).toBe('authenticated');
  });

  it('an expired token is refused', async () => {
    const token = await signTestToken({ sub: randomUUID() }, { expiresInSeconds: -60 });
    await expect(verify(token)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('a token for another audience is refused', async () => {
    const token = await signTestToken({ sub: randomUUID() }, { audience: 'someone-else' });
    await expect(verify(token)).rejects.toBeInstanceOf(UnauthorizedError);
  });
});
```

- [ ] **Step 8: Run the gate test and confirm it fails**

Run: `pnpm test:stack`
Expected: FAIL with a connection error (`fetch failed` / `ECONNREFUSED`): nothing is listening on port 8080 or 8025 yet.

- [ ] **Step 9: Write the stack**

`db/init/00-roles.sh`:

```sh
#!/bin/sh
# Runs once, when the database volume is first created.
# Creates the roles of spec §4, the schema GoTrue migrates into, and the
# separate database PowerSync keeps its buckets in.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v app_owner_pw="$APP_OWNER_PASSWORD" \
  -v api_login_pw="$API_LOGIN_PASSWORD" \
  -v auth_db_pw="$AUTH_DB_PASSWORD" \
  -v ps_repl_pw="$POWERSYNC_REPL_PASSWORD" \
  -v ps_storage_pw="$POWERSYNC_STORAGE_PASSWORD" <<'SQL'
-- Owns every object in the public schema. Used only by the migrate job.
create role app_owner login password :'app_owner_pw';

-- The role every user statement runs as. Nobody logs in as it.
create role authenticated nologin;

-- The API's login. Owns nothing, cannot bypass RLS, and can only switch to
-- "authenticated" (noinherit: it holds no table rights until it does).
create role api_login login noinherit password :'api_login_pw';
grant authenticated to api_login;

-- GoTrue. The role name is fixed by GoTrue's own migrations.
create role supabase_auth_admin login noinherit createrole password :'auth_db_pw';

-- PowerSync reads the replication stream and takes the initial snapshot, so it
-- must see every row. What reaches a device is limited by the sync config.
create role powersync_repl login replication bypassrls password :'ps_repl_pw';

-- PowerSync's own storage lives in a separate database.
create role powersync_storage login password :'ps_storage_pw';
create database powersync_storage owner powersync_storage;

-- Only the roles that need the app database may connect to it.
revoke connect on database app from public;
grant connect on database app to app_owner, api_login, supabase_auth_admin, powersync_repl;

create schema auth authorization supabase_auth_admin;
alter role supabase_auth_admin set search_path = auth;
grant create on database app to supabase_auth_admin;

alter schema public owner to app_owner;
-- create on database: needed to create the replication publication.
grant create on database app to app_owner;
create schema dbmate authorization app_owner;

-- Our migration references auth.users and puts the sign-up trigger on it.
-- GoTrue creates that table later, so grant through default privileges.
grant usage on schema auth to app_owner;
alter default privileges for role supabase_auth_admin in schema auth
  grant references, trigger on tables to app_owner;
SQL
```

`deploy/Caddyfile`:

```
{
	admin off
}

# Lets the one configured dev origin (the Expo dev server) call the stack.
# The built app is same-origin and never sends these requests.
(dev_cors) {
	@preflight {
		method OPTIONS
		header Origin {$CORS_DEV_ORIGIN:http://cors-disabled.invalid}
	}
	@from_dev header Origin {$CORS_DEV_ORIGIN:http://cors-disabled.invalid}

	handle @preflight {
		header Access-Control-Allow-Origin {$CORS_DEV_ORIGIN:http://cors-disabled.invalid}
		header Access-Control-Allow-Methods "GET, POST, PUT, PATCH, DELETE, OPTIONS"
		header Access-Control-Allow-Headers {http.request.header.Access-Control-Request-Headers}
		header Access-Control-Max-Age 600
		header Vary Origin
		respond 204
	}
	# defer: set after the upstream answers, replacing any value it sent.
	header @from_dev {
		defer
		Access-Control-Allow-Origin {$CORS_DEV_ORIGIN:http://cors-disabled.invalid}
		Vary Origin
	}
}

{$SITE_ADDRESS::8080} {
	encode zstd gzip

	# route keeps these in the order written.
	route {
		import dev_cors

		handle /healthz {
			respond "ok" 200
		}
		handle_path /auth/* {
			reverse_proxy auth:9999
		}
		handle /api/* {
			# A coarse cap; the API enforces its exact 1 MB limit itself.
			request_body {
				max_size 4MB
			}
			reverse_proxy api:3000
		}
		handle_path /sync/* {
			reverse_proxy sync:8080 {
				flush_interval -1
			}
		}
		handle /email-templates/* {
			root * /srv
			file_server
		}
		handle {
			root * /srv/web
			try_files {path} /index.html
			file_server
		}
	}
}
```

`deploy/proxy.Dockerfile` (Task 6 adds the web build stage):

```dockerfile
FROM caddy:2
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY deploy/email-templates /srv/email-templates
```

`docker-compose.yml`:

```yaml
# The whole stack. The same file runs locally and on the production host;
# only the values in .env differ. `--profile dev` adds the mail catcher.
name: recipe-app

services:
  db:
    image: postgres:17
    restart: unless-stopped
    command: ['postgres', '-c', 'wal_level=logical']
    environment:
      POSTGRES_DB: app
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?run pnpm env:init}
      APP_OWNER_PASSWORD: ${APP_OWNER_PASSWORD:?run pnpm env:init}
      API_LOGIN_PASSWORD: ${API_LOGIN_PASSWORD:?run pnpm env:init}
      AUTH_DB_PASSWORD: ${AUTH_DB_PASSWORD:?run pnpm env:init}
      POWERSYNC_REPL_PASSWORD: ${POWERSYNC_REPL_PASSWORD:?run pnpm env:init}
      POWERSYNC_STORAGE_PASSWORD: ${POWERSYNC_STORAGE_PASSWORD:?run pnpm env:init}
    volumes:
      - db_data:/var/lib/postgresql/data
      - ./db/init:/docker-entrypoint-initdb.d:ro
    ports:
      # Loopback only: for the test suites and psql on this machine.
      - '127.0.0.1:${DB_HOST_PORT:-54329}:5432'
    healthcheck:
      # Over TCP on purpose: the first-boot init server listens only on the
      # socket, so this stays unhealthy until init has finished.
      test: ['CMD-SHELL', 'pg_isready -h 127.0.0.1 -U postgres -d app']
      interval: 2s
      timeout: 5s
      retries: 60

  auth:
    image: supabase/gotrue:<pin>
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    environment:
      GOTRUE_API_HOST: 0.0.0.0
      PORT: 9999
      API_EXTERNAL_URL: ${PUBLIC_URL}/auth
      GOTRUE_SITE_URL: ${PUBLIC_URL}
      GOTRUE_DB_DRIVER: postgres
      DATABASE_URL: postgres://supabase_auth_admin:${AUTH_DB_PASSWORD}@db:5432/app
      DB_NAMESPACE: auth
      GOTRUE_JWT_SECRET: ${JWT_SECRET:?run pnpm env:init}
      GOTRUE_JWT_KEYS: ${JWT_KEYS:-[]}
      GOTRUE_JWT_EXP: 3600
      GOTRUE_JWT_AUD: authenticated
      GOTRUE_JWT_DEFAULT_GROUP_NAME: authenticated
      GOTRUE_DISABLE_SIGNUP: 'false'
      GOTRUE_EXTERNAL_EMAIL_ENABLED: 'true'
      GOTRUE_EXTERNAL_PHONE_ENABLED: 'false'
      GOTRUE_MAILER_AUTOCONFIRM: 'false'
      GOTRUE_MAILER_OTP_LENGTH: 6
      GOTRUE_MAILER_OTP_EXP: 3600
      GOTRUE_MAILER_SUBJECTS_MAGIC_LINK: Your sign-in code
      GOTRUE_MAILER_SUBJECTS_CONFIRMATION: Your sign-in code
      GOTRUE_MAILER_TEMPLATES_MAGIC_LINK: http://proxy:8080/email-templates/otp.html
      GOTRUE_MAILER_TEMPLATES_CONFIRMATION: http://proxy:8080/email-templates/otp.html
      GOTRUE_SMTP_HOST: ${SMTP_HOST}
      GOTRUE_SMTP_PORT: ${SMTP_PORT}
      GOTRUE_SMTP_USER: ${SMTP_USER}
      GOTRUE_SMTP_PASS: ${SMTP_PASS}
      GOTRUE_SMTP_ADMIN_EMAIL: ${SMTP_FROM}
      GOTRUE_SMTP_SENDER_NAME: Recipes
      GOTRUE_SMTP_MAX_FREQUENCY: ${AUTH_EMAIL_MAX_FREQUENCY:-60s}
      GOTRUE_RATE_LIMIT_EMAIL_SENT: ${AUTH_RATE_LIMIT:-30}
      GOTRUE_RATE_LIMIT_OTP: ${AUTH_RATE_LIMIT:-30}
      GOTRUE_RATE_LIMIT_VERIFY: ${AUTH_RATE_LIMIT:-30}
      GOTRUE_RATE_LIMIT_TOKEN_REFRESH: ${AUTH_RATE_LIMIT:-30}
    healthcheck:
      test: ['CMD', 'wget', '--no-verbose', '--tries=1', '--spider', 'http://127.0.0.1:9999/health']
      interval: 2s
      timeout: 5s
      retries: 60

  proxy:
    build:
      context: .
      dockerfile: deploy/proxy.Dockerfile
    restart: unless-stopped
    environment:
      SITE_ADDRESS: ${SITE_ADDRESS:-:8080}
      CORS_DEV_ORIGIN: ${CORS_DEV_ORIGIN:-http://cors-disabled.invalid}
    ports:
      - '${PROXY_PORT:-8080}:8080'
    healthcheck:
      test: ['CMD', 'wget', '--no-verbose', '--tries=1', '--spider', 'http://127.0.0.1:8080/healthz']
      interval: 2s
      timeout: 5s
      retries: 30

  mail:
    image: axllent/mailpit:<pin>
    profiles: [dev]
    restart: unless-stopped
    ports:
      - '127.0.0.1:${MAIL_HOST_PORT:-8025}:8025'

volumes:
  db_data:
```

Replace both `<pin>` markers with the images' current release tags (Global Constraints).

- [ ] **Step 10: Start the stack and run the gate**

Run: `pnpm dev:backend && pnpm test:stack`
Expected: `docker compose` reports `db`, `auth`, `proxy`, and `mail` healthy or started, then PASS, 6 tests.

This step is the gate. Work through this table before moving on; each row names the evidence to look at first.

| Symptom | Where to look, and the fix |
|---|---|
| `auth` restarts in a loop | `docker compose logs auth --tail 50`. A migration failing on a missing role or schema means GoTrue expects something `db/init/00-roles.sh` does not create: add it there, then `docker compose --profile dev down -v` (the init script only runs on a fresh volume) and start again. Compare with `hack/init_postgres.sql` in `github.com/supabase/auth` at the pinned tag. |
| `auth` exits naming an unknown or missing setting | Compare the `auth` environment block with `example.env` in `github.com/supabase/auth` at the pinned tag; rename the variable, keep the value. |
| `No sign-in code arrived` | Open Mailpit at `http://127.0.0.1:8025`. No message: check the `GOTRUE_SMTP_*` values and the `auth` log. A message with a link and no code: GoTrue could not fetch the template; run `docker compose exec auth wget -qO- http://proxy:8080/email-templates/otp.html` and fix the proxy route or file path. |
| `over_email_send_rate_limit` or `429` | `.env` is missing `AUTH_EMAIL_MAX_FREQUENCY=1s` or `AUTH_RATE_LIMIT=1000`; add them and `pnpm dev:backend`. |
| Token `alg` is `HS256`, or the key set at `/auth/.well-known/jwks.json` is empty | GoTrue did not accept `JWT_KEYS`. Check the `auth` log for a key-parsing message and the key format in Supabase's self-hosting guide "New API Keys and Asymmetric Authentication". If the pinned GoTrue cannot sign asymmetrically, follow "If the gate fails on signing" below. |
| `--wait` reports failure although every service is up | Run `docker compose --profile dev ps`; if all services show `healthy` or `running`, upgrade Docker Compose and re-run. |
| Containers killed, machine thrashing | The WSL memory cap. Stop (`pnpm dev:backend:stop`) and tell the owner; do not trim the stack. |

**If the gate fails on signing** (only when the pinned GoTrue cannot sign with an asymmetric key): stop and tell the owner the shared-secret fallback from spec §4 is needed. With their go-ahead: set `JWT_KEYS=` (empty) in `.env` and in `.env.example`'s generator (remove `JWT_KEYS` from `generated` in `scripts/init-env.mjs`); in `signin.test.ts` and every later test helper build the verifier with `{ audience: 'authenticated', secret: env.jwtSecret }`; change the expected `alg` to `HS256` and delete the "publishes its public key" test; in Task 5 give the `api` service `JWT_SECRET: ${JWT_SECRET}` in place of `JWT_JWKS_URL`; in Task 7 use the shared-secret `client_auth` block shown there. Record the outcome in the ADR-0008 text in Task 8.

- [ ] **Step 11: Run all checks and commit**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:stack`
Expected: clean.

```bash
git add -A
git commit -m "feat(infra): Compose stack with Postgres, GoTrue, and proxy; token verifier (FR-1, NFR-3)"
```

---

### Task 4: Database, tenancy, `asUser`, and the isolation suite (complete)

**Files:**
- Create: `db/migrations/20261013000000_create_households_memberships_recipes.sql`, `db/seed.sql`
- Create: `apps/api/src/db/asUser.ts`
- Modify: `docker-compose.yml` (add `migrate`; enable the token hook on `auth`), `package.json` (scripts)
- Test: `apps/api/tests/helpers/db.ts`, `apps/api/tests/rls/registry.ts`, `isolation.test.ts`, `signup.test.ts`, `coverage.test.ts`, `roles.test.ts`, `as-user.test.ts`

**Interfaces:**
- Consumes: `createVerifier`, `UnauthorizedError`, `VerifyToken` from `apps/api/src/auth/verify.ts`; `env`, `signInAs`, `signInFresh`, `SEED`, `Actor`, `signTestToken` from `test-support/`; the roles and schemas created by `db/init/00-roles.sh`
- Produces:
  - Tables `public.households`, `public.memberships`, `public.recipes`; enum `public.household_role`
  - SQL helpers `public.auth_user_id() returns uuid`, `public.auth_household_id() returns uuid`, `public.auth_household_role() returns public.household_role`, all reading the transaction-local setting `request.jwt.claims`
  - JWT claims `household_id` (uuid string) and `household_role` (`admin` | `member` | `viewer`)
  - Publication `powersync` containing `public.recipes`
  - Seed users `admin-a@example.test`, `member-a@example.test`, `viewer-a@example.test` (household A), `admin-b@example.test` (household B). Seed recipes `Seed pancakes` (A), `Seed curry` (B).
  - From `apps/api/src/db/asUser.ts`: `type Sql`, `type UserTx`, `type AsUser = <T>(token: string, fn: (tx: UserTx) => Promise<T>) => Promise<T>`, `connect(url: string, options?: { max?: number }): Sql`, `createAsUser(sql: Sql, verify: VerifyToken): AsUser`, `createPing(sql: Sql): () => Promise<void>`
  - From `apps/api/tests/helpers/db.ts`: `adminSql`, `asUser`, `as(actor, fn)`, `refusalCode(run)`
  - `TENANT_TABLES`, `TENANT_COLUMN` from `apps/api/tests/rls/registry.ts`
  - Scripts: `pnpm db:seed`, `pnpm db:reset`, `pnpm test:rls`

- [ ] **Step 1: Add the scripts and the database driver**

```bash
pnpm --filter @recipe-app/api add postgres
```

Add to root `package.json` scripts:

```json
{
  "db:seed": "docker compose exec -T db psql -U postgres -d app -v ON_ERROR_STOP=1 -q < db/seed.sql",
  "db:reset": "docker compose --profile dev down -v && pnpm dev:backend && pnpm db:seed",
  "test:rls": "vitest run -c vitest.integration.config.ts apps/api/tests/rls"
}
```

`db:reset` deletes the database volume, so every service starts from nothing. That also clears PowerSync's storage and replication slot, which is why it is a full restart and not a `drop schema`.

- [ ] **Step 2: Write the test helpers and the failing isolation suite**

`apps/api/tests/helpers/db.ts`:

```ts
import postgres from 'postgres';
import { afterAll } from 'vitest';
import { env } from '../../../../test-support/env';
import type { Actor } from '../../../../test-support/auth';
import { createVerifier } from '../../src/auth/verify';
import { connect, createAsUser, type UserTx } from '../../src/db/asUser';

/** Superuser connection. Only for arranging or inspecting state no client can reach. */
export const adminSql = postgres(env.adminDbUrl, { max: 1, onnotice: () => {} });

const apiSql = connect(env.apiDbUrl);

/** The API's own helper, with the API's own login: the path production uses. */
export const asUser = createAsUser(
  apiSql,
  createVerifier({ audience: 'authenticated', jwksUrl: env.jwksUrl }),
);

export function as<T>(actor: Actor, fn: (tx: UserTx) => Promise<T>): Promise<T> {
  return asUser(actor.accessToken, fn);
}

/** Resolves to the Postgres error code a statement was refused with, or undefined if it ran. */
export async function refusalCode(run: Promise<unknown>): Promise<string | undefined> {
  try {
    await run;
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code ?? 'no-code';
  }
}

afterAll(async () => {
  await adminSql.end();
  await apiSql.end();
});
```

`apps/api/tests/rls/registry.ts`:

```ts
/**
 * Every table in the public schema. The coverage guard fails if a table exists
 * that is not listed here, so adding a table forces adding its tests.
 */
export const TENANT_TABLES = ['households', 'memberships', 'recipes'] as const;

/** The column that holds the tenant id in each table. */
export const TENANT_COLUMN: Record<(typeof TENANT_TABLES)[number], string> = {
  households: 'id',
  memberships: 'household_id',
  recipes: 'household_id',
};
```

`apps/api/tests/rls/isolation.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SEED, signInAs, signInFresh, type Actor } from '../../../../test-support/auth';
import { adminSql, as, refusalCode } from '../helpers/db';
import { TENANT_COLUMN, TENANT_TABLES } from './registry';

// insufficient_privilege: raised for an RLS with-check failure and for a
// statement the role has no grant for (delete, anything on memberships).
const REFUSED = '42501';

async function insertRecipe(actor: Actor, title: string): Promise<string> {
  const id = randomUUID();
  await as(
    actor,
    (tx) =>
      tx`insert into public.recipes (id, household_id, title) values (${id}, ${actor.householdId}, ${title})`,
  );
  return id;
}

async function titleOf(actor: Actor, id: string): Promise<string | undefined> {
  const rows = await as(
    actor,
    (tx) => tx<{ title: string }[]>`select title from public.recipes where id = ${id}`,
  );
  return rows[0]?.title;
}

describe('cross-household isolation', () => {
  it('seeded users carry the expected claims', async () => {
    const adminA = await signInAs(SEED.adminA);
    const memberA = await signInAs(SEED.memberA);
    const viewerA = await signInAs(SEED.viewerA);
    const adminB = await signInAs(SEED.adminB);
    expect([adminA.role, memberA.role, viewerA.role, adminB.role]).toEqual([
      'admin',
      'member',
      'viewer',
      'admin',
    ]);
    expect(memberA.householdId).toBe(adminA.householdId);
    expect(viewerA.householdId).toBe(adminA.householdId);
    expect(adminB.householdId).not.toBe(adminA.householdId);
  });

  it.each(TENANT_TABLES)('household B reads none of household A rows in %s', async (table) => {
    const a = await signInAs(SEED.adminA);
    const b = await signInAs(SEED.adminB);
    const column = TENANT_COLUMN[table];

    const targeted = await as(
      b,
      (tx) => tx`select * from public.${tx(table)} where ${tx(column)} = ${a.householdId}`,
    );
    expect(targeted).toHaveLength(0);

    const everything = await as(
      b,
      (tx) => tx<{ tenant: string }[]>`select ${tx(column)} as tenant from public.${tx(table)}`,
    );
    expect([...new Set(everything.map((row) => row.tenant))]).toEqual([b.householdId]);
  });

  it('household B cannot insert a recipe into household A', async () => {
    const a = await signInAs(SEED.adminA);
    const b = await signInAs(SEED.adminB);
    const code = await refusalCode(
      as(
        b,
        (tx) =>
          tx`insert into public.recipes (id, household_id, title) values (${randomUUID()}, ${a.householdId}, 'Intruder')`,
      ),
    );
    expect(code).toBe(REFUSED);
  });

  it('household B cannot update a recipe in household A', async () => {
    const a = await signInAs(SEED.memberA);
    const b = await signInAs(SEED.adminB);
    const id = await insertRecipe(a, 'Original');
    const changed = await as(
      b,
      (tx) => tx`update public.recipes set title = 'Hacked' where id = ${id} returning id`,
    );
    expect(changed).toHaveLength(0);
    expect(await titleOf(a, id)).toBe('Original');
  });

  it('a recipe cannot be moved into another household', async () => {
    const a = await signInAs(SEED.adminA);
    const b = await signInAs(SEED.adminB);
    const id = await insertRecipe(b, 'Mine');
    const code = await refusalCode(
      as(b, (tx) => tx`update public.recipes set household_id = ${a.householdId} where id = ${id}`),
    );
    expect(code).toBe(REFUSED);
  });
});

describe('roles', () => {
  it('a viewer can read recipes', async () => {
    const viewer = await signInAs(SEED.viewerA);
    const rows = await as(viewer, (tx) => tx<{ title: string }[]>`select title from public.recipes`);
    expect(rows.map((row) => row.title)).toContain('Seed pancakes');
  });

  it('a viewer cannot insert', async () => {
    const viewer = await signInAs(SEED.viewerA);
    const code = await refusalCode(
      as(
        viewer,
        (tx) =>
          tx`insert into public.recipes (id, household_id, title) values (${randomUUID()}, ${viewer.householdId}, 'Nope')`,
      ),
    );
    expect(code).toBe(REFUSED);
  });

  it('a viewer cannot update', async () => {
    const member = await signInAs(SEED.memberA);
    const viewer = await signInAs(SEED.viewerA);
    const id = await insertRecipe(member, 'Untouched');
    const changed = await as(
      viewer,
      (tx) => tx`update public.recipes set title = 'Changed' where id = ${id} returning id`,
    );
    expect(changed).toHaveLength(0);
    expect(await titleOf(member, id)).toBe('Untouched');
  });

  it('a member can insert, read, and update', async () => {
    const member = await signInAs(SEED.memberA);
    const id = await insertRecipe(member, 'Draft');
    await as(member, (tx) => tx`update public.recipes set title = 'Final' where id = ${id}`);
    expect(await titleOf(member, id)).toBe('Final');
  });

  it('only an admin can rename the household', async () => {
    const admin = await signInAs(SEED.adminA);
    const member = await signInAs(SEED.memberA);
    const asMember = await as(
      member,
      (tx) =>
        tx`update public.households set name = 'Member was here' where id = ${member.householdId} returning id`,
    );
    expect(asMember).toHaveLength(0);
    const asAdmin = await as(
      admin,
      (tx) =>
        tx`update public.households set name = 'Household A' where id = ${admin.householdId} returning id`,
    );
    expect(asAdmin).toHaveLength(1);
  });
});

describe('no hard deletes', () => {
  it.each([SEED.adminA, SEED.memberA, SEED.viewerA])('%s cannot delete a recipe', async (email) => {
    const member = await signInAs(SEED.memberA);
    const actor = await signInAs(email);
    const id = await insertRecipe(member, 'Keep me');
    const code = await refusalCode(
      as(actor, (tx) => tx`delete from public.recipes where id = ${id}`),
    );
    expect(code).toBe(REFUSED);
    expect(await titleOf(member, id)).toBe('Keep me');
  });

  it('an admin cannot delete the household or a membership', async () => {
    const admin = await signInAs(SEED.adminA);
    expect(
      await refusalCode(
        as(admin, (tx) => tx`delete from public.households where id = ${admin.householdId}`),
      ),
    ).toBe(REFUSED);
    expect(
      await refusalCode(
        as(
          admin,
          (tx) => tx`delete from public.memberships where household_id = ${admin.householdId}`,
        ),
      ),
    ).toBe(REFUSED);
    const remaining = await as(admin, (tx) => tx`select id from public.memberships`);
    expect(remaining).toHaveLength(3);
  });
});

describe('server-owned fields', () => {
  it('ignores client values for created_at, updated_at, and updated_by', async () => {
    const admin = await signInAs(SEED.adminA);
    const member = await signInAs(SEED.memberA);
    const id = randomUUID();
    const spoofed = '2000-01-01T00:00:00+00:00';
    type Stamps = { created_at: Date; updated_at: Date; updated_by: string };

    const [inserted] = await as(
      member,
      (tx) => tx<Stamps[]>`
        insert into public.recipes (id, household_id, title, created_at, updated_at, updated_by)
        values (${id}, ${member.householdId}, 'Clock test', ${spoofed}, ${spoofed}, ${admin.userId})
        returning created_at, updated_at, updated_by`,
    );
    const oneMinuteAgo = Date.now() - 60_000;
    expect(inserted!.created_at.getTime()).toBeGreaterThan(oneMinuteAgo);
    expect(inserted!.updated_at.getTime()).toBeGreaterThan(oneMinuteAgo);
    expect(inserted!.updated_by).toBe(member.userId);

    const [updated] = await as(
      admin,
      (tx) => tx<Stamps[]>`
        update public.recipes
        set title = 'Clock test 2', created_at = ${spoofed}, updated_by = ${member.userId}
        where id = ${id}
        returning created_at, updated_at, updated_by`,
    );
    expect(updated!.created_at.getTime()).toBe(inserted!.created_at.getTime());
    expect(updated!.updated_by).toBe(admin.userId);
  });
});

describe('memberships are read-only for clients', () => {
  it('rejects insert and update', async () => {
    const admin = await signInAs(SEED.adminA);
    const viewer = await signInAs(SEED.viewerA);
    expect(
      await refusalCode(
        as(
          admin,
          (tx) =>
            tx`insert into public.memberships (household_id, user_id, role) values (${admin.householdId}, ${admin.userId}, 'member')`,
        ),
      ),
    ).toBe(REFUSED);
    expect(
      await refusalCode(
        as(
          viewer,
          (tx) => tx`update public.memberships set role = 'admin' where user_id = ${viewer.userId}`,
        ),
      ),
    ).toBe(REFUSED);
    const own = await as(
      viewer,
      (tx) =>
        tx<{ role: string }[]>`select role from public.memberships where user_id = ${viewer.userId}`,
    );
    expect(own[0]?.role).toBe('viewer');
  });
});

describe('no household claim', () => {
  it('a user without an active membership reads nothing and cannot write', async () => {
    const email = `orphan-${randomUUID()}@example.test`;
    const first = await signInFresh(email);
    expect(first.householdId).not.toBeNull();

    // Arranged as the superuser: no client can soft-delete a membership.
    await adminSql`update public.memberships set deleted_at = now() where user_id = ${first.userId}`;

    await new Promise((resolve) => setTimeout(resolve, 1100)); // AUTH_EMAIL_MAX_FREQUENCY
    const orphan = await signInFresh(email);
    expect(orphan.householdId).toBeNull();
    expect(orphan.role).toBeNull();

    for (const table of TENANT_TABLES) {
      expect(await as(orphan, (tx) => tx`select * from public.${tx(table)}`)).toHaveLength(0);
    }
    const code = await refusalCode(
      as(
        orphan,
        (tx) =>
          tx`insert into public.recipes (id, household_id, title) values (${randomUUID()}, ${first.householdId}, 'Orphan write')`,
      ),
    );
    expect(code).toBe(REFUSED);
  });
});
```

`apps/api/tests/rls/signup.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { signInFresh } from '../../../../test-support/auth';
import { as } from '../helpers/db';

it('a new sign-up gets a household, an admin membership, and both claims (FR-2)', async () => {
  const local = `signup-${randomUUID()}`;
  const actor = await signInFresh(`${local}@example.test`);

  expect(actor.role).toBe('admin');
  expect(actor.householdId).toMatch(/^[0-9a-f-]{36}$/);

  const households = await as(actor, (tx) => tx`select id, name from public.households`);
  expect([...households]).toEqual([{ id: actor.householdId, name: `${local} household` }]);

  const memberships = await as(actor, (tx) => tx`select user_id, role from public.memberships`);
  expect([...memberships]).toEqual([{ user_id: actor.userId, role: 'admin' }]);

  expect(await as(actor, (tx) => tx`select id from public.recipes`)).toHaveLength(0);
});
```

`apps/api/tests/rls/coverage.test.ts`:

```ts
import { expect, it } from 'vitest';
import { adminSql } from '../helpers/db';
import { TENANT_TABLES } from './registry';

it('every public table has RLS enabled and is in the test registry', async () => {
  const tables = await adminSql<{ name: string; rls: boolean }[]>`
    select c.relname as name, c.relrowsecurity as rls
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
    order by c.relname`;

  expect(tables.filter((table) => !table.rls).map((table) => table.name)).toEqual([]);
  expect(tables.map((table) => table.name)).toEqual([...TENANT_TABLES].sort());
});
```

`apps/api/tests/rls/roles.test.ts`:

```ts
import postgres from 'postgres';
import { describe, expect, it } from 'vitest';
import { env } from '../../../../test-support/env';
import { adminSql, refusalCode } from '../helpers/db';
import { TENANT_TABLES } from './registry';

describe('database roles (spec §4)', () => {
  it('api_login has no special attributes', async () => {
    const [role] = await adminSql`
      select rolsuper, rolbypassrls, rolinherit, rolcreaterole, rolcreatedb, rolreplication
      from pg_roles where rolname = 'api_login'`;
    expect(role).toEqual({
      rolsuper: false,
      rolbypassrls: false,
      rolinherit: false,
      rolcreaterole: false,
      rolcreatedb: false,
      rolreplication: false,
    });
  });

  it('api_login owns nothing and may only become "authenticated"', async () => {
    const owned = await adminSql`
      select c.relname from pg_class c join pg_roles r on r.oid = c.relowner
      where r.rolname in ('api_login', 'authenticated')`;
    expect(owned).toHaveLength(0);

    const memberOf = await adminSql<{ rolname: string }[]>`
      select g.rolname from pg_auth_members m
      join pg_roles g on g.oid = m.roleid
      join pg_roles u on u.oid = m.member
      where u.rolname = 'api_login'`;
    expect(memberOf.map((row) => row.rolname)).toEqual(['authenticated']);
  });

  it('powersync_repl is the only non-superuser that bypasses RLS', async () => {
    const roles = await adminSql<{ rolname: string }[]>`
      select rolname from pg_roles where rolbypassrls and not rolsuper order by rolname`;
    expect(roles.map((row) => row.rolname)).toEqual(['powersync_repl']);
  });

  it('"authenticated" holds exactly the intended table grants', async () => {
    const grants = await adminSql<{ table_name: string; privilege_type: string }[]>`
      select table_name, privilege_type from information_schema.role_table_grants
      where grantee = 'authenticated' and table_schema = 'public'
      order by table_name, privilege_type`;
    const byTable = Object.fromEntries(
      TENANT_TABLES.map((table) => [
        table,
        grants.filter((grant) => grant.table_name === table).map((grant) => grant.privilege_type),
      ]),
    );
    expect(byTable).toEqual({
      households: ['SELECT', 'UPDATE'],
      memberships: ['SELECT'],
      recipes: ['INSERT', 'SELECT', 'UPDATE'],
    });
  });

  it('api_login cannot read a table until it switches role', async () => {
    const sql = postgres(env.apiDbUrl, { max: 1, onnotice: () => {} });
    try {
      for (const table of TENANT_TABLES) {
        expect(await refusalCode(sql`select * from public.${sql(table)}`)).toBe('42501');
      }
    } finally {
      await sql.end();
    }
  });
});
```

`apps/api/tests/rls/as-user.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { env } from '../../../../test-support/env';
import { SEED, signInAs } from '../../../../test-support/auth';
import { signTestToken } from '../../../../test-support/tokens';
import { createVerifier, UnauthorizedError } from '../../src/auth/verify';
import { connect, createAsUser } from '../../src/db/asUser';
import { as, asUser, refusalCode } from '../helpers/db';
import { TENANT_TABLES } from './registry';

describe('asUser', () => {
  it.each([
    [
      'a tampered signature',
      async () => {
        const token = (await signInAs(SEED.adminA)).accessToken;
        return token.slice(0, -4) + (token.endsWith('AAAA') ? 'BBBB' : 'AAAA');
      },
    ],
    ['an expired token', () => signTestToken({ sub: randomUUID() }, { expiresInSeconds: -60 })],
    ['another audience', () => signTestToken({ sub: randomUUID() }, { audience: 'someone-else' })],
    ['text that is not a token', async () => 'not-a-jwt'],
  ])('refuses %s before touching the database', async (_name, makeToken) => {
    const fn = vi.fn();
    await expect(asUser(await makeToken(), fn)).rejects.toBeInstanceOf(UnauthorizedError);
    expect(fn).not.toHaveBeenCalled();
  });

  it('a validly signed token with no household claims reads nothing and cannot write', async () => {
    const token = await signTestToken({ sub: randomUUID() });
    for (const table of TENANT_TABLES) {
      expect(await asUser(token, (tx) => tx`select * from public.${tx(table)}`)).toHaveLength(0);
    }
    const admin = await signInAs(SEED.adminA);
    const code = await refusalCode(
      asUser(
        token,
        (tx) =>
          tx`insert into public.recipes (id, household_id, title) values (${randomUUID()}, ${admin.householdId}, 'No claims')`,
      ),
    );
    expect(code).toBe('42501');
  });

  it('claims and role do not leak to the next use of the same connection', async () => {
    // One connection, so the second transaction is guaranteed to reuse it.
    const sql = connect(env.apiDbUrl, { max: 1 });
    const single = createAsUser(sql, createVerifier({ audience: 'authenticated', jwksUrl: env.jwksUrl }));
    try {
      const admin = await signInAs(SEED.adminA);
      const seen = await single(admin.accessToken, (tx) => tx`select id from public.recipes`);
      expect(seen.length).toBeGreaterThan(0);

      const after = await sql.begin(async (tx) => {
        const [state] = await tx<{ role: string; claims: string | null }[]>`
          select current_user as role, current_setting('request.jwt.claims', true) as claims`;
        await tx`set local role authenticated`;
        const rows = await tx`select id from public.recipes`;
        return { state, count: rows.length };
      });
      expect(after.state?.role).toBe('api_login');
      expect(after.state?.claims ?? '').toBe('');
      expect(after.count).toBe(0);
    } finally {
      await sql.end();
    }
  });

  it('rolls everything back when the callback throws', async () => {
    const member = await signInAs(SEED.memberA);
    const id = randomUUID();
    await expect(
      as(member, async (tx) => {
        await tx`insert into public.recipes (id, household_id, title) values (${id}, ${member.householdId}, 'Half done')`;
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await as(member, (tx) => tx`select id from public.recipes where id = ${id}`)).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run the suite and confirm it fails**

Run: `pnpm test:rls`
Expected: FAIL, every file: `../../src/db/asUser` does not exist.

- [ ] **Step 4: Implement `asUser`**

`apps/api/src/db/asUser.ts`:

```ts
import postgres from 'postgres';
import type { VerifyToken } from '../auth/verify';

export type Sql = postgres.Sql;
export type UserTx = postgres.TransactionSql;
export type AsUser = <T>(token: string, fn: (tx: UserTx) => Promise<T>) => Promise<T>;

/** Connects as the API's login role. That role can do nothing until asUser switches role. */
export function connect(url: string, options: { max?: number } = {}): Sql {
  return postgres(url, { max: options.max ?? 10, onnotice: () => {} });
}

/**
 * The only way the API touches the database (spec §4).
 * Verifies the token, then runs `fn` in one transaction as the non-privileged
 * role `authenticated`, with the verified claims visible to RLS policies.
 * `set local` and the transaction-local setting both end with the transaction,
 * so nothing carries over to the next request on the same connection.
 */
export function createAsUser(sql: Sql, verify: VerifyToken): AsUser {
  return async <T>(token: string, fn: (tx: UserTx) => Promise<T>): Promise<T> => {
    const claims = await verify(token);
    const result = await sql.begin(async (tx) => {
      await tx`set local role authenticated`;
      await tx`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`;
      return fn(tx);
    });
    return result as T;
  };
}

/** For the health check: proves the database answers, reads no table. */
export function createPing(sql: Sql): () => Promise<void> {
  return async () => {
    await sql`select 1`;
  };
}
```

If `tsc` rejects `result as T`, use `result as unknown as T` (the driver's `begin` return type wraps `T`).

- [ ] **Step 5: Run the suite again and confirm it now fails on the database**

Run: `pnpm test:rls`
Expected: FAIL. Sign-in works, but statements fail with `relation "public.recipes" does not exist`, and `coverage.test.ts` reports an empty table list.

- [ ] **Step 6: Write the migration**

`db/migrations/20261013000000_create_households_memberships_recipes.sql`:

```sql
-- migrate:up
-- Households, memberships, recipes: tables, grants, RLS, triggers, token hook, publication.
-- FR-2, FR-4, FR-30, NFR-1. Runs as app_owner.

create type public.household_role as enum ('admin', 'member', 'viewer');

-- ---------------------------------------------------------------- tables

-- The tenant root. Its id is the household_id used by every other table,
-- so it has no household_id column of its own.
create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  deleted_at timestamptz
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id),
  -- unique: one household per user in v1 (SPEC §2)
  user_id uuid not null unique references auth.users (id) on delete cascade,
  role public.household_role not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  deleted_at timestamptz
);
create index memberships_household_id_idx on public.memberships (household_id);

create table public.recipes (
  id uuid primary key, -- generated on the client; no default on purpose
  household_id uuid not null references public.households (id),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  deleted_at timestamptz
);
create index recipes_household_id_idx on public.recipes (household_id);

-- ---------------------------------------------------------------- who is asking

-- The API sets request.jwt.claims for the length of one transaction (asUser).
-- With nothing set, each helper returns null and every policy denies.

create function public.auth_user_id() returns uuid
language sql stable
as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid
$$;

create function public.auth_household_id() returns uuid
language sql stable
as $$
  select nullif(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'household_id', ''
  )::uuid
$$;

create function public.auth_household_role() returns public.household_role
language sql stable
as $$
  select nullif(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'household_role', ''
  )::public.household_role
$$;

-- ---------------------------------------------------------------- token hook

-- GoTrue calls this for every access token and adds what it returns.
-- The claim is not called "role": GoTrue uses that claim itself.
create function public.custom_access_token_hook(event jsonb) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  claims jsonb := event -> 'claims';
  membership record;
begin
  select m.household_id, m.role into membership
  from public.memberships m
  where m.user_id = (event ->> 'user_id')::uuid and m.deleted_at is null;

  if found then
    claims := jsonb_set(claims, '{household_id}', to_jsonb(membership.household_id::text));
    claims := jsonb_set(claims, '{household_role}', to_jsonb(membership.role::text));
  end if;

  return jsonb_build_object('claims', claims);
end;
$$;

grant usage on schema public to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook from public;
grant execute on function public.custom_access_token_hook to supabase_auth_admin;

-- ---------------------------------------------------------------- sign-up

-- FR-2: a new account gets its own household and becomes its admin.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  new_household_id uuid;
begin
  insert into public.households (name, updated_by)
  values (coalesce(nullif(split_part(new.email, '@', 1), ''), 'My') || ' household', new.id)
  returning id into new_household_id;

  insert into public.memberships (household_id, user_id, role, updated_by)
  values (new_household_id, new.id, 'admin', new.id);

  return new;
end;
$$;

revoke execute on function public.handle_new_user from public;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- server-owned fields

-- Last-write-wins by arrival time: the server clock decides, not the device.
create function public.stamp_row() returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
  else
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  new.updated_by := public.auth_user_id();
  return new;
end;
$$;

create trigger recipes_stamp before insert or update on public.recipes
for each row execute function public.stamp_row();

create trigger households_stamp before update on public.households
for each row execute function public.stamp_row();

-- ---------------------------------------------------------------- grants

-- "authenticated" is the role asUser switches to. No delete grant anywhere:
-- delete means setting deleted_at. Memberships are read-only for clients.
grant usage on schema public to authenticated;
grant select, update on public.households to authenticated;
grant select on public.memberships to authenticated;
grant select, insert, update on public.recipes to authenticated;

-- ---------------------------------------------------------------- RLS

alter table public.households enable row level security;
alter table public.memberships enable row level security;
alter table public.recipes enable row level security;

create policy households_select on public.households
for select to authenticated
using (id = (select public.auth_household_id()));

create policy households_update on public.households
for update to authenticated
using (
  id = (select public.auth_household_id())
  and (select public.auth_household_role()) = 'admin'
)
with check (
  id = (select public.auth_household_id())
  and (select public.auth_household_role()) = 'admin'
);

-- Memberships: rows are written only by handle_new_user.
create policy memberships_select on public.memberships
for select to authenticated
using (household_id = (select public.auth_household_id()));

-- Mirrored by powersync/sync-config.yaml. Change both together.
create policy recipes_select on public.recipes
for select to authenticated
using (household_id = (select public.auth_household_id()));

create policy recipes_insert on public.recipes
for insert to authenticated
with check (
  household_id = (select public.auth_household_id())
  and (select public.auth_household_role()) in ('admin', 'member')
);

create policy recipes_update on public.recipes
for update to authenticated
using (
  household_id = (select public.auth_household_id())
  and (select public.auth_household_role()) in ('admin', 'member')
)
with check (
  household_id = (select public.auth_household_id())
  and (select public.auth_household_role()) in ('admin', 'member')
);

-- ---------------------------------------------------------------- sync

-- PowerSync replicates from a publication with this exact name, and reads
-- the published tables for its initial snapshot.
create publication powersync for table public.recipes;
grant usage on schema public to powersync_repl;
grant select on public.recipes to powersync_repl;

-- migrate:down
-- Not supported: this is the first migration. Restore from a backup instead.
```

- [ ] **Step 7: Add the migrate job and turn on the token hook**

In `docker-compose.yml`, add this service after `auth`:

```yaml
  migrate:
    image: ghcr.io/amacneil/dbmate:<pin>
    restart: 'no'
    depends_on:
      db:
        condition: service_healthy
      # GoTrue creates auth.users, which our migration references.
      auth:
        condition: service_healthy
    environment:
      DATABASE_URL: postgres://app_owner:${APP_OWNER_PASSWORD}@db:5432/app?sslmode=disable
    volumes:
      - ./db/migrations:/db/migrations:ro
    command:
      - --no-dump-schema
      - --migrations-dir
      - /db/migrations
      # Kept out of the public schema so the RLS coverage guard sees only our tables.
      - --migrations-table
      - dbmate.schema_migrations
      - migrate
```

and add these two lines to the `auth` service's `environment`:

```yaml
      GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_ENABLED: 'true'
      GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_URI: pg-functions://postgres/public/custom_access_token_hook
```

The hook is only called when a token is issued, and `migrate` finishes before anyone can sign in, so `auth` starting first is safe.

- [ ] **Step 8: Write the seed**

`db/seed.sql`:

```sql
-- Local development and test data. Applied only by `pnpm db:seed`, as the
-- superuser; never part of a production start.
-- Household A: admin, member, viewer. Household B: admin.

insert into public.households (id, name) values
  ('00000000-0000-0000-0000-00000000000a', 'Household A'),
  ('00000000-0000-0000-0000-00000000000b', 'Household B');

-- Inserting users fires handle_new_user, which gives each one a household of
-- their own. The statements after this block move them into A and B.
with seed_users (id, email) as (
  values
    ('00000000-0000-0000-0000-0000000000a1'::uuid, 'admin-a@example.test'),
    ('00000000-0000-0000-0000-0000000000a2'::uuid, 'member-a@example.test'),
    ('00000000-0000-0000-0000-0000000000a3'::uuid, 'viewer-a@example.test'),
    ('00000000-0000-0000-0000-0000000000b1'::uuid, 'admin-b@example.test')
),
inserted_users as (
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new
  )
  select
    '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', email, '',
    now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
  from seed_users
  returning id, email
)
insert into auth.identities (
  id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
)
select
  gen_random_uuid(), id, id::text,
  jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true),
  'email', now(), now(), now()
from inserted_users;

update public.memberships m
set household_id = s.household_id, role = s.role
from (
  values
    ('00000000-0000-0000-0000-0000000000a1'::uuid, '00000000-0000-0000-0000-00000000000a'::uuid, 'admin'::public.household_role),
    ('00000000-0000-0000-0000-0000000000a2'::uuid, '00000000-0000-0000-0000-00000000000a'::uuid, 'member'::public.household_role),
    ('00000000-0000-0000-0000-0000000000a3'::uuid, '00000000-0000-0000-0000-00000000000a'::uuid, 'viewer'::public.household_role),
    ('00000000-0000-0000-0000-0000000000b1'::uuid, '00000000-0000-0000-0000-00000000000b'::uuid, 'admin'::public.household_role)
) as s (user_id, household_id, role)
where m.user_id = s.user_id;

-- Remove the households the trigger created for the seed users.
delete from public.households h
where not exists (select 1 from public.memberships m where m.household_id = h.id);

insert into public.recipes (id, household_id, title) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000000a', 'Seed pancakes'),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-00000000000b', 'Seed curry');
```

- [ ] **Step 9: Apply and run the suite**

Run: `pnpm db:reset && pnpm test:rls && pnpm test:stack`
Expected: the stack comes up with `migrate` exited 0, the seed applies silently, and both suites PASS.

Likely first-run problems:

| Symptom | Cause and fix |
|---|---|
| `migrate` fails with `permission denied for table users` or `for schema auth` | The default privileges in `db/init/00-roles.sh` did not apply (GoTrue created its tables as a different role than `supabase_auth_admin`). Check the owner with `docker compose exec db psql -U postgres -d app -c '\dt auth.users'` and correct the `alter default privileges for role ...` line, then `pnpm db:reset`. |
| `migrate` fails creating `dbmate.schema_migrations` | The installed dbmate does not take a schema-qualified table name this way. Read `dbmate --help` in the container (`docker compose run --rm migrate --help`) and adjust the flag; keep the table out of `public`. |
| Seeded users cannot sign in (`Database error finding user`) | A token column is `NULL` in `auth.users`. Compare the seed's column list with `\d auth.users` and set any other `*_token` or `*_change` text column that has no default to `''`. |
| Claims are `null` for every user | The hook is not enabled or not executable: confirm the two `GOTRUE_HOOK_*` lines, check `docker compose logs auth` for a hook error, and confirm the `grant execute ... to supabase_auth_admin` line ran. |
| Sign-in fails with a hook error mentioning `permission denied for function` | `supabase_auth_admin` lacks `usage` on schema `public`; the grant is in the migration, so confirm `migrate` exited 0. |
| A refusal test gets a code other than `42501` | Print the error. `42P01` (no such table) means a typo; a missing-grant refusal and an RLS refusal are both `42501`. |
| `pnpm db:reset` stops with `container recipe-app-migrate-1 exited (0)` | Expected until Task 5. `up --wait` (Compose v5.3.1) fails on a one-shot service that exits 0 unless another service depends on it with `service_completed_successfully`; Task 5's `api` does. Until then confirm `migrate` exited 0 and run `pnpm db:seed` by hand. |

- [ ] **Step 10: Run all checks and commit**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:stack && pnpm test:rls`
Expected: clean.

```bash
git add -A
git commit -m "feat(db): households, memberships, recipes with RLS, asUser, and isolation suite (FR-1, FR-2, FR-4, NFR-1)"
```

---

### Task 5: The `/api/upload` endpoint and the API container (complete)

**Files:**
- Create: `apps/api/src/upload/ops.ts`, `apps/api/src/app.ts`, `apps/api/src/config.ts`, `apps/api/src/server.ts`
- Create: `apps/api/Dockerfile`
- Modify: `apps/api/package.json`, `docker-compose.yml` (add `api`), `eslint.config.mjs`, `package.json` (script)
- Test: `apps/api/src/app.test.ts`, `apps/api/tests/upload/upload.test.ts`

**Interfaces:**
- Consumes: `recipeSchema`, `recipePatchSchema` from `@recipe-app/domain`; `createVerifier`, `UnauthorizedError`, `VerifyToken` from `src/auth/verify.ts`; `connect`, `createAsUser`, `createPing`, `AsUser`, `UserTx` from `src/db/asUser.ts`; `signInAs`, `SEED`, `Actor`, `env` from `test-support/`; `as` from `apps/api/tests/helpers/db.ts`
- Produces:
  - `createApp(deps: AppDeps): Hono` where `AppDeps = { verify: VerifyToken; asUser: AsUser; ping: () => Promise<void> }`
  - `GET /api/health` → `200 { "ok": true }` when the database answers
  - `POST /api/upload`
    - Headers: `Authorization: Bearer <user JWT>`, `Content-Type: application/json`
    - Body: `{ "ops": [ { "op": "put" | "patch" | "delete", "table": string, "id": uuid, "data"?: object } ] }`, at most 500 ops, at most 1 MB
    - `200` → `{ "results": [ { "id", "status": "applied" } | { "id", "status": "rejected", "reason" } ] }`, same order as `ops`
    - Reasons: `table_not_allowed`, `delete_not_allowed`, `invalid`, `forbidden`, `not_found_or_forbidden`
    - `401` missing or invalid token (checked before the body) · `400` malformed body · `413` body over 1 MB · `500` unexpected failure, nothing applied
  - The `api` service in Compose, reachable through the proxy at `http://localhost:8080/api`
  - Script: `pnpm test:api`

- [ ] **Step 1: Add dependencies and the script**

```bash
pnpm --filter @recipe-app/api add hono @hono/node-server zod '@recipe-app/domain@workspace:*'
pnpm --filter @recipe-app/api add -D esbuild
```

In `apps/api/package.json`, set the scripts to:

```json
{
  "build": "esbuild src/server.ts --bundle --platform=node --target=node22 --format=cjs --outfile=dist/server.cjs",
  "typecheck": "tsc -p tsconfig.json"
}
```

Add to root `package.json` scripts:

```json
{
  "test:api": "vitest run -c vitest.integration.config.ts apps/api/tests/upload"
}
```

- [ ] **Step 2: Write the failing unit tests for the routes**

These run in-process with fake dependencies, so they need no stack.

`apps/api/src/app.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createApp, type AppDeps } from './app';
import { UnauthorizedError } from './auth/verify';

function deps(overrides: Partial<AppDeps> = {}): AppDeps {
  return {
    verify: vi.fn().mockResolvedValue({ sub: 'user-1' }),
    asUser: vi.fn().mockResolvedValue([]) as unknown as AppDeps['asUser'],
    ping: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function post(app: ReturnType<typeof createApp>, body: string, token: string | null = 'jwt') {
  return app.request('/api/upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body,
  });
}

const ID = '11111111-1111-4111-8111-111111111111';

describe('GET /api/health', () => {
  it('answers 200 when the database answers', async () => {
    const response = await createApp(deps()).request('/api/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it('answers 500 when the database does not', async () => {
    const app = createApp(deps({ ping: vi.fn().mockRejectedValue(new Error('down')) }));
    expect((await app.request('/api/health')).status).toBe(500);
  });
});

describe('POST /api/upload', () => {
  it('returns 401 with no token and never verifies or touches the database', async () => {
    const d = deps();
    const response = await post(createApp(d), '{"ops":[]}', null);
    expect(response.status).toBe(401);
    expect(d.verify).not.toHaveBeenCalled();
    expect(d.asUser).not.toHaveBeenCalled();
  });

  it('returns 401 for a refused token even when the body is also malformed', async () => {
    const d = deps({ verify: vi.fn().mockRejectedValue(new UnauthorizedError('bad')) });
    const response = await post(createApp(d), '{not json');
    expect(response.status).toBe(401);
    expect(d.asUser).not.toHaveBeenCalled();
  });

  it('returns 500, not 401, when the token cannot be checked', async () => {
    const d = deps({ verify: vi.fn().mockRejectedValue(new Error('key set unreachable')) });
    const response = await post(createApp(d), '{"ops":[]}');
    expect(response.status).toBe(500);
    expect(d.asUser).not.toHaveBeenCalled();
  });

  it.each([
    ['text that is not JSON', '{not json'],
    ['an object with no ops', '{}'],
    ['ops that is not an array', '{"ops":"nope"}'],
    ['an op with missing fields', '{"ops":[{"op":"put"}]}'],
    ['an op with an unknown verb', `{"ops":[{"op":"drop","table":"recipes","id":"${ID}"}]}`],
    ['an op with an id that is not a UUID', '{"ops":[{"op":"put","table":"recipes","id":"1"}]}'],
    ['an unknown top-level field', '{"ops":[],"extra":true}'],
  ])('returns 400 for %s and applies nothing', async (_name, body) => {
    const d = deps();
    const response = await post(createApp(d), body);
    expect(response.status).toBe(400);
    expect(d.asUser).not.toHaveBeenCalled();
  });

  it('returns 400 for 501 ops and applies nothing', async () => {
    const d = deps();
    const ops = Array.from({ length: 501 }, () => ({ op: 'put', table: 'recipes', id: ID }));
    const response = await post(createApp(d), JSON.stringify({ ops }));
    expect(response.status).toBe(400);
    expect(d.asUser).not.toHaveBeenCalled();
  });

  it('accepts exactly 500 ops', async () => {
    const d = deps();
    const ops = Array.from({ length: 500 }, () => ({ op: 'put', table: 'recipes', id: ID }));
    expect((await post(createApp(d), JSON.stringify({ ops }))).status).toBe(200);
    expect(d.asUser).toHaveBeenCalledTimes(1);
  });

  it('returns 413 for a body over 1 MB and applies nothing', async () => {
    const d = deps();
    const body = JSON.stringify({ ops: [], padding: 'x'.repeat(1024 * 1024) });
    const response = await post(createApp(d), body);
    expect(response.status).toBe(413);
    expect(d.asUser).not.toHaveBeenCalled();
  });

  it('returns the per-op results from the transaction', async () => {
    const results = [{ id: ID, status: 'applied' }];
    const d = deps({ asUser: vi.fn().mockResolvedValue(results) as unknown as AppDeps['asUser'] });
    const response = await post(createApp(d), '{"ops":[]}');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ results });
  });

  it('returns 500 when the transaction fails', async () => {
    const d = deps({
      asUser: vi.fn().mockRejectedValue(new Error('connection lost')) as unknown as AppDeps['asUser'],
    });
    expect((await post(createApp(d), '{"ops":[]}')).status).toBe(500);
  });
});
```

- [ ] **Step 3: Write the failing HTTP tests**

These go through the proxy to the running container, the way the app does.

`apps/api/tests/upload/upload.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { env } from '../../../../test-support/env';
import { SEED, signInAs, type Actor } from '../../../../test-support/auth';
import { signTestToken } from '../../../../test-support/tokens';
import { as } from '../helpers/db';

type Result = { id: string; status: 'applied' | 'rejected'; reason?: string };
type Row = { title: string; household_id: string; deleted_at: Date | null; updated_by: string };

const URL = `${env.apiUrl}/upload`;

function post(token: string | null, body: unknown): Promise<Response> {
  return fetch(URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function upload(actor: Actor, ops: unknown[]): Promise<Result[]> {
  const response = await post(actor.accessToken, { ops });
  expect(response.status).toBe(200);
  return ((await response.json()) as { results: Result[] }).results;
}

async function readRecipe(actor: Actor, id: string): Promise<Row | undefined> {
  const rows = await as(
    actor,
    (tx) => tx<Row[]>`
      select title, household_id, deleted_at, updated_by from public.recipes where id = ${id}`,
  );
  return rows[0];
}

function put(actor: Actor, id: string, title: string) {
  return { op: 'put', table: 'recipes', id, data: { household_id: actor.householdId, title } };
}

describe('GET /api/health', () => {
  it('answers through the proxy', async () => {
    const response = await fetch(`${env.apiUrl}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});

describe('POST /api/upload', () => {
  it('applies a put then a patch in order', async () => {
    const member = await signInAs(SEED.memberA);
    const id = randomUUID();
    const results = await upload(member, [
      put(member, id, '  Soup  '),
      { op: 'patch', table: 'recipes', id, data: { title: 'Better soup' } },
    ]);
    expect(results).toEqual([
      { id, status: 'applied' },
      { id, status: 'applied' },
    ]);
    const row = await readRecipe(member, id);
    expect(row?.title).toBe('Better soup');
    expect(row?.updated_by).toBe(member.userId);
  });

  it('is idempotent for a repeated put', async () => {
    const member = await signInAs(SEED.memberA);
    const id = randomUUID();
    await upload(member, [put(member, id, 'Once')]);
    const again = await upload(member, [put(member, id, 'Once')]);
    expect(again).toEqual([{ id, status: 'applied' }]);
    const rows = await as(member, (tx) => tx`select id from public.recipes where id = ${id}`);
    expect(rows).toHaveLength(1);
  });

  it('soft-deletes through a patch to deleted_at', async () => {
    const member = await signInAs(SEED.memberA);
    const id = randomUUID();
    await upload(member, [put(member, id, 'To trash')]);
    const results = await upload(member, [
      { op: 'patch', table: 'recipes', id, data: { deleted_at: new Date().toISOString() } },
    ]);
    expect(results[0]?.status).toBe('applied');
    expect((await readRecipe(member, id))?.deleted_at).not.toBeNull();
  });

  it('rejects an invalid change and still applies its neighbours', async () => {
    const member = await signInAs(SEED.memberA);
    const bad = randomUUID();
    const good = randomUUID();
    const results = await upload(member, [put(member, bad, '   '), put(member, good, 'Fine')]);
    expect(results).toEqual([
      { id: bad, status: 'rejected', reason: 'invalid' },
      { id: good, status: 'applied' },
    ]);
    expect(await readRecipe(member, bad)).toBeUndefined();
    expect((await readRecipe(member, good))?.title).toBe('Fine');
  });

  it('a database refusal in the middle of a batch does not undo its neighbours', async () => {
    const a = await signInAs(SEED.memberA);
    const b = await signInAs(SEED.adminB);
    const before = randomUUID();
    const planted = randomUUID();
    const after = randomUUID();
    const results = await upload(b, [
      put(b, before, 'Before'),
      { op: 'put', table: 'recipes', id: planted, data: { household_id: a.householdId, title: 'Planted' } },
      put(b, after, 'After'),
    ]);
    expect(results).toEqual([
      { id: before, status: 'applied' },
      { id: planted, status: 'rejected', reason: 'forbidden' },
      { id: after, status: 'applied' },
    ]);
    expect((await readRecipe(b, before))?.title).toBe('Before');
    expect((await readRecipe(b, after))?.title).toBe('After');
    expect(await readRecipe(a, planted)).toBeUndefined();
  });

  it('rejects unknown fields, including server-owned ones', async () => {
    const member = await signInAs(SEED.memberA);
    const id = randomUUID();
    const results = await upload(member, [
      {
        op: 'put',
        table: 'recipes',
        id,
        data: { household_id: member.householdId, title: 'x', updated_by: member.userId },
      },
    ]);
    expect(results).toEqual([{ id, status: 'rejected', reason: 'invalid' }]);
  });

  it('rejects a table that is not on the allow-list', async () => {
    const admin = await signInAs(SEED.adminA);
    const id = randomUUID();
    const results = await upload(admin, [
      { op: 'put', table: 'memberships', id, data: { role: 'admin' } },
    ]);
    expect(results).toEqual([{ id, status: 'rejected', reason: 'table_not_allowed' }]);
  });

  it('rejects a hard delete', async () => {
    const member = await signInAs(SEED.memberA);
    const id = randomUUID();
    await upload(member, [put(member, id, 'Stay')]);
    const results = await upload(member, [{ op: 'delete', table: 'recipes', id }]);
    expect(results).toEqual([{ id, status: 'rejected', reason: 'delete_not_allowed' }]);
    expect((await readRecipe(member, id))?.title).toBe('Stay');
  });

  it('rejects viewer writes', async () => {
    const member = await signInAs(SEED.memberA);
    const viewer = await signInAs(SEED.viewerA);
    const existing = randomUUID();
    await upload(member, [put(member, existing, 'Read only')]);
    const fresh = randomUUID();
    const results = await upload(viewer, [
      put(viewer, fresh, 'Viewer put'),
      { op: 'patch', table: 'recipes', id: existing, data: { title: 'Viewer patch' } },
    ]);
    expect(results).toEqual([
      { id: fresh, status: 'rejected', reason: 'forbidden' },
      { id: existing, status: 'rejected', reason: 'not_found_or_forbidden' },
    ]);
    expect((await readRecipe(member, existing))?.title).toBe('Read only');
  });

  it('rejects an id collision with another household and leaves that row unchanged', async () => {
    const a = await signInAs(SEED.memberA);
    const b = await signInAs(SEED.adminB);
    const id = randomUUID();
    await upload(a, [put(a, id, 'Belongs to A')]);
    const results = await upload(b, [put(b, id, 'Overwritten by B')]);
    expect(results).toEqual([{ id, status: 'rejected', reason: 'forbidden' }]);
    const row = await readRecipe(a, id);
    expect(row?.title).toBe('Belongs to A');
    expect(row?.household_id).toBe(a.householdId);
  });

  it('a patch cannot move a recipe into another household', async () => {
    const a = await signInAs(SEED.adminA);
    const b = await signInAs(SEED.adminB);
    const id = randomUUID();
    await upload(b, [put(b, id, 'Mine')]);
    const results = await upload(b, [
      { op: 'patch', table: 'recipes', id, data: { household_id: a.householdId } },
    ]);
    expect(results).toEqual([{ id, status: 'rejected', reason: 'forbidden' }]);
    expect((await readRecipe(b, id))?.household_id).toBe(b.householdId);
  });

  it('a user with no household claims has every write rejected', async () => {
    const admin = await signInAs(SEED.adminA);
    const token = await signTestToken({ sub: randomUUID() });
    const id = randomUUID();
    const response = await post(token, {
      ops: [{ op: 'put', table: 'recipes', id, data: { household_id: admin.householdId, title: 'x' } }],
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      results: [{ id, status: 'rejected', reason: 'forbidden' }],
    });
  });

  it('returns 401 without a token, with a bad token, and with an expired token', async () => {
    expect((await post(null, { ops: [] })).status).toBe(401);
    expect((await post('not-a-jwt', { ops: [] })).status).toBe(401);
    const expired = await signTestToken({ sub: randomUUID() }, { expiresInSeconds: -60 });
    expect((await post(expired, { ops: [] })).status).toBe(401);
  });

  it('returns 400 for a malformed body', async () => {
    const member = await signInAs(SEED.memberA);
    expect((await post(member.accessToken, '{not json')).status).toBe(400);
    expect((await post(member.accessToken, {})).status).toBe(400);
    expect((await post(member.accessToken, { ops: 'nope' })).status).toBe(400);
    expect((await post(member.accessToken, { ops: [{ op: 'put' }] })).status).toBe(400);
  });

  it('returns 400 for more than 500 ops and applies none', async () => {
    const member = await signInAs(SEED.memberA);
    const ops = Array.from({ length: 501 }, () => put(member, randomUUID(), 'Bulk'));
    const firstId = (ops[0] as { id: string }).id;
    expect((await post(member.accessToken, { ops })).status).toBe(400);
    expect(await readRecipe(member, firstId)).toBeUndefined();
  });
});

describe('cross-origin access', () => {
  it('answers the preflight from the dev origin', async () => {
    const response = await fetch(URL, {
      method: 'OPTIONS',
      headers: {
        Origin: env.corsDevOrigin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type',
      },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe(env.corsDevOrigin);
    expect(response.headers.get('access-control-allow-headers')).toContain('authorization');
  });

  it('gives no allow-origin header to any other origin', async () => {
    const response = await fetch(`${env.apiUrl}/health`, {
      headers: { Origin: 'https://evil.example' },
    });
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });
});
```

- [ ] **Step 4: Run both and confirm they fail**

Run: `pnpm test; pnpm test:api`
Expected: `pnpm test` FAILS on `app.test.ts` (`./app` does not exist). `pnpm test:api` FAILS: requests to `/api/*` return `502` because there is no `api` container.

- [ ] **Step 5: Implement the op logic and the routes**

`apps/api/src/upload/ops.ts`:

```ts
import { recipePatchSchema, recipeSchema } from '@recipe-app/domain';
import { z } from 'zod';
import type { UserTx } from '../db/asUser';

export const MAX_OPS = 500;
const ALLOWED_TABLES = new Set(['recipes']);

const opSchema = z.strictObject({
  op: z.enum(['put', 'patch', 'delete']),
  table: z.string(),
  id: z.guid(),
  data: z.record(z.string(), z.unknown()).optional(),
});
const bodySchema = z.strictObject({ ops: z.array(opSchema).max(MAX_OPS) });

export type Op = z.infer<typeof opSchema>;
export type Result =
  | { id: string; status: 'applied' }
  | { id: string; status: 'rejected'; reason: string };

const applied = (op: Op): Result => ({ id: op.id, status: 'applied' });
const rejected = (op: Op, reason: string): Result => ({ id: op.id, status: 'rejected', reason });

/** Returns the ops, or null when the body is not the documented shape. */
export function parseBody(payload: unknown): Op[] | null {
  const parsed = bodySchema.safeParse(payload);
  return parsed.success ? parsed.data.ops : null;
}

/**
 * Errors the database raises because of what the caller sent: RLS refusal or
 * missing grant (42501), constraint violations (23xxx), bad data (22xxx).
 * Retrying cannot fix these, so they become "rejected". Anything else is
 * unexpected and fails the whole request so the client retries.
 */
function isRefusal(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return (
    typeof code === 'string' && (code === '42501' || code.startsWith('23') || code.startsWith('22'))
  );
}

async function applyOne(tx: UserTx, op: Op): Promise<Result> {
  if (!ALLOWED_TABLES.has(op.table)) return rejected(op, 'table_not_allowed');
  if (op.op === 'delete') return rejected(op, 'delete_not_allowed');

  const candidate = { ...(op.data ?? {}), id: op.id };

  if (op.op === 'put') {
    const parsed = recipeSchema.safeParse(candidate);
    if (!parsed.success) return rejected(op, 'invalid');
    const { id, household_id, title } = parsed.data;
    const deleted_at = parsed.data.deleted_at ?? null;
    // An existing row the caller may not update (another household's, or any
    // row for a viewer) makes the DO UPDATE branch raise 42501.
    await tx`
      insert into public.recipes (id, household_id, title, deleted_at)
      values (${id}, ${household_id}, ${title}, ${deleted_at})
      on conflict (id) do update
        set household_id = excluded.household_id,
            title = excluded.title,
            deleted_at = excluded.deleted_at`;
    return applied(op);
  }

  const parsed = recipePatchSchema.safeParse(candidate);
  if (!parsed.success) return rejected(op, 'invalid');
  const { id, ...fields } = parsed.data;
  const rows = await tx`update public.recipes set ${tx(fields)} where id = ${id} returning id`;
  // RLS hides rows the caller may not update, so "no row" covers both cases.
  return rows.length === 0 ? rejected(op, 'not_found_or_forbidden') : applied(op);
}

/**
 * Applies ops in order inside the caller's transaction. Each op gets its own
 * savepoint, so a refused op is undone alone and its neighbours stand. Every
 * op is idempotent, so a client retry after a failed request is safe.
 */
export async function applyOps(tx: UserTx, ops: Op[]): Promise<Result[]> {
  const results: Result[] = [];
  for (const op of ops) {
    try {
      results.push((await tx.savepoint((savepoint) => applyOne(savepoint, op))) as Result);
    } catch (error) {
      if (!isRefusal(error)) throw error;
      results.push(rejected(op, 'forbidden'));
    }
  }
  return results;
}
```

`apps/api/src/app.ts`:

```ts
import { Hono } from 'hono';
import { UnauthorizedError, type VerifyToken } from './auth/verify';
import type { AsUser } from './db/asUser';
import { applyOps, parseBody } from './upload/ops';

export type AppDeps = {
  verify: VerifyToken;
  asUser: AsUser;
  ping: () => Promise<void>;
};

const MAX_BODY_BYTES = 1024 * 1024;

function bearer(header: string | undefined): string | null {
  return /^Bearer (.+)$/.exec(header ?? '')?.[1] ?? null;
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  app.onError((error, c) => {
    if (error instanceof UnauthorizedError) return c.json({ error: 'unauthorized' }, 401);
    // Everything else is ours to fix. The client keeps its changes queued and retries.
    console.error(
      JSON.stringify({ event: 'request_failed', path: c.req.path, message: String(error) }),
    );
    return c.json({ error: 'internal' }, 500);
  });

  app.get('/api/health', async (c) => {
    await deps.ping();
    return c.json({ ok: true });
  });

  app.post('/api/upload', async (c) => {
    const token = bearer(c.req.header('Authorization'));
    if (!token) return c.json({ error: 'unauthorized' }, 401);
    // Checked before the body is read, so a bad token is always a 401.
    await deps.verify(token);

    // The proxy refuses anything far larger before it reaches this process;
    // this is the exact limit.
    const raw = await c.req.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
      return c.json({ error: 'too_large' }, 413);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }
    const ops = parseBody(payload);
    if (!ops) return c.json({ error: 'invalid_body' }, 400);

    // One transaction for the batch: an unexpected failure applies nothing.
    const results = await deps.asUser(token, (tx) => applyOps(tx, ops));
    return c.json({ results });
  });

  return app;
}
```

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 6: Implement config and the server entry point**

`apps/api/src/config.ts`:

```ts
import type { VerifierConfig } from './auth/verify';

export type Config = { port: number; databaseUrl: string; verifier: VerifierConfig };

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const audience = env.JWT_AUDIENCE ?? 'authenticated';
  return {
    port: Number(env.PORT ?? 3000),
    databaseUrl: required(env, 'DATABASE_URL'),
    // A published key set when the auth service signs asymmetrically,
    // otherwise the shared secret. Never both.
    verifier: env.JWT_JWKS_URL
      ? { audience, jwksUrl: env.JWT_JWKS_URL }
      : { audience, secret: required(env, 'JWT_SECRET') },
  };
}
```

`apps/api/src/server.ts`:

```ts
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { createVerifier } from './auth/verify';
import { loadConfig } from './config';
import { connect, createAsUser, createPing } from './db/asUser';

const config = loadConfig();
const sql = connect(config.databaseUrl);
const verify = createVerifier(config.verifier);
const app = createApp({ verify, asUser: createAsUser(sql, verify), ping: createPing(sql) });

const server = serve({ fetch: app.fetch, port: config.port, hostname: '0.0.0.0' });
console.log(JSON.stringify({ event: 'listening', port: config.port }));

function shutdown() {
  server.close(() => {
    void sql.end({ timeout: 5 }).then(() => process.exit(0));
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
```

In `eslint.config.mjs`, add this entry to the end of the `tseslint.config(...)` argument list:

```js
  {
    // asUser is the only database entry point in the API (spec §13).
    files: ['apps/api/src/**/*.ts'],
    ignores: ['apps/api/src/db/asUser.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'postgres',
              message: 'Go through asUser in src/db/asUser.ts; do not open your own connection.',
            },
          ],
        },
      ],
    },
  },
```

- [ ] **Step 7: Containerize the API**

`apps/api/Dockerfile` (the build context is the repo root):

```dockerfile
FROM node:22-slim AS build
WORKDIR /repo
RUN corepack enable
# Manifests first, so the dependency layer is cached until they change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/mobile/package.json apps/mobile/
COPY packages/domain/package.json packages/domain/
RUN pnpm install --frozen-lockfile --filter '@recipe-app/api...'
COPY tsconfig.base.json ./
COPY packages/domain packages/domain
COPY apps/api apps/api
RUN pnpm --filter @recipe-app/api run build

# One bundled file; no node_modules in the runtime image.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/apps/api/dist/server.cjs ./server.cjs
USER node
EXPOSE 3000
HEALTHCHECK --interval=2s --timeout=5s --retries=30 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.cjs"]
```

In `docker-compose.yml`, add this service after `migrate`:

```yaml
  api:
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
      auth:
        condition: service_healthy
      migrate:
        condition: service_completed_successfully
    environment:
      PORT: 3000
      DATABASE_URL: postgres://api_login:${API_LOGIN_PASSWORD}@db:5432/app
      JWT_JWKS_URL: http://auth:9999/.well-known/jwks.json
      JWT_AUDIENCE: authenticated
```

- [ ] **Step 8: Build, start, and run the HTTP tests**

Run: `pnpm dev:backend && pnpm test:api`
Expected: the `api` image builds, `api` becomes healthy, and the suite PASSES.

| Symptom | Fix |
|---|---|
| The image build fails at `pnpm install` with a lockfile error | Run `pnpm install` on the host so `pnpm-lock.yaml` includes `apps/api`, commit it, rebuild. |
| The image build fails at `pnpm install` with `ERR_PNPM_IGNORED_BUILDS` (esbuild) | pnpm 12 only warns on the host but fails in the image. Record the decision with `pnpm approve-builds '!esbuild'` (writes `allowBuilds` to `pnpm-workspace.yaml`); the binary comes from esbuild's platform package, so its install script is not needed. |
| The container exits with `Dynamic require` or a module-format error | A dependency did not bundle as CommonJS. Read the message; mark that one package `--external:<name>` in the build script and copy its folder from the build stage's `node_modules` into the runtime image. |
| `api` unhealthy; log shows `password authentication failed` | The database volume predates the current `.env`. `pnpm db:reset`. |
| Every request `401`; log is quiet | The API cannot verify: `docker compose exec api node -e "fetch('http://auth:9999/.well-known/jwks.json').then(r=>r.text()).then(console.log)"` must print the key set. |
| Preflight test gets `200` or `404`, not `204` | The request reached the API: in `deploy/Caddyfile` the `import dev_cors` line must be first inside `route`. `docker compose up -d --build proxy`. |
| `put` id-collision test gets `applied` | The upsert's `do update` ran against another household's row. Stop: this is an isolation failure. Check the `recipes_update` policy has both `using` and `with check`. |

- [ ] **Step 9: Run all checks and commit**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:stack && pnpm test:rls && pnpm test:api`
Expected: clean.

```bash
git add -A
git commit -m "feat(api): /api/upload with zod validation under RLS, as a container (FR-30, NFR-1, NFR-3)"
```

---

### Task 6: Sign-in, the recipe repository, and the list screen (complete)

After this task the built app is served by the proxy at `http://localhost:8080` and works with no sync: sign in, add recipes, sign out. Recipes queue in the local database and are not yet uploaded.

**Files:**
- Modify: `deploy/proxy.Dockerfile` (web build stage), `playwright.config.ts`, `package.json`, `apps/mobile/package.json`
- Create: `apps/mobile/src/config.ts`
- Create: `apps/mobile/src/session/claims.ts`, `email.ts`, `auth.ts`, `SessionProvider.tsx`
- Create: `apps/mobile/src/recipes/repository.ts`, `useRecipes.ts`
- Create: `apps/mobile/src/db/DatabaseSessionBridge.tsx`
- Create: `apps/mobile/src/components/AddRecipeForm.tsx`
- Create: `apps/mobile/src/screens/SignInScreen.tsx`, `RecipeListScreen.tsx`
- Create: `apps/mobile/app/sign-in.tsx`
- Modify: `apps/mobile/app/_layout.tsx`, `apps/mobile/app/index.tsx`
- Test: `apps/mobile/src/session/claims.test.ts`, `email.test.ts`, `apps/mobile/src/recipes/repository.test.ts`
- Test: `e2e/helpers.ts`, `e2e/auth.spec.ts`, `e2e/recipes.spec.ts`
- Delete: `e2e/shell.spec.ts` (superseded: every later spec needs the database to open)

**Interfaces:**
- Consumes: `recipeTitleSchema` from `@recipe-app/domain`; `openDatabase`, `DatabaseProvider`, `StatusLine` from Task 2; `watchMailbox` from `test-support/mail.ts` and `env` from `test-support/env.ts` (Task 3); the proxy routes from Task 3; the seed users from Task 4
- Produces:
  - `type HouseholdRole = 'admin' | 'member' | 'viewer'`
  - `type Claims = { userId: string; householdId: string; role: HouseholdRole }`
  - `claimsFromToken(token: string): Claims | null`; `canWrite(role: HouseholdRole): boolean`
  - `normalizeEmail(input: string): string | null`
  - `auth: AuthClient` from `src/session/auth.ts` (GoTrue's client library, `@supabase/auth-js`)
  - `config: { authUrl: string; apiUrl: string; powersyncUrl: string }` from `src/config.ts` (absolute URLs; same-origin unless overridden by `EXPO_PUBLIC_*`)
  - The built web app served by `proxy` at `http://localhost:8080`; `pnpm test:e2e` rebuilds it and runs Playwright against it
  - `useSession(): SessionValue` where
    `SessionValue = { state: { status: 'loading' } | { status: 'signedOut' } | { status: 'signedIn'; userId: string; claims: Claims | null }; requestCode(email: string): Promise<ActionResult>; verifyCode(email: string, code: string): Promise<ActionResult>; signOut(): Promise<void> }` and `ActionResult = { ok: true } | { ok: false; message: string }`
  - `createRecipe(db: Pick<AbstractPowerSyncDatabase, 'execute'>, claims: Claims, title: string): Promise<string>` (returns the new id; throws `ZodError` for a bad title, `Error` for a viewer)
  - `LIST_RECIPES_SQL: string`; `type RecipeListItem = { id: string; title: string }`; `useRecipes()` (the spec's `watchRecipes`, as a React hook)
  - `<DatabaseSessionBridge />` — wipes the local database when signed out; Task 7 adds connecting on sign-in
  - e2e helpers: `freshEmail(tag)`, `requestCode(page, email)`, `signIn(page, email)`, `addRecipe(page, title)`, `SEED`
  - UI labels used by tests: inputs `Email`, `Code`, `Recipe title`; buttons `Send code`, `Sign in`, `Add recipe`, `Sign out`; heading `Recipes`; empty text `No recipes yet`

- [ ] **Step 1: Write failing unit tests**

`apps/mobile/src/session/claims.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { canWrite, claimsFromToken } from './claims';

function token(payload: object): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode(payload)}.signature`;
}

describe('claimsFromToken', () => {
  it('reads the user, household, and role', () => {
    expect(
      claimsFromToken(token({ sub: 'user-1', household_id: 'house-1', household_role: 'member' })),
    ).toEqual({ userId: 'user-1', householdId: 'house-1', role: 'member' });
  });

  it('handles non-ASCII characters in the payload', () => {
    const claims = claimsFromToken(
      token({ sub: 'u', household_id: 'h', household_role: 'admin', email: 'zoë@example.test' }),
    );
    expect(claims?.role).toBe('admin');
  });

  it('returns null when the household claims are missing', () => {
    expect(claimsFromToken(token({ sub: 'user-1' }))).toBeNull();
  });

  it('returns null for an unknown role', () => {
    expect(
      claimsFromToken(token({ sub: 'u', household_id: 'h', household_role: 'owner' })),
    ).toBeNull();
  });

  it('returns null for text that is not a token', () => {
    expect(claimsFromToken('')).toBeNull();
    expect(claimsFromToken('a.b.c')).toBeNull();
  });
});

describe('canWrite', () => {
  it('allows admins and members, not viewers', () => {
    expect(canWrite('admin')).toBe(true);
    expect(canWrite('member')).toBe(true);
    expect(canWrite('viewer')).toBe(false);
  });
});
```

`apps/mobile/src/session/email.test.ts`:

```ts
import { expect, it } from 'vitest';
import { normalizeEmail } from './email';

it('trims and lower-cases', () => {
  expect(normalizeEmail('  Wes@Example.TEST ')).toBe('wes@example.test');
});

it.each(['', '   ', 'no-at-sign', 'two@@example.test', 'a@b', 'has space@example.test'])(
  'rejects %j',
  (input) => {
    expect(normalizeEmail(input)).toBeNull();
  },
);
```

`apps/mobile/src/recipes/repository.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { Claims } from '../session/claims';
import { createRecipe } from './repository';

const member: Claims = { userId: 'user-1', householdId: 'house-1', role: 'member' };

function fakeDb() {
  return { execute: vi.fn().mockResolvedValue({ rowsAffected: 1 }) };
}

describe('createRecipe', () => {
  it('inserts a trimmed title with a new UUID and the session household', async () => {
    const db = fakeDb();
    const id = await createRecipe(db, member, '  Pancakes  ');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(db.execute).toHaveBeenCalledTimes(1);
    const [sql, params] = db.execute.mock.calls[0]!;
    expect(sql).toMatch(/insert into recipes \(id, household_id, title\)/i);
    expect(params).toEqual([id, 'house-1', 'Pancakes']);
  });

  it('never writes server-owned columns', async () => {
    const db = fakeDb();
    await createRecipe(db, member, 'Soup');
    const [sql] = db.execute.mock.calls[0]!;
    expect(sql).not.toMatch(/created_at|updated_at|updated_by/);
  });

  it.each(['', '   ', 'a'.repeat(201)])('rejects the title %j and writes nothing', async (title) => {
    const db = fakeDb();
    await expect(createRecipe(db, member, title)).rejects.toThrow();
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('refuses to write for a viewer', async () => {
    const db = fakeDb();
    await expect(createRecipe(db, { ...member, role: 'viewer' }, 'Soup')).rejects.toThrow(
      'Viewers cannot add recipes',
    );
    expect(db.execute).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm test`
Expected: FAIL, the three modules do not exist.

- [ ] **Step 3: Implement claims, email, and the repository**

`apps/mobile/src/session/claims.ts`:

```ts
export type HouseholdRole = 'admin' | 'member' | 'viewer';
export type Claims = { userId: string; householdId: string; role: HouseholdRole };

const ROLES: readonly string[] = ['admin', 'member', 'viewer'];

function decodeBase64Url(segment: string): string {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * Reads the household claims the access-token hook adds. Used only to shape
 * the UI and to stamp household_id on local rows; the server re-checks
 * everything through RLS.
 */
export function claimsFromToken(token: string): Claims | null {
  try {
    const payload: unknown = JSON.parse(decodeBase64Url(token.split('.')[1] ?? ''));
    if (typeof payload !== 'object' || payload === null) return null;
    const { sub, household_id, household_role } = payload as Record<string, unknown>;
    if (typeof sub !== 'string' || typeof household_id !== 'string') return null;
    if (typeof household_role !== 'string' || !ROLES.includes(household_role)) return null;
    return { userId: sub, householdId: household_id, role: household_role as HouseholdRole };
  } catch {
    return null;
  }
}

export function canWrite(role: HouseholdRole): boolean {
  return role === 'admin' || role === 'member';
}
```

`apps/mobile/src/session/email.ts`:

```ts
/** Returns the trimmed, lower-cased address, or null when it is not usable. */
export function normalizeEmail(input: string): string | null {
  const email = input.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}
```

`apps/mobile/src/recipes/repository.ts`:

```ts
import type { AbstractPowerSyncDatabase } from '@powersync/web';
import { recipeTitleSchema } from '@recipe-app/domain';
import { canWrite, type Claims } from '../session/claims';

export type RecipeListItem = { id: string; title: string };

export const LIST_RECIPES_SQL =
  'select id, title from recipes where deleted_at is null order by title collate nocase, id';

/**
 * Writes to the local database only. PowerSync queues the row for upload.
 * created_at, updated_at, and updated_by are set by the server.
 */
export async function createRecipe(
  db: Pick<AbstractPowerSyncDatabase, 'execute'>,
  claims: Claims,
  title: string,
): Promise<string> {
  if (!canWrite(claims.role)) throw new Error('Viewers cannot add recipes');
  const cleanTitle = recipeTitleSchema.parse(title);
  const id = crypto.randomUUID();
  await db.execute('insert into recipes (id, household_id, title) values (?, ?, ?)', [
    id,
    claims.householdId,
    cleanTitle,
  ]);
  return id;
}
```

`apps/mobile/src/recipes/useRecipes.ts`:

```ts
import { useQuery } from '@powersync/react';
import { LIST_RECIPES_SQL, type RecipeListItem } from './repository';

/** Live list of the household's recipes from the local database. */
export function useRecipes() {
  return useQuery<RecipeListItem>(LIST_RECIPES_SQL);
}
```

- [ ] **Step 4: Run the unit tests and confirm they pass**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 5: Serve the built app from the proxy and write the failing end-to-end tests**

The end-to-end tests run against the app as it ships: built into the proxy image and served from the same origin as the API (spec §9).

`deploy/proxy.Dockerfile` (replace):

```dockerfile
FROM node:22-slim AS web
WORKDIR /repo
RUN corepack enable
# Manifests first, so the dependency layer is cached until they change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/mobile/package.json apps/mobile/
COPY packages/domain/package.json packages/domain/
RUN pnpm install --frozen-lockfile --filter 'mobile...'
COPY tsconfig.base.json ./
COPY packages/domain packages/domain
COPY apps/mobile apps/mobile
# No EXPO_PUBLIC_* values are set: the bundle uses same-origin paths, so this
# image is identical on every host.
ENV METRO_MAX_WORKERS=2
RUN pnpm --filter mobile run build:web

FROM caddy:2
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY deploy/email-templates /srv/email-templates
COPY --from=web /repo/apps/mobile/dist /srv/web
```

`playwright.config.ts` (replace):

```ts
import { defineConfig, devices } from '@playwright/test';

// No webServer: the app under test is the one built into the proxy image.
// `pnpm test:e2e` rebuilds and starts the stack first.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  retries: 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8080',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
```

In root `package.json`, replace the `dev:web` and `test:e2e` scripts:

```json
{
  "dev:web": "EXPO_PUBLIC_AUTH_URL=http://localhost:8080/auth EXPO_PUBLIC_API_URL=http://localhost:8080/api EXPO_PUBLIC_POWERSYNC_URL=http://localhost:8080/sync pnpm --filter mobile run web",
  "test:e2e": "node scripts/init-env.mjs && docker compose --profile dev up -d --build --wait && playwright test"
}
```

The proxy now serves the app, so the standalone static server from Task 2 goes:

```bash
pnpm --filter mobile remove serve
```

and delete the `serve:web` script from `apps/mobile/package.json`.

`e2e/helpers.ts`:

```ts
import { expect, type Page } from '@playwright/test';
import { env } from '../test-support/env';
import { watchMailbox } from '../test-support/mail';

export const SEED = {
  adminA: 'admin-a@example.test',
  memberA: 'member-a@example.test',
  viewerA: 'viewer-a@example.test',
  adminB: 'admin-b@example.test',
} as const;

export function freshEmail(tag: string): string {
  return `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
}

/** Fills the email step and returns the code that was emailed. */
export async function requestCode(page: Page, email: string): Promise<string> {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  const mailbox = await watchMailbox(env.mailUrl, email);
  await page.getByRole('button', { name: 'Send code' }).click();
  return mailbox.nextCode();
}

export async function signIn(page: Page, email: string): Promise<void> {
  const code = await requestCode(page, email);
  await page.getByLabel('Code').fill(code);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Recipes' })).toBeVisible();
}

export async function addRecipe(page: Page, title: string): Promise<void> {
  await page.getByLabel('Recipe title').fill(title);
  await page.getByRole('button', { name: 'Add recipe' }).click();
  await expect(page.getByText(title, { exact: true })).toBeVisible();
}
```

`e2e/auth.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { env } from '../test-support/env';
import { watchMailbox } from '../test-support/mail';
import { addRecipe, freshEmail, requestCode, signIn } from './helpers';

test('a new email signs in with a code and lands on an empty recipe list', async ({ page }) => {
  await signIn(page, freshEmail('new'));
  await expect(page.getByText('No recipes yet')).toBeVisible();
});

test('an email typed with capitals and spaces still signs in', async ({ page }) => {
  const email = freshEmail('caps');
  await page.goto('/');
  // The mailbox is watched under the normalised address.
  const mailbox = await watchMailbox(env.mailUrl, email);
  await page.getByLabel('Email').fill(`  ${email.toUpperCase()} `);
  await page.getByRole('button', { name: 'Send code' }).click();
  const code = await mailbox.nextCode();
  await page.getByLabel('Code').fill(code);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Recipes' })).toBeVisible();
});

test('an invalid email shows a message and sends nothing', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Email').fill('not-an-email');
  await page.getByRole('button', { name: 'Send code' }).click();
  await expect(page.getByText('Enter a valid email address.')).toBeVisible();
  await expect(page.getByLabel('Code')).toHaveCount(0);
});

test('a wrong code shows a message and the right code still works', async ({ page }) => {
  const code = await requestCode(page, freshEmail('wrong'));
  const wrong = code === '000000' ? '111111' : '000000';
  await page.getByLabel('Code').fill(wrong);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('That code is incorrect or has expired.')).toBeVisible();

  await page.getByLabel('Code').fill(code);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Recipes' })).toBeVisible();
});

test('the session survives a reload', async ({ page }) => {
  await signIn(page, freshEmail('reload'));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Recipes' })).toBeVisible();
});

test('signing out wipes the local database', async ({ page }) => {
  await signIn(page, freshEmail('first'));
  await addRecipe(page, 'Secret stew');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByLabel('Email')).toBeVisible();

  await signIn(page, freshEmail('second'));
  await expect(page.getByText('No recipes yet')).toBeVisible();
  await expect(page.getByText('Secret stew')).toHaveCount(0);
});
```

`e2e/recipes.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { addRecipe, freshEmail, SEED, signIn } from './helpers';

test('an added recipe appears in the list and survives a reload', async ({ page }) => {
  await signIn(page, freshEmail('cook'));
  await addRecipe(page, 'Tomato soup');
  await expect(page.getByText('No recipes yet')).toHaveCount(0);
  await expect(page.getByLabel('Recipe title')).toHaveValue('');
  await page.reload();
  await expect(page.getByText('Tomato soup', { exact: true })).toBeVisible();
});

test('rejects a blank title with a message and saves nothing', async ({ page }) => {
  await signIn(page, freshEmail('blank'));
  await page.getByLabel('Recipe title').fill('   ');
  await page.getByRole('button', { name: 'Add recipe' }).click();
  await expect(page.getByText('Title is required')).toBeVisible();
  await expect(page.getByText('No recipes yet')).toBeVisible();
});

test('rejects a title over 200 characters', async ({ page }) => {
  await signIn(page, freshEmail('long'));
  await page.getByLabel('Recipe title').fill('a'.repeat(201));
  await page.getByRole('button', { name: 'Add recipe' }).click();
  await expect(page.getByText('Title must be 200 characters or fewer')).toBeVisible();
  await expect(page.getByText('No recipes yet')).toBeVisible();
});

test('a viewer sees the list but no add form', async ({ page }) => {
  await signIn(page, SEED.viewerA);
  await expect(page.getByLabel('Recipe title')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add recipe' })).toHaveCount(0);
});
```

Delete the superseded spec: `rm e2e/shell.spec.ts`.

- [ ] **Step 6: Run them and confirm they fail**

Run: `pnpm db:reset && pnpm test:e2e`
Expected: the proxy image builds the web app (several minutes the first time), then the specs FAIL: the page shows the Task 2 shell and there is no `Email` field.

If the image build is killed or hangs in `expo export`, that is the WSL memory cap (Global Constraints): stop and tell the owner.

- [ ] **Step 7: Implement config, the auth client, and the session**

```bash
pnpm --filter mobile add @supabase/auth-js
```

`apps/mobile/src/config.ts`:

```ts
// Where the app finds its services. In the built app these are paths on the
// origin that served it, so the bundle contains no host name and no keys
// (CLAUDE.md rule 2). `pnpm dev:web` runs on a different origin and overrides
// them. Expo inlines EXPO_PUBLIC_* at build time; each must be referenced
// literally.
const origin = typeof window === 'undefined' ? 'http://localhost:8080' : window.location.origin;

function resolve(override: string | undefined, path: string): string {
  return override && override.length > 0 ? override : `${origin}${path}`;
}

export const config = {
  authUrl: resolve(process.env.EXPO_PUBLIC_AUTH_URL, '/auth'),
  apiUrl: resolve(process.env.EXPO_PUBLIC_API_URL, '/api'),
  powersyncUrl: resolve(process.env.EXPO_PUBLIC_POWERSYNC_URL, '/sync'),
};
```

`apps/mobile/src/session/auth.ts`:

```ts
import { AuthClient } from '@supabase/auth-js';
import { config } from '../config';

// GoTrue's client library, used for authentication only. Recipe data goes
// through the local database.
export const auth = new AuthClient({
  url: config.authUrl,
  persistSession: true,
  autoRefreshToken: true,
  detectSessionInUrl: false,
});
```

`apps/mobile/src/session/SessionProvider.tsx`:

```tsx
import type { Session } from '@supabase/auth-js';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { auth } from './auth';
import { claimsFromToken, type Claims } from './claims';
import { normalizeEmail } from './email';

export type SessionState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'signedIn'; userId: string; claims: Claims | null };

export type ActionResult = { ok: true } | { ok: false; message: string };

export type SessionValue = {
  state: SessionState;
  requestCode(email: string): Promise<ActionResult>;
  verifyCode(email: string, code: string): Promise<ActionResult>;
  signOut(): Promise<void>;
};

const UNREACHABLE = 'Could not reach the server. Check your connection and try again.';

function toState(session: Session | null): SessionState {
  if (!session) return { status: 'signedOut' };
  return {
    status: 'signedIn',
    userId: session.user.id,
    claims: claimsFromToken(session.access_token),
  };
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: 'loading' });

  useEffect(() => {
    void auth.getSession().then(({ data }) => setState(toState(data.session)));
    const { data } = auth.onAuthStateChange((_event, session) =>
      setState(toState(session)),
    );
    return () => data.subscription.unsubscribe();
  }, []);

  const value = useMemo<SessionValue>(
    () => ({
      state,
      async requestCode(input) {
        const email = normalizeEmail(input);
        if (!email) return { ok: false, message: 'Enter a valid email address.' };
        try {
          const { error } = await auth.signInWithOtp({ email });
          if (!error) return { ok: true };
          return {
            ok: false,
            message: error.status ? 'Could not send a code. Try again in a moment.' : UNREACHABLE,
          };
        } catch {
          return { ok: false, message: UNREACHABLE };
        }
      },
      async verifyCode(input, code) {
        const email = normalizeEmail(input);
        const token = code.trim();
        if (!email || !/^\d{6}$/.test(token)) {
          return { ok: false, message: 'Enter the 6-digit code from the email.' };
        }
        try {
          const { error } = await auth.verifyOtp({ email, token, type: 'email' });
          if (!error) return { ok: true };
          return {
            ok: false,
            message: error.status ? 'That code is incorrect or has expired.' : UNREACHABLE,
          };
        } catch {
          return { ok: false, message: UNREACHABLE };
        }
      },
      async signOut() {
        // scope 'local' clears this device's session even when offline.
        await auth.signOut({ scope: 'local' });
      },
    }),
    [state],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}
```

- [ ] **Step 8: Implement the bridge, form, and screens**

`apps/mobile/src/db/DatabaseSessionBridge.tsx`:

```tsx
import { usePowerSync } from '@powersync/react';
import { useEffect, useRef } from 'react';
import { useSession } from '../session/SessionProvider';

/**
 * Keeps the local database in step with the session. Signed out: wipe it, so
 * the next user on this browser cannot see the previous household's data.
 */
export function DatabaseSessionBridge() {
  const db = usePowerSync();
  const { state } = useSession();
  const status = state.status;
  // Serialise transitions so a wipe always finishes before the next step.
  const queue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    if (status !== 'signedOut') return;
    queue.current = queue.current
      .then(() => db.disconnectAndClear())
      .catch((error: unknown) => console.error('Local database wipe failed', error));
  }, [db, status]);

  return null;
}
```

`apps/mobile/src/components/AddRecipeForm.tsx`:

```tsx
import { usePowerSync } from '@powersync/react';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { ZodError } from 'zod';
import { createRecipe } from '../recipes/repository';
import type { Claims } from '../session/claims';

export function AddRecipeForm({ claims }: { claims: Claims }) {
  const db = usePowerSync();
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return; // a double tap must not create two recipes
    setBusy(true);
    setMessage(null);
    try {
      await createRecipe(db, claims, title);
      setTitle('');
    } catch (error) {
      setMessage(
        error instanceof ZodError
          ? (error.issues[0]?.message ?? 'That title is not valid.')
          : 'Could not save the recipe. Try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: 8 }}>
      <TextInput
        aria-label="Recipe title"
        value={title}
        onChangeText={setTitle}
        onSubmitEditing={submit}
        placeholder="Recipe title"
        style={{ borderWidth: 1, borderColor: '#888', borderRadius: 6, padding: 10, fontSize: 16 }}
      />
      {message ? (
        <Text role="alert" style={{ color: '#b00020' }}>
          {message}
        </Text>
      ) : null}
      <Pressable
        role="button"
        aria-disabled={busy}
        onPress={submit}
        style={{ backgroundColor: '#1a5d3a', borderRadius: 6, padding: 12 }}
      >
        <Text style={{ color: '#fff', fontSize: 16, textAlign: 'center' }}>Add recipe</Text>
      </Pressable>
    </View>
  );
}
```

Add zod to the app so `ZodError` resolves: `pnpm --filter mobile add zod`.

`apps/mobile/src/screens/SignInScreen.tsx`:

```tsx
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useSession } from '../session/SessionProvider';

const input = {
  borderWidth: 1,
  borderColor: '#888',
  borderRadius: 6,
  padding: 10,
  fontSize: 16,
} as const;
const button = { backgroundColor: '#1a5d3a', borderRadius: 6, padding: 12 } as const;
const buttonText = { color: '#fff', fontSize: 16, textAlign: 'center' } as const;

export function SignInScreen() {
  const { requestCode, verifyCode } = useSession();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<{ ok: true } | { ok: false; message: string }>) {
    if (busy) return false;
    setBusy(true);
    setMessage(null);
    const result = await action();
    setBusy(false);
    if (!result.ok) setMessage(result.message);
    return result.ok;
  }

  async function sendCode() {
    if (await run(() => requestCode(email))) setStep('code');
  }

  async function submitCode() {
    // On success the session changes and the route redirects to the list.
    await run(() => verifyCode(email, code));
  }

  return (
    <View style={{ padding: 16, gap: 12, maxWidth: 480 }}>
      <Text role="heading" aria-level={1} style={{ fontSize: 24, fontWeight: '600' }}>
        Sign in
      </Text>
      {step === 'email' ? (
        <>
          <TextInput
            aria-label="Email"
            value={email}
            onChangeText={setEmail}
            onSubmitEditing={sendCode}
            placeholder="you@example.com"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            style={input}
          />
          <Pressable role="button" aria-disabled={busy} onPress={sendCode} style={button}>
            <Text style={buttonText}>Send code</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text>We sent a 6-digit code to {email.trim().toLowerCase()}.</Text>
          <TextInput
            aria-label="Code"
            value={code}
            onChangeText={setCode}
            onSubmitEditing={submitCode}
            placeholder="123456"
            autoComplete="one-time-code"
            keyboardType="number-pad"
            style={input}
          />
          <Pressable role="button" aria-disabled={busy} onPress={submitCode} style={button}>
            <Text style={buttonText}>Sign in</Text>
          </Pressable>
          <Pressable
            role="button"
            onPress={() => {
              setStep('email');
              setCode('');
              setMessage(null);
            }}
          >
            <Text style={{ textDecorationLine: 'underline' }}>Use a different email</Text>
          </Pressable>
        </>
      )}
      {message ? (
        <Text role="alert" style={{ color: '#b00020' }}>
          {message}
        </Text>
      ) : null}
    </View>
  );
}
```

`apps/mobile/src/screens/RecipeListScreen.tsx`:

```tsx
import { FlatList, Pressable, Text, View } from 'react-native';
import { AddRecipeForm } from '../components/AddRecipeForm';
import { StatusLine } from '../components/StatusLine';
import { useRecipes } from '../recipes/useRecipes';
import { canWrite, type Claims } from '../session/claims';
import { useSession } from '../session/SessionProvider';

export function RecipeListScreen({ claims }: { claims: Claims | null }) {
  const { signOut } = useSession();
  const { data: recipes } = useRecipes();

  return (
    <View style={{ padding: 16, gap: 12, maxWidth: 640 }}>
      <Text role="heading" aria-level={1} style={{ fontSize: 24, fontWeight: '600' }}>
        Recipes
      </Text>
      <StatusLine />
      {claims === null ? (
        <Text role="alert">
          Your account is not linked to a household. Sign out and back in; if this continues,
          contact your household admin.
        </Text>
      ) : (
        <>
          {/* Viewers cannot write: RLS refuses it, and the form is not rendered. */}
          {canWrite(claims.role) ? <AddRecipeForm claims={claims} /> : null}
          <FlatList
            data={recipes}
            keyExtractor={(recipe) => recipe.id}
            renderItem={({ item }) => (
              <Text style={{ fontSize: 18, paddingVertical: 8 }}>{item.title}</Text>
            )}
            ListEmptyComponent={<Text>No recipes yet</Text>}
          />
        </>
      )}
      <Pressable role="button" onPress={() => void signOut()}>
        <Text style={{ textDecorationLine: 'underline' }}>Sign out</Text>
      </Pressable>
    </View>
  );
}
```

`apps/mobile/app/_layout.tsx` (replace):

```tsx
import { Slot } from 'expo-router';
import { DatabaseProvider } from '../src/db/DatabaseProvider';
import { DatabaseSessionBridge } from '../src/db/DatabaseSessionBridge';
import { SessionProvider } from '../src/session/SessionProvider';

export default function RootLayout() {
  return (
    <SessionProvider>
      <DatabaseProvider>
        <DatabaseSessionBridge />
        <Slot />
      </DatabaseProvider>
    </SessionProvider>
  );
}
```

`apps/mobile/app/index.tsx` (replace):

```tsx
import { Redirect } from 'expo-router';
import { RecipeListScreen } from '../src/screens/RecipeListScreen';
import { useSession } from '../src/session/SessionProvider';

export default function Home() {
  const { state } = useSession();
  if (state.status === 'loading') return null;
  if (state.status === 'signedOut') return <Redirect href="/sign-in" />;
  return <RecipeListScreen claims={state.claims} />;
}
```

`apps/mobile/app/sign-in.tsx`:

```tsx
import { Redirect } from 'expo-router';
import { SignInScreen } from '../src/screens/SignInScreen';
import { useSession } from '../src/session/SessionProvider';

export default function SignIn() {
  const { state } = useSession();
  if (state.status === 'loading') return null;
  if (state.status === 'signedIn') return <Redirect href="/" />;
  return <SignInScreen />;
}
```

- [ ] **Step 9: Run the end-to-end tests and confirm they pass**

Run: `pnpm test:e2e`
Expected: the proxy image rebuilds with the new app code, then PASS, all tests in `auth.spec.ts` and `recipes.spec.ts`.

| Symptom | Fix |
|---|---|
| The sign-in request fails in the browser console with a URL like `/auth/otp` returning `404` or `502` | `curl -i http://localhost:8080/auth/health` must be `200`; if not, check the `auth` container and the `/auth/*` route in `deploy/Caddyfile`. |
| `AuthClient` is not exported, or its options differ | The installed `@supabase/auth-js` `.d.ts` is the authority (it also exports the same class as `GoTrueClient`). Keep the four option values. |
| The session is lost on reload | The client must persist to `localStorage`: confirm `persistSession: true` and that the page is served from `localhost` or HTTPS. |
| `expo export` fails on `window` in `config.ts` | The build is rendering in Node; the `typeof window === 'undefined'` guard must be the first use of `window`. |

- [ ] **Step 10: Run all checks and commit**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: clean.

```bash
git add -A
git commit -m "feat(app): email-code sign-in and local recipe list (FR-1, FR-2, FR-28)"
```

---

### Task 7: Sync — PowerSync service, connector, and the acceptance tests (complete)

**Files:**
- Create: `powersync/service.yaml`, `powersync/sync-config.yaml`
- Create: `apps/mobile/src/sync/upload.ts`, `apps/mobile/src/sync/connector.ts`
- Modify: `docker-compose.yml` (add `sync`), `apps/mobile/src/db/DatabaseSessionBridge.tsx`
- Test: `apps/mobile/src/sync/upload.test.ts`, `e2e/sync.spec.ts`
- Modify: `e2e/recipes.spec.ts` (viewer test)

**Interfaces:**
- Consumes: `RECIPE_CLIENT_FIELDS` from `@recipe-app/domain`; `auth`, `config`, `useSession` from Task 6; the `/api/upload` contract from Task 5; publication `powersync`, roles `powersync_repl` and `powersync_storage`, and database `powersync_storage` from Tasks 3 and 4; the `/sync/*` proxy route from Task 3
- Produces:
  - The `sync` service in Compose, reachable through the proxy at `http://localhost:8080/sync`, liveness at `/sync/probes/liveness`
  - `type UploadOp = { op: 'put' | 'patch' | 'delete'; table: string; id: string; data?: Record<string, unknown> }`
  - `toUploadOps(entries: CrudLike[]): UploadOp[]` where `CrudLike = { op: string; table: string; id: string; opData?: Record<string, unknown> }`
  - `sendOps(ops, deps): Promise<SendResult>` where `deps = { fetch: typeof fetch; url: string; token: string }` and `SendResult = { outcome: 'done'; rejected: { id: string; reason: string }[] } | { outcome: 'retry' } | { outcome: 'reauth' }`
  - `createConnector(): PowerSyncBackendConnector`

- [ ] **Step 1: Write the failing unit tests for the upload logic**

`apps/mobile/src/sync/upload.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { sendOps, toUploadOps, type UploadOp } from './upload';

describe('toUploadOps', () => {
  it('maps a PUT and keeps only client fields', () => {
    expect(
      toUploadOps([
        {
          op: 'PUT',
          table: 'recipes',
          id: 'r1',
          opData: {
            household_id: 'h1',
            title: 'Soup',
            created_at: null,
            updated_at: null,
            updated_by: null,
          },
        },
      ]),
    ).toEqual([
      { op: 'put', table: 'recipes', id: 'r1', data: { household_id: 'h1', title: 'Soup' } },
    ]);
  });

  it('maps a PATCH', () => {
    expect(
      toUploadOps([{ op: 'PATCH', table: 'recipes', id: 'r1', opData: { title: 'Stew' } }]),
    ).toEqual([{ op: 'patch', table: 'recipes', id: 'r1', data: { title: 'Stew' } }]);
  });

  it('drops a PATCH that only touched server-owned fields', () => {
    expect(
      toUploadOps([{ op: 'PATCH', table: 'recipes', id: 'r1', opData: { updated_at: 'x' } }]),
    ).toEqual([]);
  });

  it('passes a DELETE through so the server can refuse it', () => {
    expect(toUploadOps([{ op: 'DELETE', table: 'recipes', id: 'r1' }])).toEqual([
      { op: 'delete', table: 'recipes', id: 'r1' },
    ]);
  });

  it('sends no data for a table it does not know', () => {
    expect(
      toUploadOps([{ op: 'PUT', table: 'mystery', id: 'x', opData: { secret: 1 } }]),
    ).toEqual([{ op: 'put', table: 'mystery', id: 'x', data: {} }]);
  });
});

describe('sendOps', () => {
  const ops: UploadOp[] = [
    { op: 'put', table: 'recipes', id: 'r1', data: { household_id: 'h1', title: 'Soup' } },
    { op: 'put', table: 'recipes', id: 'r2', data: { household_id: 'h1', title: '' } },
  ];
  const deps = (fetchImpl: typeof fetch) => ({
    fetch: fetchImpl,
    url: 'http://api.test/api/upload',
    token: 'jwt',
  });
  const respond = (status: number, body: unknown = {}) =>
    vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body), { status }));

  it('posts the batch with the user token', async () => {
    const fetchImpl = respond(200, { results: [] });
    await sendOps(ops, deps(fetchImpl));
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('http://api.test/api/upload');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer jwt');
    expect(JSON.parse(String(init?.body))).toEqual({ ops });
  });

  it('reports rejected ops when the batch is done', async () => {
    const fetchImpl = respond(200, {
      results: [
        { id: 'r1', status: 'applied' },
        { id: 'r2', status: 'rejected', reason: 'invalid' },
      ],
    });
    expect(await sendOps(ops, deps(fetchImpl))).toEqual({
      outcome: 'done',
      rejected: [{ id: 'r2', reason: 'invalid' }],
    });
  });

  it('asks for a retry on a server error', async () => {
    expect(await sendOps(ops, deps(respond(500)))).toEqual({ outcome: 'retry' });
    expect(await sendOps(ops, deps(respond(503)))).toEqual({ outcome: 'retry' });
  });

  it('asks for a retry when the network is down', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await sendOps(ops, deps(fetchImpl))).toEqual({ outcome: 'retry' });
  });

  it('asks for re-authentication on 401', async () => {
    expect(await sendOps(ops, deps(respond(401)))).toEqual({ outcome: 'reauth' });
  });

  it('drops the whole batch on any other 4xx so the queue is not blocked', async () => {
    expect(await sendOps(ops, deps(respond(400, { error: 'invalid_body' })))).toEqual({
      outcome: 'done',
      rejected: [
        { id: 'r1', reason: 'http_400' },
        { id: 'r2', reason: 'http_400' },
      ],
    });
    expect(await sendOps(ops, deps(respond(413, { error: 'too_large' })))).toEqual({
      outcome: 'done',
      rejected: [
        { id: 'r1', reason: 'http_413' },
        { id: 'r2', reason: 'http_413' },
      ],
    });
  });

  it('asks for a retry when the proxy answers for a stopped API', async () => {
    expect(await sendOps(ops, deps(respond(502)))).toEqual({ outcome: 'retry' });
  });

  it('asks for a retry when a 200 response is not the expected shape', async () => {
    expect(await sendOps(ops, deps(respond(200, { unexpected: true })))).toEqual({
      outcome: 'retry',
    });
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm test`
Expected: FAIL, `./upload` does not exist.

- [ ] **Step 3: Implement the upload logic**

`apps/mobile/src/sync/upload.ts`:

```ts
import { RECIPE_CLIENT_FIELDS } from '@recipe-app/domain';

export type UploadOp = {
  op: 'put' | 'patch' | 'delete';
  table: string;
  id: string;
  data?: Record<string, unknown>;
};

/** The parts of a PowerSync CRUD entry this module needs. */
export type CrudLike = {
  op: string;
  table: string;
  id: string;
  opData?: Record<string, unknown>;
};

export type Rejection = { id: string; reason: string };

export type SendResult =
  | { outcome: 'done'; rejected: Rejection[] }
  | { outcome: 'retry' }
  | { outcome: 'reauth' };

export type SendDeps = { fetch: typeof fetch; url: string; token: string };

/** Fields the client may upload, per table. Server-owned fields never leave the device. */
const CLIENT_FIELDS: Record<string, readonly string[]> = {
  recipes: RECIPE_CLIENT_FIELDS,
};

function pickClientFields(table: string, data: Record<string, unknown> = {}) {
  const allowed = CLIENT_FIELDS[table] ?? [];
  return Object.fromEntries(
    Object.entries(data).filter(([key, value]) => allowed.includes(key) && value !== undefined),
  );
}

export function toUploadOps(entries: CrudLike[]): UploadOp[] {
  const ops: UploadOp[] = [];
  for (const entry of entries) {
    if (entry.op === 'DELETE') {
      ops.push({ op: 'delete', table: entry.table, id: entry.id });
      continue;
    }
    const data = pickClientFields(entry.table, entry.opData);
    if (entry.op === 'PUT') {
      // A new row: null columns carry no information, so leave them out.
      const present = Object.fromEntries(Object.entries(data).filter(([, value]) => value !== null));
      ops.push({ op: 'put', table: entry.table, id: entry.id, data: present });
    } else if (Object.keys(data).length > 0) {
      ops.push({ op: 'patch', table: entry.table, id: entry.id, data });
    }
  }
  return ops;
}

function isResults(body: unknown): body is { results: { id: string; status: string; reason?: string }[] } {
  return (
    typeof body === 'object' &&
    body !== null &&
    Array.isArray((body as { results?: unknown }).results)
  );
}

/**
 * Sends one batch to /upload and says what the caller should do next.
 * - done: finished; drop the batch (rejected ops are listed for logging)
 * - retry: temporary failure; keep the batch queued
 * - reauth: the token was refused; refresh the session, then retry
 */
export async function sendOps(ops: UploadOp[], deps: SendDeps): Promise<SendResult> {
  let response: Response;
  try {
    response = await deps.fetch(deps.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${deps.token}`,
      },
      body: JSON.stringify({ ops }),
    });
  } catch {
    return { outcome: 'retry' };
  }

  if (response.status === 401) return { outcome: 'reauth' };
  if (response.status >= 500) return { outcome: 'retry' };
  if (!response.ok) {
    // The server will never accept this batch. Dropping it keeps one bad
    // batch from blocking every later change.
    const reason = `http_${response.status}`;
    return { outcome: 'done', rejected: ops.map((op) => ({ id: op.id, reason })) };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { outcome: 'retry' };
  }
  if (!isResults(body)) return { outcome: 'retry' };

  const rejected = body.results
    .filter((result) => result.status === 'rejected')
    .map((result) => ({ id: result.id, reason: result.reason ?? 'unknown' }));
  return { outcome: 'done', rejected };
}
```

- [ ] **Step 4: Run the unit tests and confirm they pass**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 5: Add the PowerSync service**

`powersync/sync-config.yaml`:

```yaml
# What each device receives. MIRRORS the RLS select policy on public.recipes
# (household_id = auth_household_id()). Change one, change the other.
config:
  edition: 3

streams:
  household_recipes:
    auto_subscribe: true
    query: >-
      SELECT id, household_id, title, created_at, updated_at, updated_by, deleted_at
      FROM recipes
      WHERE household_id = auth.parameter('household_id')
```

`powersync/service.yaml`:

```yaml
# Connection strings come from the container's environment (docker-compose.yml).
replication:
  connections:
    - type: postgresql
      uri: !env PS_SOURCE_URI
      sslmode: disable

# Buckets are kept in a second database on the same Postgres server, so the
# stack needs no MongoDB. Supported on Postgres 14 and newer.
storage:
  type: postgresql
  uri: !env PS_STORAGE_URI
  sslmode: disable

port: 8080

sync_config:
  path: sync-config.yaml

client_auth:
  # The auth container's published key set, reached over the Compose network.
  jwks_uri: http://auth:9999/.well-known/jwks.json
  # The key set is on a private address by design.
  block_local_jwks: false
  audience:
    - authenticated
```

Only if Task 3's gate ended on the shared-secret fallback, replace the `client_auth` block with:

```yaml
client_auth:
  jwks:
    keys:
      - kty: oct
        alg: HS256
        k: !env PS_JWT_SECRET_B64URL
  audience:
    - authenticated
```

and give the `sync` service `PS_JWT_SECRET_B64URL`, set in `.env` to the output of `node -e "console.log(Buffer.from(process.argv[1]).toString('base64url'))" "$JWT_SECRET"`.

In `docker-compose.yml`, add this service after `api`:

```yaml
  sync:
    image: journeyapps/powersync-service:<pin>
    restart: unless-stopped
    command: ['start', '-r', 'unified']
    depends_on:
      db:
        condition: service_healthy
      auth:
        condition: service_healthy
      # The migration creates the publication the service replicates from.
      migrate:
        condition: service_completed_successfully
    volumes:
      - ./powersync:/config:ro
    environment:
      POWERSYNC_CONFIG_PATH: /config/service.yaml
      PS_SOURCE_URI: postgresql://powersync_repl:${POWERSYNC_REPL_PASSWORD}@db:5432/app
      PS_STORAGE_URI: postgresql://powersync_storage:${POWERSYNC_STORAGE_PASSWORD}@db:5432/powersync_storage
    healthcheck:
      test:
        - CMD
        - node
        - -e
        - "fetch('http://127.0.0.1:8080/probes/liveness').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
      interval: 2s
      timeout: 5s
      retries: 60
```

Replace `<pin>` with the image's current release tag.

- [ ] **Step 6: Start the service and check it replicates**

Run: `pnpm db:reset && docker compose logs sync --tail 50`
Expected: every service healthy, and the `sync` log shows replication starting with no repeating errors. Then:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/sync/probes/liveness
```

Expected: `200` (the service answering through the proxy).

| Log symptom | Fix |
|---|---|
| Config error on `!env`, `storage`, `sync_config`, or `block_local_jwks` | The pinned service version names that setting differently. Read the error and the self-hosted configuration reference (`docs.powersync.com/configuration/powersync-service/self-hosted-instances`); keep the meaning. |
| Cannot connect to Postgres, or `password authentication failed` | The database volume predates the current `.env`: `pnpm db:reset`. |
| Publication `powersync` not found | `migrate` did not run: `docker compose --profile dev ps -a` must show it exited 0. |
| `permission denied for table recipes` during the snapshot | The two `grant ... to powersync_repl` lines at the end of the migration did not apply. |
| Storage errors naming the `powersync` schema | `powersync_storage` must own its database; check `db/init/00-roles.sh`, then `pnpm db:reset`. |
| The service refuses to fetch the key set | Confirm `block_local_jwks: false` and that `docker compose exec sync node -e "fetch('http://auth:9999/.well-known/jwks.json').then(r=>r.text()).then(console.log)"` prints keys. |

- [ ] **Step 7: Write the failing acceptance tests**

`e2e/sync.spec.ts`:

```ts
import { expect, test, type Browser, type Page } from '@playwright/test';
import { addRecipe, SEED, signIn } from './helpers';

const NFR5_MS = 10_000; // NFR-5: visible on other devices within ~10 s

async function session(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, email);
  return page;
}

function unique(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

test('a signed-in session goes online and receives its household recipes', async ({ browser }) => {
  const page = await session(browser, SEED.memberA);
  await expect(page.getByText('Seed pancakes', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/^Online · /)).toBeVisible();
  await expect(page.getByText('Seed curry')).toHaveCount(0);
});

test('a recipe added in one session appears in the same household within 10 seconds and never in another', async ({
  browser,
}) => {
  const member = await session(browser, SEED.memberA);
  const admin = await session(browser, SEED.adminA);
  const outsider = await session(browser, SEED.adminB);
  await expect(admin.getByText('Seed pancakes', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(outsider.getByText('Seed curry', { exact: true })).toBeVisible({ timeout: 30_000 });

  const title = unique('Shared soup');
  await addRecipe(member, title);

  await expect(admin.getByText(title, { exact: true })).toBeVisible({ timeout: NFR5_MS });
  await expect(member.getByText('Online · 0 unsynced')).toBeVisible({ timeout: NFR5_MS });

  // The other household has had the same 10 seconds and more to receive it.
  await outsider.waitForTimeout(3_000);
  await expect(outsider.getByText(title)).toHaveCount(0);
});

test('a recipe added offline is queued and syncs when the network returns', async ({ browser }) => {
  const member = await session(browser, SEED.memberA);
  const admin = await session(browser, SEED.adminA);
  await expect(member.getByText('Seed pancakes', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(admin.getByText('Seed pancakes', { exact: true })).toBeVisible({ timeout: 30_000 });

  await member.context().setOffline(true);
  const title = unique('Offline stew');
  await addRecipe(member, title);
  await expect(member.getByText('Offline · 1 unsynced')).toBeVisible({ timeout: 30_000 });
  await admin.waitForTimeout(3_000);
  await expect(admin.getByText(title)).toHaveCount(0);

  await member.context().setOffline(false);
  // Reconnection backs off, so allow longer than the online target.
  await expect(admin.getByText(title, { exact: true })).toBeVisible({ timeout: 45_000 });
  await expect(member.getByText('Online · 0 unsynced')).toBeVisible({ timeout: 45_000 });
});
```

In `e2e/recipes.spec.ts`, replace the viewer test with:

```ts
test('a viewer sees the list but no add form', async ({ page }) => {
  await signIn(page, SEED.viewerA);
  await expect(page.getByText('Seed pancakes', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByLabel('Recipe title')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add recipe' })).toHaveCount(0);
});
```

- [ ] **Step 8: Run them and confirm they fail**

Run: `pnpm test:e2e e2e/sync.spec.ts`
Expected: FAIL, `Seed pancakes` never appears (the app does not connect to PowerSync yet).

- [ ] **Step 9: Implement the connector and connect on sign-in**

`apps/mobile/src/sync/connector.ts`:

```ts
import type { PowerSyncBackendConnector } from '@powersync/web';
import { config } from '../config';
import { auth } from '../session/auth';
import { sendOps, toUploadOps } from './upload';

const UPLOAD_URL = `${config.apiUrl}/upload`;

export function createConnector(): PowerSyncBackendConnector {
  return {
    async fetchCredentials() {
      const { data } = await auth.getSession();
      if (!data.session) return null;
      return { endpoint: config.powersyncUrl, token: data.session.access_token };
    },

    // PowerSync calls this whenever local writes are queued, and retries
    // with backoff when it throws.
    async uploadData(database) {
      const transaction = await database.getNextCrudTransaction();
      if (!transaction) return;

      const { data } = await auth.getSession();
      if (!data.session) throw new Error('Not signed in; upload will retry');

      const ops = toUploadOps(transaction.crud);
      if (ops.length > 0) {
        const result = await sendOps(ops, {
          fetch: (input, init) => fetch(input, init),
          url: UPLOAD_URL,
          token: data.session.access_token,
        });

        if (result.outcome === 'retry') throw new Error('Upload failed; will retry');
        if (result.outcome === 'reauth') {
          const { error } = await auth.refreshSession();
          if (error) await auth.signOut({ scope: 'local' });
          throw new Error('Session was refused; will retry after refresh');
        }
        for (const rejection of result.rejected) {
          // Dropped on purpose: the next sync restores the server's version.
          console.warn(`Upload rejected for ${rejection.id}: ${rejection.reason}`);
        }
      }

      await transaction.complete();
    },
  };
}
```

`apps/mobile/src/db/DatabaseSessionBridge.tsx` (replace):

```tsx
import { usePowerSync } from '@powersync/react';
import { useEffect, useRef } from 'react';
import { useSession } from '../session/SessionProvider';
import { createConnector } from '../sync/connector';

const connector = createConnector();

/**
 * Keeps the local database in step with the session.
 * - Signed in with a household: connect, so sync and uploads run.
 * - Signed out: disconnect and wipe, so the next user on this browser cannot
 *   see the previous household's data.
 */
export function DatabaseSessionBridge() {
  const db = usePowerSync();
  const { state } = useSession();
  const status = state.status;
  const userId = state.status === 'signedIn' ? state.userId : null;
  const hasHousehold = state.status === 'signedIn' && state.claims !== null;
  // Serialise transitions so a wipe always finishes before the next connect.
  const queue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    if (status === 'loading') return;
    queue.current = queue.current
      .then(async () => {
        if (status === 'signedOut') await db.disconnectAndClear();
        else if (hasHousehold) await db.connect(connector);
      })
      .catch((error: unknown) => console.error('Database session change failed', error));
  }, [db, status, userId, hasHousehold]);

  return null;
}
```

- [ ] **Step 10: Run the acceptance tests and confirm they pass**

Run: `pnpm db:reset && pnpm test:e2e`
Expected: PASS, every spec. (`test:e2e` rebuilds the proxy image, so the new app code is what gets served.)

| Symptom | Fix |
|---|---|
| Stays `Offline`; `sync` log shows `PSYNC_S2101` (no matching key) | The service is not verifying against GoTrue's key set. Re-check the `client_auth` block against how Task 3's gate ended. |
| `sync` log shows `PSYNC_S2105` (missing or wrong `aud`) | Confirm `audience: [authenticated]`. |
| Stays `Offline`; browser console shows a failed request to `/sync/...` | Check the proxy route: `curl -i http://localhost:8080/sync/probes/liveness` must be `200`. For a stream that connects then stalls, confirm `flush_interval -1` in `deploy/Caddyfile`. |
| Online, but no rows arrive | The client must support Sync Streams. Check the installed `@powersync/web` docs for a connect option selecting the newer sync client and pass it in `db.connect(connector, { ... })`. |
| Rows from the other household appear | Stop. This is an isolation failure; fix `sync-config.yaml` before anything else. |
| The offline test's `1 unsynced` never shows | Apply the `ps_crud` fallback from Task 2 Step 9. |
| The offline test shows `Online · 1 unsynced` and never `Offline` | An open sync stream (`POST /sync/stream`) does not fail when the browser goes offline, so PowerSync stays connected. Resolved (owner's choice): `DatabaseSessionBridge` disconnects on the browser's `offline` event and reconnects on `online` (`src/db/useNetworkOnline.ts`). |
| `No sign-in code arrived` for a seed user in a later spec | The same address was asked for a code under `AUTH_EMAIL_MAX_FREQUENCY` (1s) after the previous test. `e2e/helpers.ts` spaces requests per address. |
| Uploads never leave the queue; `api` log shows `request_failed` | Read the logged message; the request reached the API and failed there. |

- [ ] **Step 11: Run every suite and commit**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:stack && pnpm test:rls && pnpm test:api && pnpm test:e2e`
Expected: clean.

```bash
git add -A
git commit -m "feat(sync): PowerSync service container, upload connector, and acceptance tests (FR-28, FR-30, NFR-1, NFR-5)"
```

---

### Task 8: CI and documentation (Steps 1 to 5 complete; push and pull request await the owner)

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `docs/adr/0007-web-first-delivery-via-expo-web.md`, `docs/adr/0008-self-hosted-containerized-backend.md`
- Modify: `docs/adr/README.md`, `docs/adr/0002-cross-platform-mobile-with-expo.md`, `docs/adr/0003-supabase-as-backend.md`, `docs/adr/0004-offline-first-sync-with-powersync.md`, `docs/adr/0006-household-tenancy-with-rls.md`, `docs/SPEC.md`, `ARCHITECTURE.md`, `CLAUDE.md`, `README.md`

**Interfaces:**
- Consumes: every script defined in Tasks 1 to 7.

- [ ] **Step 1: Add the CI workflow**

`.github/workflows/ci.yml`:

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  static:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test

  backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      # Builds every image, so a broken Dockerfile fails the pull request.
      - name: Build and start the stack
        run: pnpm dev:backend
      - run: pnpm db:seed
      - run: pnpm test:stack
      - run: pnpm test:rls
      - run: pnpm test:api
      - name: Stack logs
        if: failure()
        run: docker compose --profile dev logs --tail 200

  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Build and start the stack
        run: pnpm dev:backend
      - run: pnpm db:seed
      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm test:e2e
      - name: Stack logs
        if: failure()
        run: docker compose --profile dev logs --tail 200
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: |
            playwright-report
            test-results
```

`pnpm/action-setup` reads the pnpm version from the `packageManager` field written in Task 1. `pnpm dev:backend` runs `scripts/init-env.mjs` first, so CI needs no stored secrets.

- [ ] **Step 2: Write ADR-0007**

`docs/adr/0007-web-first-delivery-via-expo-web.md`:

```markdown
# 0007. Web-first delivery via Expo web

- **Status:** Accepted
- **Date:** 2026-10-12
- **Amends:** ADR-0002

## Context
ADR-0002 chose Expo for iOS and Android. Building for a real iPhone needs a paid Apple Developer membership, which the project does not have yet, and iOS builds cannot be made from the Windows/WSL development machine. The offline-first and tenancy architecture (FR-28, FR-30, NFR-1) still needs to be proven end to end now.

## Decision
Deliver **web first from the same Expo codebase**. Expo Router and React Native Web build the app as a single-page web app; the on-device database is SQLite in the browser through the PowerSync web SDK. Native iOS and Android become additional build targets later, not a rewrite. The local database sits behind one platform-specific module (`apps/mobile/src/db/database.web.ts`, with a native counterpart to come).

Sign-in is an **email one-time code**. A magic link opens in Safari, not in the home-screen app, and the two do not share a session on iOS.

Sync is defined with PowerSync **Sync Streams**.

New dependencies: `@powersync/web`, `@powersync/react`, Vitest, Playwright.

## Alternatives considered
- **Stay native, enrol in the Apple Developer Program now:** keeps the spec as written; costs $99 a year and blocks all device testing until approval.
- **Drop Expo for a plain web stack (Vite + React):** slightly simpler web tooling, but a later native app would mean rebuilding the UI. Kept as the fallback if PowerSync's web SDK had not worked under Expo.
- **Android only:** buildable locally, but the product owner's device is an iPhone.

## Consequences
- No store accounts, native builds, or dev client are needed to develop and test.
- FR-8's share-sheet import (sharing a URL into the app) is not possible in an iOS web app. Paste-a-link still works; share-sheet import becomes native-only.
- NFR-12 (store compliance, Sign in with Apple) applies only once a native build exists.
- Users should add the app to the home screen: Safari can clear storage for sites that go unused.
- The app must be served over HTTPS (or `localhost`) for browser storage to work, so trying it on a phone needs the hosted environment. That, a service worker for cold-start offline, and Safari-specific storage options are a follow-up sub-project.
- A role change takes effect only when the access token next refreshes (up to an hour). The roles and invites sub-project must handle this.
```

- [ ] **Step 3: Write ADR-0008**

`docs/adr/0008-self-hosted-containerized-backend.md`:

```markdown
# 0008. Self-hosted, containerized backend

- **Status:** Accepted
- **Date:** 2026-10-13
- **Supersedes:** ADR-0003
- **Amends:** ADR-0004 (the sync service is self-hosted, not managed), ADR-0006 (claim names)

## Context
ADR-0003 chose the Supabase platform and ADR-0004 assumed PowerSync Cloud. The owner rejected both on recurring cost and wants production containerized and portable: this app is also a proving ground for a later app that will be hosted somewhere other than the owner's own machine. Load is family-scale.

## Decision
Run the backend as **our own containers in one Docker Compose file**, self-hosted on the owner's hardware. The same file runs locally and in production; only `.env` differs.

| Container | Software |
|---|---|
| `proxy` | Caddy: single entry point, serves the built web app, routes `/auth`, `/api`, `/sync` |
| `api` | Our Node/TypeScript service (Hono, `postgres` driver, `jose`), bundled with esbuild |
| `auth` | GoTrue, standalone (the open-source auth server Supabase maintains) |
| `db` | Postgres 17 with RLS and logical replication |
| `migrate` | dbmate, one-shot, plain SQL migrations in `db/migrations/` |
| `sync` | PowerSync service, bucket storage in a second database on the same Postgres |
| `mail` | Mailpit, local development and tests only |

Tenant isolation without a platform: the API logs in as `api_login`, a role that owns nothing and cannot bypass RLS, and reaches the database only through `asUser`, which verifies the token and runs one transaction as the role `authenticated` with the verified claims set. Policies read those claims through `auth_user_id()`, `auth_household_id()`, and `auth_household_role()`. `powersync_repl` is the only non-superuser role that bypasses RLS; what it replicates is scoped by the sync config.

GoTrue signs tokens with an asymmetric key (ES256) and publishes the public half; `api` and `sync` verify against it and hold no signing secret.

The built web app calls same-origin relative paths, so no image contains a host name, key, or password.

## Alternatives considered
- **Supabase platform (ADR-0003):** least code, but a recurring fee, and the full self-hosted Supabase stack is far heavier than this app needs.
- **One GCP VM running the same Compose file:** datacentre uptime for roughly $13 to $25 a month. Kept as the fallback; moving is a database restore and a DNS change.
- **GCP managed services (Cloud Run, Cloud SQL, Cloud Storage):** managed backups and least operations, but the highest cost, a sync service that cannot scale to zero, and production no longer matching local.
- **Our own auth in the API:** fewest containers, but we would own security-sensitive code (code expiry, rate limiting, refresh) and Apple/Google sign-in later.
- **Keycloak or Zitadel:** vendor-neutral and reusable, but heavy for this app.
- **PostgREST in place of an API:** cannot validate with the shared zod schema, and import and AI need real code later.
- **Deno for the API:** a second runtime and an import-map workaround for the shared domain package.

## Consequences
- No platform fee and no accounts. The stack moves to another host by copying `.env` and the database.
- We own uptime, patching, and backups. NFR-8 (99.5%) and NFR-9 (daily backups with point-in-time recovery) are not met yet; the hosting sub-project must add off-site backups and decide how the server is reached from the internet.
- A real email provider is needed in production; GoTrue takes SMTP settings from `.env`.
- File storage for photos is undecided; it is chosen in the import sub-project.
- PowerSync's Postgres bucket storage is labelled Beta. Fallback: add a MongoDB container; only `powersync/service.yaml` and the Compose file change.
- `db/init/00-roles.sh` runs only when the database volume is first created. A later change to roles needs a migration or a manual statement on existing hosts.
- The custom role claim is `household_role`, not `role`: GoTrue uses `role` itself. This corrects ADR-0006's wording.
- New dependencies: GoTrue, `@supabase/auth-js`, Hono, `@hono/node-server`, `postgres`, `jose`, esbuild, dbmate, Caddy, Mailpit.
```

If Task 3's gate ended on the shared-secret fallback, replace the "GoTrue signs tokens with an asymmetric key" paragraph with one sentence saying tokens are signed with one HS256 secret shared by `auth`, `api`, and `sync` through `.env`, and why. If Task 7 needed MongoDB, change the `sync` row and the Beta bullet to say so.

- [ ] **Step 4: Update the existing documents**

`docs/adr/README.md`: add ADR-0007 and ADR-0008 to the index, in the same format as the existing entries.

`docs/adr/0002-cross-platform-mobile-with-expo.md`: change the status line to `- **Status:** Accepted, amended by 0007`.

`docs/adr/0003-supabase-as-backend.md`: change the status line to `- **Status:** Superseded by 0008`.

`docs/adr/0004-offline-first-sync-with-powersync.md`: change the status line to `- **Status:** Accepted, amended by 0008`; in the Decision paragraph replace `` our `/upload` Edge Function `` with `` our API's `/api/upload` endpoint ``; replace the Consequences bullet `Adds a second managed service (PowerSync) and its cost.` with `The PowerSync service runs as a container in our own stack (ADR-0008).`

`docs/adr/0006-household-tenancy-with-rls.md`: change the status line to `- **Status:** Accepted, amended by 0008`; in the Decision paragraph, replace `` `household_id = auth.jwt() ->> 'household_id'`; write policies additionally exclude `role = 'viewer'` `` with `` `household_id = auth_household_id()`; write policies additionally require `auth_household_role()` to be `admin` or `member` ``, and replace ``The JWT carries `household_id` and `role` as custom claims set at sign-in.`` with ``The JWT carries `household_id` and `household_role` as custom claims added by GoTrue's access-token hook (`role` is used by GoTrue itself).``

`docs/SPEC.md`:
- Bump the status line to `Draft v0.2`.
- §3, replace the Platforms line with: `**Platforms (v1):** web first, as an installable web app built with Expo; native iOS and Android later from the same codebase (ADR-0007). Desktop later.`
- FR-1 row: `Sign up / sign in with an email one-time code`.
- FR-8 row: `Import from URL via paste; via OS share sheet on native builds only (ADR-0007)`.
- NFR-12 row: prefix the requirement with `Native builds only:`.

`ARCHITECTURE.md`:
- Bump the status line to `Proposed v0.2` and the date to today.
- §0 drivers table, first row: Driver `Web first; iOS + Android later from one codebase`, Consequence `Cross-platform framework with a web target (ADR-0002, ADR-0007)`. Last row: Driver `Small team, family-scale load, lowest fixed cost, portable`, Consequence `Our own containers in one Compose stack, self-hosted (ADR-0008)`.
- §2, replace the container diagram's `System_Boundary` block with:

```
  System_Boundary(sys, "Recipe App") {
    Container(mobile, "Web App", "Expo / React Native Web, TypeScript", "UI, cook mode, local search, PDF generation, offline queue")
    ContainerDb(localDb, "On-device Database", "SQLite in the browser (via PowerSync web SDK)", "Household's recipes; full-text index; pending-upload queue")
    Container(proxy, "Proxy", "Caddy", "Single entry point; serves the built web app; routes /auth, /api, /sync")
    Container(syncSvc, "Sync Service", "PowerSync service (self-hosted container)", "Streams household-scoped changes between Postgres and devices")
    Container(api, "API", "Node / TypeScript (Hono)", "Upload of local writes now; import pipeline, AI calls, invites, share links later")
    Container(auth, "Auth", "GoTrue (self-hosted container)", "Sign-in (email one-time code); issues JWTs with household_id and household_role claims")
    ContainerDb(db, "Database", "PostgreSQL 17 with RLS", "System of record: households, users, recipes; also holds the sync service's storage database")
  }
```

  and replace the relationships below it with:

```
  Rel(user, mobile, "Uses")
  Rel(mobile, localDb, "Reads/writes (always local-first)")
  Rel(mobile, proxy, "All network traffic", "HTTPS")
  Rel(proxy, auth, "/auth")
  Rel(proxy, api, "/api")
  Rel(proxy, syncSvc, "/sync", "HTTP streaming / WebSocket")
  Rel(syncSvc, db, "Replicates household-scoped data", "Postgres logical replication")
  Rel(api, db, "Reads/writes as the user (RLS applies)")
  Rel(auth, db, "Users, sessions; reads memberships for claims")
  Rel(api, llm, "Parse / substitute (later)", "HTTPS")
  Rel(api, sites, "Fetch page HTML (later)", "HTTPS")
  Rel(auth, email, "Sign-in codes, invites", "SMTP")
```

  Object storage and the share landing page are removed from the diagram; add one sentence under it: `Object storage and the share landing page are not built yet; they are decided in the import and sharing sub-projects.`
- §2 responsibilities table: rename `Edge Functions API` to `API`, change its Notes to `Stateless; verifies the JWT, then runs every statement as the user through asUser`; Auth row Owns: `Identity; JWT custom claims household_id, household_role (added by an access-token hook)`; Cloud DB row renamed `Database`, Notes `Backups arrive with the hosting sub-project (NFR-9)`; add a `Proxy` row: Owns `TLS, routing, static web app`, Notes `Only container with a published port`; remove the Object Storage and Share Landing Page rows.
- §3b: rename the diagram and boundary to `API`; change `Function: /upload` to `Route: /api/upload`; leave the components that are not built yet, and add one sentence above the diagram: `Only the Auth Guard and Write Upload Handler exist after the walking skeleton.`
- §5, replace the deployment diagram's Supabase and PowerSync Cloud nodes with:

```
  Deployment_Node(host, "Owner's server", "Docker Compose, one stack") {
    Container(proxy, "proxy", "Caddy")
    Container(api, "api", "Node")
    Container(auth, "auth", "GoTrue")
    Container(sync, "sync", "PowerSync service")
    ContainerDb(db, "db", "PostgreSQL 17")
  }
```

  with relationships `Rel(mobile, proxy, "HTTPS")`, `Rel(proxy, api, "")`, `Rel(proxy, auth, "")`, `Rel(proxy, sync, "")`, `Rel(sync, db, "Logical replication")`, `Rel(api, db, "")`, `Rel(api, llm, "HTTPS")`. Replace the Environments paragraph with: `**Environments:** local (the Compose stack with the dev profile, which adds a mail catcher; Expo web dev server or the built app from the proxy). Production is the same Compose file on the owner's server with a different .env; it arrives with the hosting sub-project. A single cloud VM running the same file is the fallback (ADR-0008).`
- §6 conventions: the RLS bullet becomes ``RLS policy `household_id = auth_household_id()` ``.
- §7: Tenant isolation row: `RLS on every table; the API reaches the database only through asUser, as a role that cannot bypass RLS; sync config scoped by household_id; an automated suite tries cross-household reads and writes and checks the roles themselves`. Roles row: `` `household_role` claim in the JWT; RLS write policies require admin or member; UI hides edit affordances``. AI row: change the prompts path to `apps/api/src/llm/prompts/`. Secrets row: `The web app ships no keys. Database passwords, the token signing key, and the Claude API key live in .env on the server`. Backups row: `Off-site Postgres backups with point-in-time recovery, set up in the hosting sub-project; household JSON export`.
- §9: `Current: ADR-0001 through ADR-0008.`

`CLAUDE.md`:
- Stack section, replace the four bullets with:

```markdown
- `apps/mobile` — Expo / React Native Web (web first, ADR-0007), TypeScript, Expo Router, PowerSync web SDK (SQLite in the browser)
- `apps/api` — Node/TypeScript API (Hono). All database access goes through `asUser` in `src/db/asUser.ts`
- `db/` — SQL migrations (dbmate), first-boot role script, seed data
- `packages/domain` — shared TS: recipe schema (zod), scaling, unit conversion. Pure functions, no I/O.
- `docker-compose.yml` — the whole backend: Caddy proxy, API, GoTrue auth, Postgres, PowerSync (ADR-0008)
- AI: Claude API, called **only** from the API via `apps/api/src/llm/`
```

- Replace the Commands block and remove the "Scaffolding not yet created" line:

```bash
pnpm install                 # install workspace
pnpm dev:backend             # creates .env if missing; builds and starts the Compose stack
pnpm db:reset                # fresh database volume, migrations, and seed
pnpm dev:web                 # Expo web dev server at http://localhost:8081
pnpm test                    # unit tests
pnpm test:stack              # auth and token checks (needs dev:backend)
pnpm test:rls                # tenant isolation suite (needs dev:backend + seed)
pnpm test:api                # /api/upload tests (needs dev:backend + seed)
pnpm test:e2e                # Playwright against the built app at http://localhost:8080
pnpm lint && pnpm typecheck
```

- Rule 1, replace the last sentence (`Never use the service-role key ...`) with: `` The API connects only as `api_login` and only through `asUser`; no code path may use a role that owns tables or bypasses RLS. New tables must also be added to `apps/api/tests/rls/registry.ts`; the coverage guard fails otherwise. ``
- Rule 2, replace with: `**No secrets on device.** The web app ships no keys at all, only relative service paths. Database passwords, the signing key, and AI keys live in .env on the server.`
- Rule 6: append `` RLS lives in `db/migrations/`, sync config in `powersync/sync-config.yaml`. ``
- Conventions, Migrations bullet: `` Migrations: `db/migrations/<timestamp>_<verb>_<thing>.sql` with dbmate's `-- migrate:up` marker; never edit an applied migration. ``

`README.md`: add a "Getting started" section with the prerequisites (Node 22, Docker with Compose, `corepack enable`, 6 GB or more of memory available to Docker), the commands `pnpm install`, `pnpm dev:backend`, `pnpm db:seed`, then `http://localhost:8080`; the four seeded sign-in emails; and a note that sign-in codes arrive in the local mail catcher at `http://127.0.0.1:8025`.

- [ ] **Step 5: Verify everything from a clean state**

```bash
pnpm dev:backend:stop
docker compose --profile dev down -v
pnpm install --frozen-lockfile
pnpm db:reset
pnpm lint && pnpm typecheck && pnpm test && pnpm test:stack && pnpm test:rls && pnpm test:api && pnpm test:e2e
```

Expected: every command exits 0. This also proves acceptance criterion 7: from nothing but the checkout and a generated `.env`, one `docker compose --profile dev up -d --build --wait` (inside `pnpm dev:backend`) brings every service to healthy.

Then confirm no secret or host name is in the web bundle:

```bash
docker compose exec proxy sh -c 'grep -rlE "ANTHROPIC|POSTGRES_PASSWORD|API_LOGIN_PASSWORD|JWT_SECRET" /srv/web && echo LEAK || echo clean'
```

Expected: `clean`.

And confirm no application container can reach the database as a privileged role:

```bash
docker compose exec api sh -c 'env | grep -cE "POSTGRES_PASSWORD|APP_OWNER_PASSWORD|JWT_KEYS"'
```

Expected: `0`.

- [ ] **Step 6: Commit and open the pull request**

```bash
git add -A
git commit -m "docs: ADR-0007 web-first, ADR-0008 self-hosted containers; ci: static, backend, and e2e jobs (NFR-1)"
git push -u origin feat/walking-skeleton
```

Pushing and opening a pull request are outward-facing: confirm with the owner before running `git push`. After the first CI run, report each job's result. If `e2e` is slow or flaky, report that with the failing output; do not mark it optional.

---

## Spec coverage

| Spec section | Task |
|---|---|
| §2 Decisions: no Supabase platform, own hardware, portability, GoTrue, Node API, Postgres storage for sync | 3, 4, 5, 7, 8 (ADR-0008) |
| §3 Containers, startup order, configuration by `.env`, same-origin paths | 3 (`db`, `auth`, `proxy`, `mail`), 4 (`migrate`), 5 (`api`), 6 (web app in `proxy`), 7 (`sync`) |
| §3 Repo layout, tooling, commands, dev CORS | 1, 2, 3, 4, 5, 6 |
| §4 Tables, sign-up trigger, token hook, RLS, server-owned fields, seed | 4 |
| §4 Database roles | 3 (created), 4 (grants; `roles.test.ts`) |
| §4 How a request runs as the user (`asUser`) | 4 |
| §4 Token signing and the shared-secret fallback | 3 |
| §5 Sync config and RLS mirror, publication | 4 (publication), 7 |
| §6 Session, Database, Connector, Repository, Screens, sign-out wipe | 2, 6, 7 |
| §7 `/api/upload` contract, savepoint per op, `/api/health`, client handling | 5, 7 |
| §7 `packages/domain` | 1 |
| §8 Test layers; isolation cases 1 to 8 | 1, 4, 5, 6, 7 |
| §8 Isolation case 9 (role guard) and case 10 (`asUser` refusals) | 4 (`roles.test.ts`, `as-user.test.ts`), 3 (`signin.test.ts`) |
| §9 Acceptance criteria 1 to 6 | 6 (1, 5, 6), 7 (2, 3, 4) |
| §9 Acceptance criterion 7 (one command from a clean checkout) | 8 Step 5; CI `backend` and `e2e` jobs |
| §10 CI, including image builds | 8 |
| §11 Documentation changes | 3 (`.env.example`), 8 |
| §13 Risks: GoTrue standalone and signing first; Beta storage; `asUser` as the single entry point with lint | 3, 7, 4 and 5 |
| §14 What carries over | 3 (removes Supabase files, keeps `test-support/mail.ts` and the email template) |
