# Walking Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A locally running, web-first Expo app where a user signs in by email code, gets a household, adds title-only recipes offline, and sees them sync to other sessions in the same household and to no one else.

**Architecture:** pnpm monorepo. `apps/mobile` (Expo web) reads and writes a browser SQLite database through the PowerSync web SDK. Queued writes upload through a Supabase Edge Function (`/upload`) that validates with the zod schema in `packages/domain` and writes as the user so RLS applies. A self-hosted PowerSync service in Docker streams each household's rows back down. Tenancy is enforced by Postgres RLS reading `household_id` and `household_role` claims that an access-token hook puts in every JWT.

**Tech Stack:** pnpm workspaces, TypeScript (strict), Expo + Expo Router (web target), `@powersync/web` + `@powersync/react`, Supabase CLI (Postgres, Auth, Edge Functions on Deno), PowerSync service (Docker, MongoDB storage), zod 4, Vitest, Playwright, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-12-walking-skeleton-design.md`

## Global Constraints

- TypeScript strict everywhere. No `any` without a comment explaining why (lint enforces `no-explicit-any`).
- Tenant isolation: every tenant table has `household_id NOT NULL`, RLS enabled, and policies in the same migration; the table is added to `supabase/tests/rls/registry.ts` in the same change.
- The service-role key is not used anywhere: not in the app, the Edge Function, the tests, or CI.
- The app bundle contains only `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_POWERSYNC_URL`.
- Screens read and write the local database only, through the Recipe Repository and Session. No screen calls Supabase data APIs or `fetch`.
- Viewers cannot write: enforced in RLS and the add form is not rendered for them.
- Recipe IDs are client-generated UUIDs. Delete means setting `deleted_at`; no hard deletes and no delete policies.
- The client never sends server-owned fields (`created_at`, `updated_at`, `updated_by`).
- Sync config mirrors RLS: `recipes` select policy `household_id = auth_household_id()` ↔ stream filter `household_id = auth.parameter('household_id')`. Change one, change the other.
- Never edit an applied migration; add a new one.
- Recipe title: 1 to 200 characters after trimming; unknown fields rejected.
- Sign-in: email one-time code, 6 digits.
- Sync latency target: a recipe appears in another session within 10 seconds (NFR-5).
- Conventional Commits with requirement IDs, e.g. `feat(sync): upload connector (FR-30)`.
- Work on branch `feat/walking-skeleton`, never directly on `main`.
- Package versions: install the current release of each dependency with the commands given. Do not hand-write version numbers. Where an installed package's types disagree with code in this plan, the installed `.d.ts` is the authority; adapt the call and keep the behaviour.

## Review Focus

Inputs the spec implies but does not spell out, most likely first. Each has a pinning test in the named task.

1. **Blank or over-long title typed into the add form** → an inline message, nothing saved, nothing queued. (Task 5: repository unit tests, e2e "rejects a blank title")
2. **Wrong or expired sign-in code; email typed with capitals or spaces** → a clear message, the user stays on the code step and can retry; the email is trimmed and lower-cased before use. (Task 5: `email.test.ts`, e2e "wrong code")
3. **Malformed `/upload` body** (not JSON, no `ops`, more than 500 ops) → `400`, nothing applied; the client drops the batch so the queue is not blocked forever. (Task 4: function tests; Task 6: `upload.test.ts`)
4. **A `put` whose id already belongs to another household's recipe** → rejected, the other household's row unchanged. (Task 4: function test "id collision")
5. **A signed-in user whose token has no household claims** (membership missing or soft-deleted) → reads nothing, writes refused, and the app says so instead of showing an empty list. (Task 3: RLS test "no household claim"; Task 5: `claims.test.ts` and the list screen's message)

---

## File Structure

```
package.json                     workspace scripts
pnpm-workspace.yaml
tsconfig.base.json               shared strict compiler options
tsconfig.json                    typechecks root-level TS (tests, e2e, configs)
eslint.config.mjs  .prettierrc.json  .prettierignore
vitest.config.ts                 unit tests
vitest.integration.config.ts     RLS and function tests (serial, long timeout)
playwright.config.ts
docker-compose.yml               PowerSync service + MongoDB
scripts/write-env.mjs            writes .env.local files from `supabase status`
scripts/wait-for.mjs             waits for an HTTP endpoint
test-support/env.ts              lazy access to test env vars
test-support/mail.ts             reads sign-in codes from the local mail catcher
packages/domain/src/index.ts     recipe zod schemas (single file; Deno imports it)
packages/domain/src/index.test.ts
apps/mobile/
  app/_layout.tsx  app/index.tsx  app/sign-in.tsx     thin routes
  src/config.ts                  reads EXPO_PUBLIC_* vars
  src/db/schema.ts               local table definitions
  src/db/database.web.ts         opens the browser database (platform-specific)
  src/db/database.ts             native stub (throws; native comes later)
  src/db/DatabaseProvider.tsx
  src/db/DatabaseSessionBridge.tsx   connect on sign-in, wipe on sign-out
  src/session/claims.ts  email.ts  supabase.ts  SessionProvider.tsx
  src/recipes/repository.ts  useRecipes.ts
  src/sync/upload.ts  connector.ts
  src/components/StatusLine.tsx  AddRecipeForm.tsx
  src/screens/SignInScreen.tsx  RecipeListScreen.tsx
supabase/
  config.toml  seed.sql  templates/otp.html
  migrations/20261012000000_create_households_memberships_recipes.sql
  functions/_shared/auth.ts  functions/_shared/cors.ts
  functions/upload/index.ts  functions/upload/deno.json
  tests/helpers/auth.ts
  tests/rls/registry.ts  isolation.test.ts  signup.test.ts  coverage.test.ts
  tests/functions/upload.test.ts
powersync/service.yaml  powersync/sync-config.yaml
e2e/helpers.ts  shell.spec.ts  auth.spec.ts  recipes.spec.ts  sync.spec.ts
.github/workflows/ci.yml
docs/adr/0007-web-first-delivery-via-expo-web.md
```

Task order follows risk: the PowerSync-under-Expo integration (Task 2) comes before any backend work.

---

### Task 1: Workspace and domain package

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

### Task 2: Expo web shell with the PowerSync browser database (risk gate)

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

### Task 3: Database, tenancy, and the isolation suite

**Files:**
- Create: `supabase/config.toml` (generated, then edited), `supabase/templates/otp.html`
- Create: `supabase/migrations/20261012000000_create_households_memberships_recipes.sql`
- Create: `supabase/seed.sql`
- Create: `scripts/write-env.mjs`, `vitest.integration.config.ts`
- Create: `test-support/env.ts`, `test-support/mail.ts`, `supabase/tests/helpers/auth.ts`
- Test: `supabase/tests/rls/registry.ts`, `isolation.test.ts`, `signup.test.ts`, `coverage.test.ts`
- Modify: `package.json` (scripts)

**Interfaces:**
- Produces:
  - Tables `public.households`, `public.memberships`, `public.recipes`; enum `public.household_role`
  - SQL helpers `public.auth_household_id() returns uuid`, `public.auth_household_role() returns public.household_role`
  - JWT claims `household_id` (uuid string) and `household_role` (`admin` | `member` | `viewer`). The claim is **not** named `role`: Supabase reserves `role` for the Postgres role.
  - Publication `powersync` containing `public.recipes`
  - Seed users: `admin-a@example.test`, `member-a@example.test`, `viewer-a@example.test` (household A), `admin-b@example.test` (household B). Seed recipes: `Seed pancakes` (A), `Seed curry` (B).
  - `.env.local` (root) with `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_POWERSYNC_URL`, `TEST_DB_URL`, `TEST_MAIL_URL`; `apps/mobile/.env.local` with only the three `EXPO_PUBLIC_*` lines
  - `env` from `test-support/env.ts`: `{ supabaseUrl, anonKey, dbUrl, mailUrl }` (lazy getters)
  - `watchMailbox(mailUrl: string, email: string): Promise<{ nextCode(): Promise<string> }>` from `test-support/mail.ts`
  - `signInAs(email): Promise<Actor>` (cached per test file) and `signInFresh(email): Promise<Actor>` from `supabase/tests/helpers/auth.ts`, where `Actor = { email; client: SupabaseClient; accessToken: string; userId: string; householdId: string | null; role: string | null }`
  - `SEED` constant with the four emails; `TENANT_TABLES` from `supabase/tests/rls/registry.ts`

- [ ] **Step 1: Initialise Supabase**

```bash
pnpm add -Dw supabase @supabase/supabase-js postgres
pnpm exec supabase init
```

Answer "no" to editor-settings prompts. Add to root `package.json` scripts:

```json
{
  "dev:backend": "supabase start && node scripts/write-env.mjs",
  "dev:backend:stop": "supabase stop",
  "db:reset": "supabase db reset",
  "test:rls": "vitest run -c vitest.integration.config.ts supabase/tests/rls",
  "test:functions": "vitest run -c vitest.integration.config.ts supabase/tests/functions"
}
```

- [ ] **Step 2: Configure auth for email codes and the token hook**

`supabase/templates/otp.html`:

```html
<h2>Your sign-in code</h2>
<p>Enter this code in the app:</p>
<p><strong>{{ .Token }}</strong></p>
```

Edit `supabase/config.toml`. These tables already exist in the generated file; change the keys in place and add any that are missing. Do not create a second copy of a table.

```toml
[auth]
site_url = "http://localhost:8081"
enable_signup = true

[auth.email]
enable_signup = true
enable_confirmations = false
max_frequency = "1s"
otp_length = 6
otp_expiry = 3600

[auth.email.template.magic_link]
subject = "Your sign-in code"
content_path = "./supabase/templates/otp.html"

[auth.email.template.confirmation]
subject = "Your sign-in code"
content_path = "./supabase/templates/otp.html"

[auth.rate_limit]
email_sent = 1000
sign_in_sign_ups = 1000
token_verifications = 1000

[auth.hook.custom_access_token]
enabled = true
uri = "pg-functions://postgres/public/custom_access_token_hook"
```

- [ ] **Step 3: Write the env script and test support**

`scripts/write-env.mjs`:

```js
// Writes local env files from the running Supabase stack.
// The app file gets only public values; the root file adds test-only values.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const output = execFileSync('pnpm', ['exec', 'supabase', 'status', '-o', 'env'], {
  encoding: 'utf8',
});
const vars = Object.fromEntries(
  [...output.matchAll(/^([A-Z_]+)="?([^"\n]*)"?$/gm)].map((match) => [match[1], match[2]]),
);

for (const name of ['API_URL', 'ANON_KEY', 'DB_URL']) {
  if (!vars[name]) {
    console.error(`supabase status did not report ${name}. Is the stack running?`);
    process.exit(1);
  }
}

const publicLines = [
  `EXPO_PUBLIC_SUPABASE_URL=${vars.API_URL}`,
  `EXPO_PUBLIC_SUPABASE_ANON_KEY=${vars.ANON_KEY}`,
  'EXPO_PUBLIC_POWERSYNC_URL=http://localhost:8080',
];
const testLines = [
  `TEST_DB_URL=${vars.DB_URL}`,
  `TEST_MAIL_URL=${vars.MAILPIT_URL ?? vars.INBUCKET_URL ?? 'http://127.0.0.1:54324'}`,
];

writeFileSync('apps/mobile/.env.local', publicLines.join('\n') + '\n');
writeFileSync('.env.local', [...publicLines, ...testLines].join('\n') + '\n');
console.log('Wrote .env.local and apps/mobile/.env.local');
```

`test-support/env.ts`:

```ts
import { existsSync } from 'node:fs';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Run \`pnpm dev:backend\` first.`);
  return value;
}

export const env = {
  get supabaseUrl() {
    return required('EXPO_PUBLIC_SUPABASE_URL');
  },
  get anonKey() {
    return required('EXPO_PUBLIC_SUPABASE_ANON_KEY');
  },
  get dbUrl() {
    return required('TEST_DB_URL');
  },
  get mailUrl() {
    return required('TEST_MAIL_URL');
  },
};
```

`test-support/mail.ts`:

```ts
type MessageSummary = { ID: string };

async function newestMessageId(mailUrl: string, email: string): Promise<string | null> {
  const query = encodeURIComponent(`to:${email}`);
  const response = await fetch(`${mailUrl}/api/v1/search?query=${query}`);
  if (!response.ok) throw new Error(`Mail catcher returned ${response.status}`);
  const body = (await response.json()) as { messages: MessageSummary[] };
  return body.messages[0]?.ID ?? null;
}

/**
 * Call BEFORE requesting a code. `nextCode()` then waits for a message newer
 * than anything already in the mailbox, so an old code is never returned.
 */
export async function watchMailbox(mailUrl: string, email: string) {
  const before = await newestMessageId(mailUrl, email);
  return {
    async nextCode(): Promise<string> {
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        const newest = await newestMessageId(mailUrl, email);
        if (newest && newest !== before) {
          const response = await fetch(`${mailUrl}/api/v1/message/${newest}`);
          const message = (await response.json()) as { Text?: string; HTML?: string };
          const match = /\b(\d{6})\b/.exec(`${message.Text ?? ''} ${message.HTML ?? ''}`);
          if (match?.[1]) return match[1];
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      throw new Error(`No sign-in code arrived for ${email}`);
    },
  };
}
```

`supabase/tests/helpers/auth.ts`:

```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../../../test-support/env';
import { watchMailbox } from '../../../test-support/mail';

export const SEED = {
  adminA: 'admin-a@example.test',
  memberA: 'member-a@example.test',
  viewerA: 'viewer-a@example.test',
  adminB: 'admin-b@example.test',
} as const;

export type Actor = {
  email: string;
  client: SupabaseClient;
  accessToken: string;
  userId: string;
  householdId: string | null;
  role: string | null;
};

/** Signs in through the real email-code flow, so the token hook runs. */
export async function signInFresh(email: string): Promise<Actor> {
  const client = createClient(env.supabaseUrl, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const mailbox = await watchMailbox(env.mailUrl, email);
  const requested = await client.auth.signInWithOtp({ email });
  if (requested.error) throw requested.error;
  const code = await mailbox.nextCode();
  const verified = await client.auth.verifyOtp({ email, token: code, type: 'email' });
  if (verified.error || !verified.data.session) {
    throw verified.error ?? new Error(`No session for ${email}`);
  }
  const accessToken = verified.data.session.access_token;
  const payload = JSON.parse(
    Buffer.from(accessToken.split('.')[1] ?? '', 'base64url').toString('utf8'),
  ) as { sub: string; household_id?: string; household_role?: string };
  return {
    email,
    client,
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

`vitest.integration.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['supabase/tests/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
```

- [ ] **Step 4: Write the failing isolation suite**

`supabase/tests/rls/registry.ts`:

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

`supabase/tests/rls/isolation.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { describe, expect, it } from 'vitest';
import { env } from '../../../test-support/env';
import { SEED, signInAs, signInFresh, type Actor } from '../helpers/auth';
import { TENANT_COLUMN, TENANT_TABLES } from './registry';

const RLS_VIOLATION = '42501';

async function insertRecipe(actor: Actor, title: string): Promise<string> {
  const id = randomUUID();
  const { error } = await actor.client
    .from('recipes')
    .insert({ id, household_id: actor.householdId, title });
  expect(error).toBeNull();
  return id;
}

async function titleOf(actor: Actor, id: string): Promise<string | undefined> {
  const { data, error } = await actor.client.from('recipes').select('title').eq('id', id);
  expect(error).toBeNull();
  return data?.[0]?.title as string | undefined;
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

    const targeted = await b.client.from(table).select('*').eq(column, a.householdId);
    expect(targeted.error).toBeNull();
    expect(targeted.data).toEqual([]);

    const everything = await b.client.from(table).select(column);
    expect(everything.error).toBeNull();
    const tenants = new Set(
      (everything.data as unknown as Record<string, string>[]).map((row) => row[column]),
    );
    expect([...tenants]).toEqual([b.householdId]);
  });

  it('household B cannot insert a recipe into household A', async () => {
    const a = await signInAs(SEED.adminA);
    const b = await signInAs(SEED.adminB);
    const { error } = await b.client
      .from('recipes')
      .insert({ id: randomUUID(), household_id: a.householdId, title: 'Intruder' });
    expect(error?.code).toBe(RLS_VIOLATION);
  });

  it('household B cannot update a recipe in household A', async () => {
    const a = await signInAs(SEED.memberA);
    const b = await signInAs(SEED.adminB);
    const id = await insertRecipe(a, 'Original');
    const { data, error } = await b.client
      .from('recipes')
      .update({ title: 'Hacked' })
      .eq('id', id)
      .select('id');
    expect(error).toBeNull();
    expect(data).toEqual([]);
    expect(await titleOf(a, id)).toBe('Original');
  });

  it('a recipe cannot be moved into another household', async () => {
    const a = await signInAs(SEED.adminA);
    const b = await signInAs(SEED.adminB);
    const id = await insertRecipe(b, 'Mine');
    const { error } = await b.client
      .from('recipes')
      .update({ household_id: a.householdId })
      .eq('id', id);
    expect(error?.code).toBe(RLS_VIOLATION);
  });
});

describe('roles', () => {
  it('a viewer can read recipes', async () => {
    const viewer = await signInAs(SEED.viewerA);
    const { data, error } = await viewer.client.from('recipes').select('title');
    expect(error).toBeNull();
    expect(data?.map((row) => row.title)).toContain('Seed pancakes');
  });

  it('a viewer cannot insert', async () => {
    const viewer = await signInAs(SEED.viewerA);
    const { error } = await viewer.client
      .from('recipes')
      .insert({ id: randomUUID(), household_id: viewer.householdId, title: 'Nope' });
    expect(error?.code).toBe(RLS_VIOLATION);
  });

  it('a viewer cannot update', async () => {
    const member = await signInAs(SEED.memberA);
    const viewer = await signInAs(SEED.viewerA);
    const id = await insertRecipe(member, 'Untouched');
    const { data, error } = await viewer.client
      .from('recipes')
      .update({ title: 'Changed' })
      .eq('id', id)
      .select('id');
    expect(error).toBeNull();
    expect(data).toEqual([]);
    expect(await titleOf(member, id)).toBe('Untouched');
  });

  it('a member can insert, read, and update', async () => {
    const member = await signInAs(SEED.memberA);
    const id = await insertRecipe(member, 'Draft');
    const { error } = await member.client.from('recipes').update({ title: 'Final' }).eq('id', id);
    expect(error).toBeNull();
    expect(await titleOf(member, id)).toBe('Final');
  });

  it('only an admin can rename the household', async () => {
    const admin = await signInAs(SEED.adminA);
    const member = await signInAs(SEED.memberA);
    const asMember = await member.client
      .from('households')
      .update({ name: 'Member was here' })
      .eq('id', member.householdId)
      .select('id');
    expect(asMember.data).toEqual([]);
    const asAdmin = await admin.client
      .from('households')
      .update({ name: 'Household A' })
      .eq('id', admin.householdId)
      .select('id');
    expect(asAdmin.error).toBeNull();
    expect(asAdmin.data).toHaveLength(1);
  });
});

describe('no hard deletes', () => {
  it.each([SEED.adminA, SEED.memberA, SEED.viewerA])('%s cannot delete a recipe', async (email) => {
    const member = await signInAs(SEED.memberA);
    const actor = await signInAs(email);
    const id = await insertRecipe(member, 'Keep me');
    const { data, error } = await actor.client.from('recipes').delete().eq('id', id).select('id');
    expect(error).toBeNull();
    expect(data).toEqual([]);
    expect(await titleOf(member, id)).toBe('Keep me');
  });

  it('an admin cannot delete the household or a membership', async () => {
    const admin = await signInAs(SEED.adminA);
    const household = await admin.client
      .from('households')
      .delete()
      .eq('id', admin.householdId)
      .select('id');
    expect(household.data).toEqual([]);
    const membership = await admin.client
      .from('memberships')
      .delete()
      .eq('household_id', admin.householdId)
      .select('id');
    expect(membership.data).toEqual([]);
    const remaining = await admin.client.from('memberships').select('id');
    expect(remaining.data).toHaveLength(3);
  });
});

describe('server-owned fields', () => {
  it('ignores client values for created_at, updated_at, and updated_by', async () => {
    const admin = await signInAs(SEED.adminA);
    const member = await signInAs(SEED.memberA);
    const id = randomUUID();
    const spoofed = '2000-01-01T00:00:00+00:00';
    const inserted = await member.client
      .from('recipes')
      .insert({
        id,
        household_id: member.householdId,
        title: 'Clock test',
        created_at: spoofed,
        updated_at: spoofed,
        updated_by: admin.userId,
      })
      .select('created_at, updated_at, updated_by')
      .single();
    expect(inserted.error).toBeNull();
    const oneMinuteAgo = Date.now() - 60_000;
    expect(new Date(inserted.data!.created_at).getTime()).toBeGreaterThan(oneMinuteAgo);
    expect(new Date(inserted.data!.updated_at).getTime()).toBeGreaterThan(oneMinuteAgo);
    expect(inserted.data!.updated_by).toBe(member.userId);

    const updated = await admin.client
      .from('recipes')
      .update({ title: 'Clock test 2', created_at: spoofed, updated_by: member.userId })
      .eq('id', id)
      .select('created_at, updated_by')
      .single();
    expect(updated.error).toBeNull();
    expect(updated.data!.created_at).toBe(inserted.data!.created_at);
    expect(updated.data!.updated_by).toBe(admin.userId);
  });
});

describe('memberships are read-only for clients', () => {
  it('rejects insert and ignores update', async () => {
    const admin = await signInAs(SEED.adminA);
    const viewer = await signInAs(SEED.viewerA);
    const inserted = await admin.client
      .from('memberships')
      .insert({ household_id: admin.householdId, user_id: randomUUID(), role: 'member' });
    expect(inserted.error).not.toBeNull();

    const promoted = await viewer.client
      .from('memberships')
      .update({ role: 'admin' })
      .eq('user_id', viewer.userId)
      .select('id');
    expect(promoted.data).toEqual([]);
    const own = await viewer.client.from('memberships').select('role').eq('user_id', viewer.userId);
    expect(own.data?.[0]?.role).toBe('viewer');
  });
});

describe('no household claim', () => {
  it('a user without an active membership reads nothing and cannot write', async () => {
    const email = `orphan-${randomUUID()}@example.test`;
    const first = await signInFresh(email);
    expect(first.householdId).not.toBeNull();

    // Direct database access as the local superuser, used only to arrange
    // state that no client can create. Not the service-role key.
    const sql = postgres(env.dbUrl, { max: 1 });
    await sql`update public.memberships set deleted_at = now() where user_id = ${first.userId}`;
    await sql.end();

    await new Promise((resolve) => setTimeout(resolve, 1100)); // auth.email.max_frequency
    const orphan = await signInFresh(email);
    expect(orphan.householdId).toBeNull();
    expect(orphan.role).toBeNull();

    for (const table of TENANT_TABLES) {
      const { data, error } = await orphan.client.from(table).select('*');
      expect(error).toBeNull();
      expect(data).toEqual([]);
    }
    const { error } = await orphan.client
      .from('recipes')
      .insert({ id: randomUUID(), household_id: first.householdId, title: 'Orphan write' });
    expect(error?.code).toBe(RLS_VIOLATION);
  });
});
```

`supabase/tests/rls/signup.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { signInFresh } from '../helpers/auth';

it('a new sign-up gets a household, an admin membership, and both claims (FR-2)', async () => {
  const local = `signup-${randomUUID()}`;
  const actor = await signInFresh(`${local}@example.test`);

  expect(actor.role).toBe('admin');
  expect(actor.householdId).toMatch(/^[0-9a-f-]{36}$/);

  const households = await actor.client.from('households').select('id, name');
  expect(households.error).toBeNull();
  expect(households.data).toEqual([{ id: actor.householdId, name: `${local} household` }]);

  const memberships = await actor.client.from('memberships').select('user_id, role');
  expect(memberships.data).toEqual([{ user_id: actor.userId, role: 'admin' }]);

  const recipes = await actor.client.from('recipes').select('id');
  expect(recipes.data).toEqual([]);
});
```

`supabase/tests/rls/coverage.test.ts`:

```ts
import postgres from 'postgres';
import { expect, it } from 'vitest';
import { env } from '../../../test-support/env';
import { TENANT_TABLES } from './registry';

it('every public table has RLS enabled and is in the test registry', async () => {
  const sql = postgres(env.dbUrl, { max: 1 });
  const tables = await sql<{ name: string; rls: boolean }[]>`
    select c.relname as name, c.relrowsecurity as rls
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
    order by c.relname`;
  await sql.end();

  expect(tables.filter((table) => !table.rls).map((table) => table.name)).toEqual([]);
  expect(tables.map((table) => table.name)).toEqual([...TENANT_TABLES].sort());
});
```

- [ ] **Step 5: Start the stack and confirm the suite fails**

Run: `pnpm dev:backend && pnpm test:rls`
Expected: the stack starts (the first run downloads Docker images and takes several minutes) and the env files are written. The suite FAILS: sign-in works, but the tables do not exist and `coverage.test.ts` reports an empty table list.

- [ ] **Step 6: Write the migration**

`supabase/migrations/20261012000000_create_households_memberships_recipes.sql`:

```sql
-- Households, memberships, recipes: tables, RLS, triggers, token hook, publication.
-- FR-2, FR-4, FR-30, NFR-1.

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

-- ---------------------------------------------------------------- claims

create function public.auth_household_id() returns uuid
language sql stable
as $$ select nullif(auth.jwt() ->> 'household_id', '')::uuid $$;

create function public.auth_household_role() returns public.household_role
language sql stable
as $$ select nullif(auth.jwt() ->> 'household_role', '')::public.household_role $$;

-- Adds household_id and household_role to every access token.
-- The claim is not called "role": Supabase reserves that for the Postgres role.
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
revoke execute on function public.custom_access_token_hook from public, anon, authenticated;
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

revoke execute on function public.handle_new_user from public, anon, authenticated;

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
  new.updated_by := auth.uid();
  return new;
end;
$$;

create trigger recipes_stamp before insert or update on public.recipes
for each row execute function public.stamp_row();

create trigger households_stamp before update on public.households
for each row execute function public.stamp_row();

-- ---------------------------------------------------------------- RLS

alter table public.households enable row level security;
alter table public.memberships enable row level security;
alter table public.recipes enable row level security;

-- No delete policy on any table: delete means setting deleted_at.

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

-- Memberships: read-only for clients. Rows are written by handle_new_user.
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

-- PowerSync replicates from a publication with this exact name.
create publication powersync for table public.recipes;
```

- [ ] **Step 7: Write the seed**

`supabase/seed.sql`:

```sql
-- Local development and test data. Never applied to hosted environments.
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

- [ ] **Step 8: Apply and run the suite**

Run: `pnpm exec supabase stop && pnpm dev:backend && pnpm db:reset && pnpm test:rls`
(The stop/start picks up the `config.toml` changes; `db:reset` applies the migration and seed.)
Expected: PASS, all tests in the three files.

Likely first-run problems:

| Symptom | Cause and fix |
|---|---|
| `No sign-in code arrived` | The email contains a link, not a code: check the template paths in `config.toml` and restart the stack. Open the mail catcher at the `TEST_MAIL_URL` address to see the message. |
| Seeded users cannot sign in (`Database error finding user`) | A token column is `NULL` in `auth.users`. Compare the seed's column list with `\d auth.users` (`psql "$TEST_DB_URL"`) and set any other `*_token` or `*_change` text column that has no default to `''`. |
| Claims are `null` for every user | The hook is not enabled: confirm the `[auth.hook.custom_access_token]` table and restart the stack. |
| `email rate limit exceeded` | Confirm `[auth.rate_limit]` and `max_frequency` from Step 2. |

- [ ] **Step 9: Run all checks and commit**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:rls`
Expected: clean.

```bash
git add -A
git commit -m "feat(db): households, memberships, recipes with RLS and isolation suite (FR-1, FR-2, FR-4, NFR-1)"
```

---

### Task 4: The `/upload` Edge Function

**Files:**
- Create: `supabase/functions/_shared/cors.ts`, `supabase/functions/_shared/auth.ts`
- Create: `supabase/functions/upload/index.ts`, `supabase/functions/upload/deno.json`
- Modify: `supabase/config.toml`
- Test: `supabase/tests/functions/upload.test.ts`

**Interfaces:**
- Consumes: `recipeSchema`, `recipePatchSchema` from `@recipe-app/domain`; `signInAs`, `SEED`, `Actor` from `supabase/tests/helpers/auth.ts`; `env` from `test-support/env.ts`
- Produces: `POST {SUPABASE_URL}/functions/v1/upload`
  - Headers: `Authorization: Bearer <user JWT>`, `apikey: <anon key>`, `Content-Type: application/json`
  - Body: `{ "ops": [ { "op": "put" | "patch" | "delete", "table": string, "id": uuid, "data"?: object } ] }`, at most 500 ops
  - `200` → `{ "results": [ { "id", "status": "applied" } | { "id", "status": "rejected", "reason" } ] }`, same order as `ops`
  - Reasons: `table_not_allowed`, `delete_not_allowed`, `invalid`, `forbidden`, `not_found_or_forbidden`
  - `400` malformed body · `401` missing or invalid token · `405` wrong method · `500` unexpected failure

- [ ] **Step 1: Write the failing tests**

`supabase/tests/functions/upload.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { env } from '../../../test-support/env';
import { SEED, signInAs, type Actor } from '../helpers/auth';

type Result = { id: string; status: 'applied' | 'rejected'; reason?: string };

function post(token: string | null, body: unknown): Promise<Response> {
  return fetch(`${env.supabaseUrl}/functions/v1/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: env.anonKey,
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

async function readRecipe(actor: Actor, id: string) {
  const { data } = await actor.client
    .from('recipes')
    .select('title, household_id, deleted_at, updated_by')
    .eq('id', id);
  return data?.[0];
}

function put(actor: Actor, id: string, title: string) {
  return { op: 'put', table: 'recipes', id, data: { household_id: actor.householdId, title } };
}

describe('POST /upload', () => {
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
    const { data } = await member.client.from('recipes').select('id').eq('id', id);
    expect(data).toHaveLength(1);
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

  it('rejects a put into another household', async () => {
    const a = await signInAs(SEED.adminA);
    const b = await signInAs(SEED.adminB);
    const id = randomUUID();
    const results = await upload(b, [
      { op: 'put', table: 'recipes', id, data: { household_id: a.householdId, title: 'Planted' } },
    ]);
    expect(results).toEqual([{ id, status: 'rejected', reason: 'forbidden' }]);
    expect(await readRecipe(a, id)).toBeUndefined();
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

  it('returns 401 without a token and with a bad token', async () => {
    expect((await post(null, { ops: [] })).status).toBe(401);
    expect((await post('not-a-jwt', { ops: [] })).status).toBe(401);
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

  it('answers the CORS preflight', async () => {
    const response = await fetch(`${env.supabaseUrl}/functions/v1/upload`, { method: 'OPTIONS' });
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `pnpm test:functions`
Expected: FAIL, every request returns `404` (no such function).

- [ ] **Step 3: Implement the shared helpers**

`supabase/functions/_shared/cors.ts`:

```ts
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
```

`supabase/functions/_shared/auth.ts`:

```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Returns a client that acts as the caller, so RLS governs every statement,
 * or null when the request carries no valid user token.
 * The service-role key is deliberately not used.
 */
export async function userClient(req: Request): Promise<SupabaseClient | null> {
  const header = req.headers.get('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  if (!token) return null;

  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;
  return client;
}
```

- [ ] **Step 4: Implement the function**

`supabase/functions/upload/deno.json`:

```json
{
  "imports": {
    "@recipe-app/domain": "../../../packages/domain/src/index.ts",
    "zod": "npm:zod@^4",
    "@supabase/supabase-js": "npm:@supabase/supabase-js@^2"
  }
}
```

`supabase/functions/upload/index.ts`:

```ts
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { recipePatchSchema, recipeSchema } from '@recipe-app/domain';
import { userClient } from '../_shared/auth.ts';
import { corsHeaders, json } from '../_shared/cors.ts';

const MAX_OPS = 500;
const ALLOWED_TABLES = new Set(['recipes']);

const opSchema = z.strictObject({
  op: z.enum(['put', 'patch', 'delete']),
  table: z.string(),
  id: z.guid(),
  data: z.record(z.string(), z.unknown()).optional(),
});
const bodySchema = z.strictObject({ ops: z.array(opSchema).max(MAX_OPS) });

type Op = z.infer<typeof opSchema>;
type Result =
  | { id: string; status: 'applied' }
  | { id: string; status: 'rejected'; reason: string };

const applied = (op: Op): Result => ({ id: op.id, status: 'applied' });
const rejected = (op: Op, reason: string): Result => ({ id: op.id, status: 'rejected', reason });

/**
 * Errors the database raises because of what the caller sent: RLS refusal
 * (42501), constraint violations (23xxx), bad data (22xxx). Retrying cannot
 * fix these, so they become "rejected". Anything else is unexpected and
 * surfaces as a 500 so the client retries.
 */
function isRefusal(code: string | undefined): boolean {
  return code === '42501' || code?.startsWith('23') === true || code?.startsWith('22') === true;
}

async function applyOp(client: SupabaseClient, op: Op): Promise<Result> {
  if (!ALLOWED_TABLES.has(op.table)) return rejected(op, 'table_not_allowed');
  if (op.op === 'delete') return rejected(op, 'delete_not_allowed');

  const candidate = { ...(op.data ?? {}), id: op.id };

  if (op.op === 'put') {
    const parsed = recipeSchema.safeParse(candidate);
    if (!parsed.success) return rejected(op, 'invalid');
    const { error } = await client.from('recipes').upsert(parsed.data);
    if (!error) return applied(op);
    if (isRefusal(error.code)) return rejected(op, 'forbidden');
    throw new Error(`put failed: ${error.code} ${error.message}`);
  }

  const parsed = recipePatchSchema.safeParse(candidate);
  if (!parsed.success) return rejected(op, 'invalid');
  const { id, ...fields } = parsed.data;
  const { data, error } = await client.from('recipes').update(fields).eq('id', id).select('id');
  if (error) {
    if (isRefusal(error.code)) return rejected(op, 'forbidden');
    throw new Error(`patch failed: ${error.code} ${error.message}`);
  }
  // RLS hides rows the caller may not update, so "no row" covers both cases.
  return data.length === 0 ? rejected(op, 'not_found_or_forbidden') : applied(op);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const client = await userClient(req);
  if (!client) return json({ error: 'unauthorized' }, 401);

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  const body = bodySchema.safeParse(payload);
  if (!body.success) return json({ error: 'invalid_body' }, 400);

  try {
    // Sequential on purpose: ops are ordered, and every op is idempotent,
    // so a client retry after a mid-batch failure is safe.
    const results: Result[] = [];
    for (const op of body.data.ops) results.push(await applyOp(client, op));
    return json({ results });
  } catch (error) {
    console.error(JSON.stringify({ event: 'upload_failed', message: String(error) }));
    return json({ error: 'internal' }, 500);
  }
});
```

Append to `supabase/config.toml`:

```toml
# The function verifies the token itself (see _shared/auth.ts) so that a
# missing token returns our 401 with CORS headers.
[functions.upload]
verify_jwt = false
```

- [ ] **Step 5: Restart the stack and run the tests**

Run: `pnpm exec supabase stop && pnpm dev:backend && pnpm test:functions`
Expected: PASS.

If the function fails to boot with a module-not-found error for `packages/domain` (the local function runtime could not see a file outside `supabase/functions`), switch to a generated copy:

1. Add to root `package.json` scripts: `"sync:domain": "node -e \"require('node:fs').cpSync('packages/domain/src/index.ts','supabase/functions/_shared/domain.gen.ts')\""` and prefix `dev:backend` with `pnpm sync:domain && `.
2. In `deno.json`, point `@recipe-app/domain` at `../_shared/domain.gen.ts`.
3. Add `supabase/functions/_shared/domain.gen.ts` to `.gitignore` and `.prettierignore`.
4. Record the workaround in ADR-0007's Consequences (Task 7).

- [ ] **Step 6: Run all checks and commit**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:rls && pnpm test:functions`
Expected: clean.

```bash
git add -A
git commit -m "feat(api): /upload Edge Function with zod validation under RLS (FR-30, NFR-1, NFR-3)"
```

---

### Task 5: Sign-in, the recipe repository, and the list screen

After this task the app works locally with no sync: sign in, add recipes, sign out. Recipes queue in the local database and are not yet uploaded.

**Files:**
- Create: `apps/mobile/src/config.ts`
- Create: `apps/mobile/src/session/claims.ts`, `email.ts`, `supabase.ts`, `SessionProvider.tsx`
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
- Consumes: `recipeTitleSchema` from `@recipe-app/domain`; `openDatabase`, `DatabaseProvider`, `StatusLine` from Task 2; `watchMailbox`, `env` from Task 3
- Produces:
  - `type HouseholdRole = 'admin' | 'member' | 'viewer'`
  - `type Claims = { userId: string; householdId: string; role: HouseholdRole }`
  - `claimsFromToken(token: string): Claims | null`; `canWrite(role: HouseholdRole): boolean`
  - `normalizeEmail(input: string): string | null`
  - `supabase: SupabaseClient` from `src/session/supabase.ts`
  - `config: { supabaseUrl; supabaseAnonKey; powersyncUrl }` from `src/config.ts`
  - `useSession(): SessionValue` where
    `SessionValue = { state: { status: 'loading' } | { status: 'signedOut' } | { status: 'signedIn'; userId: string; claims: Claims | null }; requestCode(email: string): Promise<ActionResult>; verifyCode(email: string, code: string): Promise<ActionResult>; signOut(): Promise<void> }` and `ActionResult = { ok: true } | { ok: false; message: string }`
  - `createRecipe(db: Pick<AbstractPowerSyncDatabase, 'execute'>, claims: Claims, title: string): Promise<string>` (returns the new id; throws `ZodError` for a bad title, `Error` for a viewer)
  - `LIST_RECIPES_SQL: string`; `type RecipeListItem = { id: string; title: string }`; `useRecipes()` (the spec's `watchRecipes`, as a React hook)
  - `<DatabaseSessionBridge />` — wipes the local database when signed out; Task 6 adds connecting on sign-in
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

- [ ] **Step 5: Write the failing end-to-end tests**

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

Run: `pnpm dev:backend && pnpm test:e2e`
Expected: FAIL, there is no `Email` field.

- [ ] **Step 7: Implement config, the Supabase client, and the session**

```bash
pnpm --filter mobile add @supabase/supabase-js
```

`apps/mobile/src/config.ts`:

```ts
function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is not set. Run \`pnpm dev:backend\` to write .env.local.`);
  return value;
}

// Expo inlines EXPO_PUBLIC_* at build time; each must be referenced literally.
// Only public values belong here (CLAUDE.md rule 2).
export const config = {
  supabaseUrl: required('EXPO_PUBLIC_SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL),
  supabaseAnonKey: required(
    'EXPO_PUBLIC_SUPABASE_ANON_KEY',
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  ),
  powersyncUrl: required('EXPO_PUBLIC_POWERSYNC_URL', process.env.EXPO_PUBLIC_POWERSYNC_URL),
};
```

`apps/mobile/src/session/supabase.ts`:

```ts
import { createClient } from '@supabase/supabase-js';
import { config } from '../config';

// Used for authentication only. Recipe data goes through the local database.
export const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});
```

`apps/mobile/src/session/SessionProvider.tsx`:

```tsx
import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { claimsFromToken, type Claims } from './claims';
import { normalizeEmail } from './email';
import { supabase } from './supabase';

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
    void supabase.auth.getSession().then(({ data }) => setState(toState(data.session)));
    const { data } = supabase.auth.onAuthStateChange((_event, session) =>
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
          const { error } = await supabase.auth.signInWithOtp({ email });
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
          const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
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
        await supabase.auth.signOut({ scope: 'local' });
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
Expected: PASS, all tests in `auth.spec.ts` and `recipes.spec.ts`.

If Playwright is reusing an old server on port 8081, stop it first so the new build is served.

- [ ] **Step 10: Run all checks and commit**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: clean.

```bash
git add -A
git commit -m "feat(app): email-code sign-in and local recipe list (FR-1, FR-2, FR-28)"
```

---

### Task 6: Sync — PowerSync service, connector, and the acceptance tests

**Files:**
- Create: `docker-compose.yml`, `powersync/service.yaml`, `powersync/sync-config.yaml`
- Create: `scripts/wait-for.mjs`
- Create: `apps/mobile/src/sync/upload.ts`, `apps/mobile/src/sync/connector.ts`
- Modify: `apps/mobile/src/db/DatabaseSessionBridge.tsx`, `package.json`, `.env.example`
- Test: `apps/mobile/src/sync/upload.test.ts`, `e2e/sync.spec.ts`
- Modify: `e2e/recipes.spec.ts` (viewer test)

**Interfaces:**
- Consumes: `RECIPE_CLIENT_FIELDS` from `@recipe-app/domain`; `supabase`, `config`, `useSession` from Task 5; the `/upload` contract from Task 4; publication `powersync` from Task 3
- Produces:
  - PowerSync service at `http://localhost:8080`, liveness at `/probes/liveness`
  - `type UploadOp = { op: 'put' | 'patch' | 'delete'; table: string; id: string; data?: Record<string, unknown> }`
  - `toUploadOps(entries: CrudLike[]): UploadOp[]` where `CrudLike = { op: string; table: string; id: string; opData?: Record<string, unknown> }`
  - `sendOps(ops, deps): Promise<SendResult>` where `deps = { fetch: typeof fetch; url: string; token: string; anonKey: string }` and `SendResult = { outcome: 'done'; rejected: { id: string; reason: string }[] } | { outcome: 'retry' } | { outcome: 'reauth' }`
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
    url: 'http://api.test/functions/v1/upload',
    token: 'jwt',
    anonKey: 'anon',
  });
  const respond = (status: number, body: unknown = {}) =>
    vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body), { status }));

  it('posts the batch with the user token', async () => {
    const fetchImpl = respond(200, { results: [] });
    await sendOps(ops, deps(fetchImpl));
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('http://api.test/functions/v1/upload');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer jwt');
    expect(new Headers(init?.headers).get('apikey')).toBe('anon');
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

export type SendDeps = { fetch: typeof fetch; url: string; token: string; anonKey: string };

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
        apikey: deps.anonKey,
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

`docker-compose.yml`:

```yaml
# Local PowerSync service. Supabase itself is run by the Supabase CLI.
services:
  powersync:
    image: journeyapps/powersync-service:latest
    restart: unless-stopped
    command: ['start', '-r', 'unified']
    depends_on:
      mongo-rs-init:
        condition: service_completed_successfully
    extra_hosts:
      - 'host.docker.internal:host-gateway'
    volumes:
      - ./powersync/service.yaml:/config/service.yaml:ro
      - ./powersync/sync-config.yaml:/config/sync-config.yaml:ro
    environment:
      POWERSYNC_CONFIG_PATH: /config/service.yaml
    ports:
      - '8080:8080'

  mongo:
    image: mongo:7.0
    command: --replSet rs0 --bind_ip_all --quiet
    restart: unless-stopped
    volumes:
      - powersync_mongo:/data/db

  mongo-rs-init:
    image: mongo:7.0
    depends_on:
      - mongo
    restart: on-failure
    entrypoint:
      - bash
      - -c
      - 'mongosh --host mongo:27017 --eval ''try{rs.status().ok && quit(0)} catch {} rs.initiate({_id: "rs0", version: 1, members: [{ _id: 0, host : "mongo:27017" }]})'''

volumes:
  powersync_mongo:
```

Now choose how the service verifies tokens. Run:

```bash
curl -s http://127.0.0.1:54321/auth/v1/.well-known/jwks.json
```

**If the response lists one or more keys** (local Supabase signs with asymmetric keys), use this `powersync/service.yaml`:

```yaml
replication:
  connections:
    - type: postgresql
      uri: postgresql://postgres:postgres@host.docker.internal:54322/postgres
      sslmode: disable

storage:
  type: mongodb
  uri: mongodb://mongo:27017/powersync_storage

port: 8080

sync_config:
  path: sync-config.yaml

client_auth:
  jwks_uri: http://host.docker.internal:54321/auth/v1/.well-known/jwks.json
  audience:
    - authenticated
```

**If `keys` is empty** (local Supabase signs with the shared HS256 secret), get the secret and encode it:

```bash
pnpm exec supabase status -o env | grep JWT_SECRET
node -e "console.log(Buffer.from(process.argv[1]).toString('base64url'))" "<the JWT_SECRET value>"
```

and replace the `client_auth` block with:

```yaml
client_auth:
  # The Supabase CLI's fixed local-development secret, base64url-encoded.
  # Not a real secret; hosted environments use JWKS.
  jwks:
    keys:
      - kty: oct
        alg: HS256
        k: <the base64url output>
  audience:
    - authenticated
```

`scripts/wait-for.mjs`:

```js
// Usage: node scripts/wait-for.mjs <url> [timeoutSeconds]
const [url, timeout = '90'] = process.argv.slice(2);
if (!url) {
  console.error('Usage: node scripts/wait-for.mjs <url> [timeoutSeconds]');
  process.exit(1);
}
const deadline = Date.now() + Number(timeout) * 1000;

while (Date.now() < deadline) {
  try {
    const response = await fetch(url);
    if (response.ok) {
      console.log(`${url} is up`);
      process.exit(0);
    }
  } catch {
    // not up yet
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
console.error(`Timed out waiting for ${url}`);
process.exit(1);
```

Update root `package.json` scripts:

```json
{
  "dev:backend": "supabase start && node scripts/write-env.mjs && docker compose up -d && node scripts/wait-for.mjs http://localhost:8080/probes/liveness",
  "dev:backend:stop": "docker compose down && supabase stop"
}
```

In `.env.example`, set `EXPO_PUBLIC_POWERSYNC_URL=http://localhost:8080`.

- [ ] **Step 6: Start the service and check it replicates**

Run: `pnpm dev:backend && docker compose logs powersync --tail 50`
Expected: `http://localhost:8080/probes/liveness is up`, and the log shows replication starting with no repeating errors.

| Log symptom | Fix |
|---|---|
| Cannot connect to Postgres | Confirm port `54322` with `pnpm exec supabase status`; confirm `extra_hosts` is present. |
| Publication `powersync` not found | Run `pnpm db:reset`, then `docker compose restart powersync`. |
| Sync config parse error | The service version expects different syntax. Read the error and the Sync Streams docs (`docs.powersync.com/sync/streams/quickstart`); keep the query and the `household_id` filter. |
| `wal_level` is not `logical` | Add `wal_level = 'logical'` under `[db.settings]` in `supabase/config.toml` and restart the stack. |

`pnpm db:reset` recreates the database, so always follow it with `docker compose restart powersync`.

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
import { supabase } from '../session/supabase';
import { sendOps, toUploadOps } from './upload';

const UPLOAD_URL = `${config.supabaseUrl}/functions/v1/upload`;

export function createConnector(): PowerSyncBackendConnector {
  return {
    async fetchCredentials() {
      const { data } = await supabase.auth.getSession();
      if (!data.session) return null;
      return { endpoint: config.powersyncUrl, token: data.session.access_token };
    },

    // PowerSync calls this whenever local writes are queued, and retries
    // with backoff when it throws.
    async uploadData(database) {
      const transaction = await database.getNextCrudTransaction();
      if (!transaction) return;

      const { data } = await supabase.auth.getSession();
      if (!data.session) throw new Error('Not signed in; upload will retry');

      const ops = toUploadOps(transaction.crud);
      if (ops.length > 0) {
        const result = await sendOps(ops, {
          fetch: (input, init) => fetch(input, init),
          url: UPLOAD_URL,
          token: data.session.access_token,
          anonKey: config.supabaseAnonKey,
        });

        if (result.outcome === 'retry') throw new Error('Upload failed; will retry');
        if (result.outcome === 'reauth') {
          const { error } = await supabase.auth.refreshSession();
          if (error) await supabase.auth.signOut({ scope: 'local' });
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

Run: `pnpm db:reset && docker compose restart powersync && node scripts/wait-for.mjs http://localhost:8080/probes/liveness && pnpm test:e2e`
Expected: PASS, every spec. Stop any old server on port 8081 first so the new build is served.

| Symptom | Fix |
|---|---|
| Stays `Offline`; service log shows `PSYNC_S2101` (no matching key) | The `client_auth` variant from Step 5 does not match how local Supabase signs tokens. Re-run the `curl` check and switch variants. |
| Service log shows `PSYNC_S2105` (missing `aud`) | Confirm `audience: [authenticated]`. |
| Online, but no rows arrive | The client must support Sync Streams. Check the installed `@powersync/web` docs for a connect option selecting the newer sync client and pass it in `db.connect(connector, { ... })`. |
| Rows from the other household appear | Stop. This is an isolation failure; fix `sync-config.yaml` before anything else. |
| The offline test's `1 unsynced` never shows | Apply the `ps_crud` fallback from Task 2 Step 9. |

- [ ] **Step 11: Run every suite and commit**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:rls && pnpm test:functions && pnpm test:e2e`
Expected: clean.

```bash
git add -A
git commit -m "feat(sync): PowerSync service, upload connector, and acceptance tests (FR-28, FR-30, NFR-1, NFR-5)"
```

---

### Task 7: CI and documentation

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `docs/adr/0007-web-first-delivery-via-expo-web.md`
- Modify: `docs/adr/README.md`, `docs/adr/0002-cross-platform-mobile-with-expo.md`, `docs/adr/0006-household-tenancy-with-rls.md`, `docs/SPEC.md`, `ARCHITECTURE.md`, `CLAUDE.md`, `README.md`

**Interfaces:**
- Consumes: every script defined in Tasks 1 to 6.

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
      - name: Start Supabase
        run: pnpm exec supabase start -x studio,imgproxy,logflare,vector,supavisor
      - run: node scripts/write-env.mjs
      - run: pnpm test:rls
      - run: pnpm test:functions

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
      - name: Start Supabase
        run: pnpm exec supabase start -x studio,imgproxy,logflare,vector,supavisor
      - run: node scripts/write-env.mjs
      - name: Start PowerSync
        run: |
          docker compose up -d
          node scripts/wait-for.mjs http://localhost:8080/probes/liveness 120
      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm test:e2e
      - name: PowerSync logs
        if: failure()
        run: docker compose logs powersync --tail 200
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: |
            playwright-report
            test-results
```

`pnpm/action-setup` reads the pnpm version from the `packageManager` field written in Task 1.

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

For local development the PowerSync service is **self-hosted in Docker** next to the Supabase CLI stack. Sync is defined with PowerSync **Sync Streams**.

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
- The app must be served over HTTPS (or `localhost`) for browser storage to work, so trying it on a phone needs a hosted environment. That, a service worker for cold-start offline, and Safari-specific storage options are a follow-up sub-project.
- The custom role claim is `household_role`, not `role`: Supabase reserves `role` in the JWT for the Postgres role. This corrects ADR-0006's wording.
- A role change takes effect only when the access token next refreshes (up to an hour). The roles and invites sub-project must handle this.
```

If Task 4 needed the generated-copy workaround for the domain package, add a Consequences bullet describing it.

- [ ] **Step 3: Update the existing documents**

`docs/adr/README.md`: add ADR-0007 to the index, in the same format as the existing entries.

`docs/adr/0002-cross-platform-mobile-with-expo.md`: change the status line to `- **Status:** Accepted, amended by 0007`.

`docs/adr/0006-household-tenancy-with-rls.md`: in the Decision paragraph, replace `` `household_id = auth.jwt() ->> 'household_id'`; write policies additionally exclude `role = 'viewer'` `` with `` `household_id = auth_household_id()`; write policies additionally require `auth_household_role()` to be `admin` or `member` ``, and replace ``The JWT carries `household_id` and `role` as custom claims set at sign-in.`` with ``The JWT carries `household_id` and `household_role` as custom claims added by an access-token hook (`role` is reserved by Supabase).``

`docs/SPEC.md`:
- Bump the status line to `Draft v0.2`.
- §3, replace the Platforms line with: `**Platforms (v1):** web first, as an installable web app built with Expo; native iOS and Android later from the same codebase (ADR-0007). Desktop later.`
- FR-1 row: `Sign up / sign in with an email one-time code` .
- FR-8 row: `Import from URL via paste; via OS share sheet on native builds only (ADR-0007)`.
- NFR-12 row: prefix the requirement with `Native builds only:`.

`ARCHITECTURE.md`:
- Bump the status line to `Proposed v0.2`.
- §0 drivers table, first row: Driver `Web first; iOS + Android later from one codebase`, Consequence `Cross-platform framework with a web target (ADR-0002, ADR-0007)`.
- §2 container diagram and table: Mobile App technology becomes `Expo / React Native Web, TypeScript`; On-device Database becomes `SQLite in the browser (via PowerSync web SDK)`; Auth description becomes `Sign-in (email one-time code); issues JWTs with household_id and household_role claims`.
- §2 responsibilities table, Auth row: `Identity; JWT custom claims household_id, household_role (added by an access-token hook)`.
- §5, replace the Environments paragraph with: `**Environments:** local (Supabase CLI in Docker, self-hosted PowerSync service in Docker, Expo web dev server at localhost). Staging and production, each a separate Supabase project and PowerSync instance with static web hosting, arrive with the hosting sub-project.`
- §6 conventions: the RLS bullet becomes ``RLS policy `household_id = auth_household_id()` ``.
- §7 Roles row: `` `household_role` claim in the JWT; RLS write policies require admin or member; UI hides edit affordances``.
- §9: `Current: ADR-0001 through ADR-0007.`

`CLAUDE.md`:
- Stack, first bullet: `` `apps/mobile` — Expo / React Native Web (web first, ADR-0007), TypeScript, Expo Router, PowerSync web SDK (SQLite in the browser) ``
- Replace the Commands block and remove the "Scaffolding not yet created" line:

```bash
pnpm install                 # install workspace
pnpm dev:backend             # Supabase + PowerSync in Docker; writes .env.local
pnpm dev:web                 # Expo web dev server at http://localhost:8081
pnpm db:reset                # re-apply migrations + seed (then: docker compose restart powersync)
pnpm test                    # unit tests
pnpm test:rls                # tenant isolation suite (needs dev:backend)
pnpm test:functions          # Edge Function tests (needs dev:backend)
pnpm test:e2e                # Playwright acceptance tests (needs dev:backend)
pnpm lint && pnpm typecheck
```

- Rule 1: append `New tables must also be added to supabase/tests/rls/registry.ts; the coverage guard fails otherwise.`
- Rule 6: append `` RLS lives in `supabase/migrations/`, sync config in `powersync/sync-config.yaml`. ``

`README.md`: add a "Getting started" section with the prerequisites (Node 22, Docker, `corepack enable`) and the first five commands above, and the four seeded sign-in emails with a note that codes arrive in the local mail catcher (`http://127.0.0.1:54324`).

- [ ] **Step 4: Verify everything from a clean state**

```bash
pnpm dev:backend:stop
pnpm install --frozen-lockfile
pnpm dev:backend
pnpm db:reset && docker compose restart powersync && node scripts/wait-for.mjs http://localhost:8080/probes/liveness
pnpm lint && pnpm typecheck && pnpm test && pnpm test:rls && pnpm test:functions && pnpm test:e2e
```

Expected: every command exits 0. Then confirm no secret is in the web bundle:

```bash
grep -rlE "service_role|SERVICE_ROLE|ANTHROPIC" apps/mobile/dist && echo "LEAK" || echo "clean"
```

Expected: `clean`.

- [ ] **Step 5: Commit and open the pull request**

```bash
git add -A
git commit -m "docs: ADR-0007 web-first delivery; ci: static, backend, and e2e jobs (NFR-1)"
git push -u origin feat/walking-skeleton
```

Pushing and opening a pull request are outward-facing: confirm with the owner before running `git push`. After the first CI run, report each job's result. If `e2e` is slow or flaky, report that with the failing output; do not mark it optional.

---

## Spec coverage

| Spec section | Task |
|---|---|
| §3 Repo layout, tooling, commands | 1, 2, 3, 6 |
| §4 Tables, sign-up trigger, token hook, RLS, server-owned fields, seed | 3 |
| §5 Sync config and RLS mirror, publication | 3 (publication), 6 |
| §6 Session, Database, Connector, Repository, Screens, sign-out wipe | 2, 5, 6 |
| §7 `/upload` contract and client handling | 4, 6 |
| §7 `packages/domain` | 1 |
| §8 Test layers and isolation cases 1 to 8 | 1, 3, 4, 5, 6 |
| §9 Acceptance criteria 1 to 6 | 5 (1, 5, 6), 6 (2, 3, 4) |
| §10 CI | 7 |
| §11 Documentation changes | 6 (`.env.example`), 7 |
| §13 Risks: PowerSync under Expo first; domain package under Deno | 2, 4 |
