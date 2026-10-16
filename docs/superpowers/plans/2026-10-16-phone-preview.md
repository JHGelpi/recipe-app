# Phone Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the web app installable on the owner's iPhone and able to open with no connection, without ever losing unsynced recipes when the session cannot be renewed.

**Architecture:** Workbox generates a precaching service worker after `expo export`; the app registers it in production builds and shows a reload banner when a new version is waiting. The local database moves to PowerSync's `OPFSCoopSyncVFS`. Two pure functions decide the session state (an offline renewal failure keeps the saved session) and when local data is wiped (only an explicit sign-out or a different user).

**Tech Stack:** Expo 57 (web, Metro, single output), React Native Web, `@powersync/web` 2.4, `@supabase/auth-js` 2.117 against GoTrue, `workbox-cli` 7.4, Caddy 2, Vitest, Playwright (Chromium).

**Spec:** `docs/superpowers/specs/2026-10-16-phone-preview-design.md`

## Global Constraints

- Shell commands are prefixed with `rtk` (CLAUDE.md). pnpm runs through corepack; on the owner's WSL machine a `pnpm` shim must be on `PATH`.
- This machine's `.env` has `PUBLIC_URL=http://localhost:8090`; tests read `PUBLIC_URL` and must not hard-code a port.
- The service worker registers only when `process.env.NODE_ENV === 'production'` and `'serviceWorker' in navigator`.
- The worker never handles `/auth`, `/api`, `/sync`, `/email-templates`, `/local-ca.crt`.
- Workbox options: `clientsClaim: true`, `skipWaiting: false`, `cleanupOutdatedCaches: true`, `maximumFileSizeToCacheInBytes` 5 MB, no `runtimeCaching`.
- Caddy: `/_expo/static/*` gets `Cache-Control: public, max-age=31536000, immutable`; every other web-app file gets `Cache-Control: no-cache`.
- Banner copy: "A new version is ready." with a "Reload" button.
- Open-failure copy: "This browser can't store recipes on this device. Private browsing isn't supported."
- Footer copy: "Build <YYYY-MM-DD HH:MM> · Storage: <persistent | best effort | unknown>"; `dev` stands in for the build time outside the proxy image.
- Manifest: `name` and `short_name` "Recipes", `display` `standalone`, `start_url` and `scope` `/`.
- Local data is wiped only on an explicit sign-out or when a different user signs in. The owner ID lives in `localStorage` under `recipes.dbOwner`.
- `workbox-cli` is the only new dependency (development, `apps/mobile`); it needs ADR-0009.
- Conventional Commits referencing FR-1, FR-28, NFR-4; commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Write messages to a file and use `git commit -F` (the RTK hook mangles heredocs).
- Never edit an applied migration (none are needed here).

## Review Focus

1. **Two tabs of the app open at once** (desktop browser): both must open the database and see the same recipes; OPFS cooperative locking must not hang either tab. Test in Task 1.
2. **Signing out while offline:** must still wipe local data and show the sign-in screen, because the user asked to. Test in Task 2.
3. **Opening the app offline when nobody has signed in:** the sign-in screen must load from the cache, and "Send code" must show the "Could not reach the server" message, not crash. Test in Task 4.
4. **The service worker must not answer API or auth requests** with the cached `index.html`: `/api/health` and `/auth/health` must still return JSON while the worker controls the page. Test in Task 4.
5. **The first install must not show the update banner;** only a replacement worker should. Test in Task 4 (unit).

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/mobile/src/db/database.web.ts` (modify) | Open the local database with `OPFSCoopSyncVFS` |
| `apps/mobile/src/db/DatabaseProvider.tsx` (modify) | Provide the database; show the open-failure message if it cannot open |
| `apps/mobile/src/session/sessionState.ts` (create) | Pure: `SessionState`, `sessionFromAuth`, `resolveSession`, `localDataAction` |
| `apps/mobile/src/session/sessionState.test.ts` (create) | Unit tests for the above |
| `apps/mobile/src/session/auth.ts` (modify) | Auth client with an explicit `AUTH_STORAGE_KEY`; `readSavedSession()` |
| `apps/mobile/src/session/SessionProvider.tsx` (modify) | Use `resolveSession`; mark sign-outs the user asked for |
| `apps/mobile/src/db/dbOwner.ts` (create) | Get, set, and clear the database owner's user ID in `localStorage` |
| `apps/mobile/src/db/DatabaseSessionBridge.tsx` (modify) | Apply `localDataAction`, then connect or disconnect |
| `apps/mobile/scripts/make-icons.py` (create) | One-off icon generator (Python PIL) |
| `apps/mobile/public/icons/*.png` (create) | Generated icons |
| `apps/mobile/public/manifest.webmanifest` (create) | Web app manifest |
| `apps/mobile/public/index.html` (create) | Expo single-output HTML template with manifest and iOS tags |
| `deploy/Caddyfile` (modify) | Cache headers |
| `apps/mobile/workbox.config.cjs` (create) | Workbox `generateSW` options |
| `apps/mobile/src/pwa/serviceWorker.ts` (create) | Register the worker; track a waiting update; apply it |
| `apps/mobile/src/pwa/serviceWorker.test.ts` (create) | Unit tests for update tracking |
| `apps/mobile/src/pwa/UpdateBanner.tsx` (create) | The reload banner |
| `apps/mobile/app/_layout.tsx` (modify) | Register the worker; render the banner |
| `apps/mobile/src/pwa/storageStatus.ts` (create) | Request persistent storage once; `useStorageStatus()` |
| `apps/mobile/src/components/BuildFooter.tsx` (create) | Build label and storage status |
| `apps/mobile/src/config.ts` (modify) | `buildTime` |
| `deploy/proxy.Dockerfile` (modify) | Set `EXPO_PUBLIC_BUILD_TIME` for the web build |
| `e2e/helpers.ts` (modify) | Shared `session`, `unique`, `revokeSession`, `expireSavedSession`, `waitForServiceWorker` |
| `e2e/storage.spec.ts`, `e2e/session.spec.ts`, `e2e/install.spec.ts`, `e2e/offline-start.spec.ts` (create) | New acceptance tests |
| `docs/adr/0009-installable-web-app-with-workbox.md` (create), `docs/adr/README.md`, `ARCHITECTURE.md`, `README.md` (modify) | Documentation |

---

### Task 1: OPFS storage mode and the open-failure message

The spec's riskiest assumption: `OPFSCoopSyncVFS` works with the worker files `copy-assets` already provides. Prove it first.

**Files:**
- Modify: `apps/mobile/src/db/database.web.ts`
- Modify: `apps/mobile/src/db/DatabaseProvider.tsx`
- Test: `e2e/storage.spec.ts`

**Interfaces:**
- Consumes: `signIn`, `addRecipe`, `freshEmail` from `e2e/helpers.ts`.
- Produces: the database is stored in OPFS (later tasks' e2e runs on it). `DatabaseProvider` renders the failure copy instead of its children when `database.waitForReady()` rejects.

- [ ] **Step 1: Write the failing tests**

`e2e/storage.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { addRecipe, freshEmail, signIn } from './helpers';

const CANNOT_STORE =
  "This browser can't store recipes on this device. Private browsing isn't supported.";

test('the local database is stored in OPFS', async ({ page }) => {
  await signIn(page, freshEmail('opfs'));
  await addRecipe(page, 'Stored soup');
  const names = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const found: string[] = [];
    // keys() is an async iterator; the DOM typings in this project lack it.
    for await (const name of (root as unknown as { keys(): AsyncIterable<string> }).keys()) {
      found.push(name);
    }
    return found;
  });
  expect(names.some((name) => name.includes('recipes.db'))).toBe(true);
});

test('two tabs of the app share the database', async ({ context }) => {
  const first = await context.newPage();
  await signIn(first, freshEmail('tabs'));
  await addRecipe(first, 'First tab tart');

  const second = await context.newPage();
  await second.goto('/');
  await expect(second.getByText('First tab tart', { exact: true })).toBeVisible({ timeout: 30_000 });
  await addRecipe(second, 'Second tab tart');
  await expect(first.getByText('Second tab tart', { exact: true })).toBeVisible({ timeout: 30_000 });
});

test('a browser that cannot open the local database shows a message', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  // Without its worker the database cannot open, as in Safari private browsing.
  await context.route('**/@powersync/worker.js', (route) => route.abort());
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.getByText(CANNOT_STORE)).toBeVisible({ timeout: 30_000 });
  await context.close();
});
```

- [ ] **Step 2: Run the tests and confirm the first and third fail**

Run: `rtk pnpm test:e2e e2e/storage.spec.ts`
Expected: "is stored in OPFS" fails (`expect(...).toBe(true)` received `false`; the data is in IndexedDB). "cannot open" fails (the message never appears). "two tabs" may already pass on IndexedDB in Chromium; it becomes the guard for OPFS locking (Review Focus 1).

- [ ] **Step 3: Switch the storage mode**

`apps/mobile/src/db/database.web.ts`:

```ts
import {
  createConsoleLogger,
  PowerSyncDatabase,
  WASQLiteOpenFactory,
  WASQLiteVFS,
} from '@powersync/web';
import type { AbstractPowerSyncDatabase } from '@powersync/web';
import { AppSchema } from './schema';

// Prebuilt worker copied into public/ by `pnpm run copy-assets`.
const WORKER = '/@powersync/worker.js';

const logger = createConsoleLogger();

export function openDatabase(): AbstractPowerSyncDatabase {
  const factory = new WASQLiteOpenFactory({
    logger,
    // PowerSync recommends OPFSCoopSyncVFS for Safari/iOS; using it on every
    // browser means the Chromium e2e suite tests what the phone runs.
    // The SDK switches to dedicated workers, which this VFS requires.
    open: { dbFilename: 'recipes.db', worker: WORKER, vfs: WASQLiteVFS.OPFSCoopSyncVFS },
  });
  return new PowerSyncDatabase({
    schema: AppSchema,
    factory,
    sync: { worker: WORKER },
    logger,
  });
}
```

If TypeScript rejects `vfs` inside `open`, move it to the top level of the `WASQLiteOpenFactory` options (the README example passes `vfs` beside `dbFilename`); check `WASQLiteOpenFactoryOptions` in `node_modules/@powersync/web/lib/db/adapters/wa-sqlite/WASQLiteOpenFactory.d.ts`.

- [ ] **Step 4: Show the failure message**

`apps/mobile/src/db/DatabaseProvider.tsx`:

```tsx
import { PowerSyncContext } from '@powersync/react';
import { useEffect, useState, type ReactNode } from 'react';
import { Text, View } from 'react-native';
import { openDatabase } from './database';

const database = openDatabase();

export function DatabaseProvider({ children }: { children: ReactNode }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    database.waitForReady().catch((error: unknown) => {
      console.error('The local database could not open', error);
      setFailed(true);
    });
  }, []);

  if (failed) {
    return (
      <View style={{ padding: 16, maxWidth: 480 }}>
        <Text role="alert">
          This browser can&apos;t store recipes on this device. Private browsing isn&apos;t
          supported.
        </Text>
      </View>
    );
  }
  return <PowerSyncContext.Provider value={database}>{children}</PowerSyncContext.Provider>;
}
```

If `waitForReady()` does not reject when the worker fails to load (the e2e test still times out), listen for the failure where it surfaces: log `database` events with `database.registerListener({ statusChanged: console.log })` in a scratch run, and use the error the SDK reports. Do not add a timeout-based guess.

- [ ] **Step 5: Run the new tests and the whole e2e suite**

Run: `rtk pnpm test:e2e`
Expected: all 16 tests pass (13 existing + 3 new). `test:e2e` rebuilds the proxy image, so the web bundle includes the change.

If the OPFS test finds no `recipes.db` entry, print `names` and adjust the assertion to the directory or file name the VFS uses; the point is that the data is in OPFS, not the exact name.

- [ ] **Step 6: Lint, typecheck, unit tests, commit**

Run: `rtk pnpm lint && rtk pnpm typecheck && rtk pnpm test`
Expected: all exit 0.

```bash
rtk git add apps/mobile/src/db/database.web.ts apps/mobile/src/db/DatabaseProvider.tsx e2e/storage.spec.ts
rtk proxy git commit -q -F <message file>
```

Message: `feat(app): store the local database in OPFS for Safari (FR-28, NFR-4)`, with a body noting the PowerSync recommendation, the private-browsing message, and the test counts.

---

### Task 2: Stay signed in offline; wipe only on sign-out or a different user

**Files:**
- Create: `apps/mobile/src/session/sessionState.ts`
- Test: `apps/mobile/src/session/sessionState.test.ts`
- Modify: `apps/mobile/src/session/auth.ts`
- Modify: `apps/mobile/src/session/SessionProvider.tsx`
- Create: `apps/mobile/src/db/dbOwner.ts`
- Modify: `apps/mobile/src/db/DatabaseSessionBridge.tsx`
- Modify: `e2e/helpers.ts`, `e2e/sync.spec.ts`
- Test: `e2e/session.spec.ts`

**Interfaces:**
- Consumes: `claimsFromToken(token: string): Claims | null` from `session/claims.ts`; `isAuthRetryableFetchError` and `Session` from `@supabase/auth-js`.
- Produces:
  - `type SessionState = { status: 'loading' } | { status: 'signedOut'; byUser: boolean } | { status: 'signedIn'; userId: string; claims: Claims | null; stale: boolean }`
  - `sessionFromAuth(session: Session): SessionState` (signed in, `stale: false`)
  - `resolveSession(result: { data: { session: Session | null }; error: unknown }, saved: unknown): SessionState`
  - `type SettledSession = { status: 'signedIn'; userId: string } | { status: 'signedOut'; byUser: boolean }`
  - `localDataAction(session: SettledSession, owner: string | null): 'wipe' | 'keep'`
  - `AUTH_STORAGE_KEY = 'supabase.auth.token'` and `readSavedSession(): unknown` from `session/auth.ts`
  - `dbOwner.get(): string | null`, `dbOwner.set(userId: string): void`, `dbOwner.clear(): void`
  - e2e helpers: `session(browser, email): Promise<Page>`, `unique(prefix): string`, `revokeSession(page): Promise<void>`, `expireSavedSession(page): Promise<void>`

- [ ] **Step 1: Write the failing unit tests**

`apps/mobile/src/session/sessionState.test.ts`:

```ts
import { AuthApiError, AuthRetryableFetchError, type Session } from '@supabase/auth-js';
import { describe, expect, it } from 'vitest';
import { localDataAction, resolveSession, sessionFromAuth } from './sessionState';

function token(payload: object): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode(payload)}.signature`;
}

const ACCESS = token({ sub: 'user-1', household_id: 'house-1', household_role: 'viewer' });
const CLAIMS = { userId: 'user-1', householdId: 'house-1', role: 'viewer' };

// Only the fields the app reads; auth-js sessions carry more.
const session = { access_token: ACCESS, user: { id: 'user-1' } } as unknown as Session;
const saved = { access_token: ACCESS, refresh_token: 'r', expires_at: 1, user: { id: 'user-1' } };
const offline = new AuthRetryableFetchError('Failed to fetch', 0);

describe('resolveSession', () => {
  it('is signed in when auth-js returns a session', () => {
    expect(resolveSession({ data: { session }, error: null }, null)).toEqual({
      status: 'signedIn',
      userId: 'user-1',
      claims: CLAIMS,
      stale: false,
    });
  });

  it('keeps the saved session, marked stale, when renewal fails on the network', () => {
    expect(resolveSession({ data: { session: null }, error: offline }, saved)).toEqual({
      status: 'signedIn',
      userId: 'user-1',
      claims: CLAIMS,
      stale: true,
    });
  });

  it('is signed out after a network failure when nothing is saved', () => {
    expect(resolveSession({ data: { session: null }, error: offline }, null)).toEqual({
      status: 'signedOut',
      byUser: false,
    });
  });

  it('is signed out after a network failure when the saved session is malformed', () => {
    expect(
      resolveSession({ data: { session: null }, error: offline }, { access_token: 42 }),
    ).toEqual({ status: 'signedOut', byUser: false });
  });

  it('is signed out when the server rejects the session', () => {
    const rejected = new AuthApiError('Invalid Refresh Token', 400, 'refresh_token_not_found');
    expect(resolveSession({ data: { session: null }, error: rejected }, saved)).toEqual({
      status: 'signedOut',
      byUser: false,
    });
  });
});

describe('sessionFromAuth', () => {
  it('reads the user and claims from a live session', () => {
    expect(sessionFromAuth(session)).toEqual({
      status: 'signedIn',
      userId: 'user-1',
      claims: CLAIMS,
      stale: false,
    });
  });
});

describe('localDataAction', () => {
  it('wipes when the user signs out', () => {
    expect(localDataAction({ status: 'signedOut', byUser: true }, 'user-1')).toBe('wipe');
  });

  it('keeps data when the session ends without the user asking', () => {
    expect(localDataAction({ status: 'signedOut', byUser: false }, 'user-1')).toBe('keep');
  });

  it('keeps data when the owner signs back in', () => {
    expect(localDataAction({ status: 'signedIn', userId: 'user-1' }, 'user-1')).toBe('keep');
  });

  it('wipes when a different user signs in', () => {
    expect(localDataAction({ status: 'signedIn', userId: 'user-2' }, 'user-1')).toBe('wipe');
  });

  it('keeps data when no owner is recorded', () => {
    expect(localDataAction({ status: 'signedIn', userId: 'user-2' }, null)).toBe('keep');
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `rtk vitest run apps/mobile/src/session/sessionState.test.ts`
Expected: FAIL, "Failed to resolve import ./sessionState".

- [ ] **Step 3: Implement the decisions**

`apps/mobile/src/session/sessionState.ts`:

```ts
import { isAuthRetryableFetchError, type Session } from '@supabase/auth-js';
import { claimsFromToken, type Claims } from './claims';

export type SessionState =
  | { status: 'loading' }
  | { status: 'signedOut'; byUser: boolean }
  | { status: 'signedIn'; userId: string; claims: Claims | null; stale: boolean };

/** A session state the database bridge acts on. */
export type SettledSession =
  | { status: 'signedIn'; userId: string }
  | { status: 'signedOut'; byUser: boolean };

type GetSessionResult = { data: { session: Session | null }; error: unknown };

export function sessionFromAuth(session: Session): SessionState {
  return {
    status: 'signedIn',
    userId: session.user.id,
    claims: claimsFromToken(session.access_token),
    stale: false,
  };
}

function savedUser(saved: unknown): { userId: string; accessToken: string } | null {
  if (typeof saved !== 'object' || saved === null) return null;
  const { access_token, user } = saved as { access_token?: unknown; user?: { id?: unknown } };
  if (typeof access_token !== 'string' || typeof user?.id !== 'string') return null;
  return { userId: user.id, accessToken: access_token };
}

/**
 * The state after start-up. When the access token has expired and renewing it
 * fails because the network is unreachable, auth-js returns no session but
 * keeps the saved one; the app stays signed in from it (marked stale) so an
 * offline start does not sign the user out. The server still checks a fresh
 * token on every request.
 */
export function resolveSession(result: GetSessionResult, saved: unknown): SessionState {
  if (result.data.session) return sessionFromAuth(result.data.session);
  if (isAuthRetryableFetchError(result.error)) {
    const user = savedUser(saved);
    if (user) {
      return {
        status: 'signedIn',
        userId: user.userId,
        claims: claimsFromToken(user.accessToken),
        stale: true,
      };
    }
  }
  return { status: 'signedOut', byUser: false };
}

/**
 * Local data is wiped only when the user signs out, or when someone other
 * than the recorded owner signs in. A session the server ended keeps the
 * data, so unsynced recipes upload once the same user signs back in.
 */
export function localDataAction(session: SettledSession, owner: string | null): 'wipe' | 'keep' {
  if (session.status === 'signedOut') return session.byUser ? 'wipe' : 'keep';
  return owner !== null && owner !== session.userId ? 'wipe' : 'keep';
}
```

- [ ] **Step 4: Run the unit tests and confirm they pass**

Run: `rtk vitest run apps/mobile/src/session/sessionState.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Expose the saved session**

`apps/mobile/src/session/auth.ts`:

```ts
import { AuthClient } from '@supabase/auth-js';
import { config } from '../config';

// auth-js's default key, named so the app can read the saved session when
// renewing it fails offline. Changing it would sign every device out.
export const AUTH_STORAGE_KEY = 'supabase.auth.token';

// GoTrue's client library, used for authentication only. Recipe data goes
// through the local database.
export const auth = new AuthClient({
  url: config.authUrl,
  storageKey: AUTH_STORAGE_KEY,
  persistSession: true,
  autoRefreshToken: true,
  detectSessionInUrl: false,
});

/** The session auth-js saved, as stored; undefined shapes are checked by the caller. */
export function readSavedSession(): unknown {
  try {
    const raw = globalThis.localStorage?.getItem(AUTH_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 6: Use the decisions in `SessionProvider`**

In `apps/mobile/src/session/SessionProvider.tsx`:

Replace the imports and the local `SessionState` type and `toState` function with:

```tsx
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { auth, readSavedSession } from './auth';
import { normalizeEmail } from './email';
import { resolveSession, sessionFromAuth, type SessionState } from './sessionState';

export type { SessionState } from './sessionState';
```

Replace the provider's state and effect with:

```tsx
  const [state, setState] = useState<SessionState>({ status: 'loading' });
  // Set while the user's own sign-out runs, so the bridge knows to wipe.
  const signingOut = useRef(false);

  useEffect(() => {
    void auth.getSession().then((result) => setState(resolveSession(result, readSavedSession())));
    const { data } = auth.onAuthStateChange((event, session) => {
      // getSession above decides the start-up state, including the offline case.
      if (event === 'INITIAL_SESSION') return;
      if (session) {
        setState(sessionFromAuth(session));
      } else if (event === 'SIGNED_OUT') {
        setState({ status: 'signedOut', byUser: signingOut.current });
        signingOut.current = false;
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);
```

Replace `signOut` in the `useMemo` value with:

```tsx
      async signOut() {
        signingOut.current = true;
        // scope 'local' clears this device's session even when offline.
        await auth.signOut({ scope: 'local' });
      },
```

Leave `requestCode`, `verifyCode`, `useSession`, and the `UNREACHABLE` message unchanged. `app/index.tsx` and `app/sign-in.tsx` only read `state.status` and `state.claims`, so they need no change.

- [ ] **Step 7: Record the database owner**

`apps/mobile/src/db/dbOwner.ts`:

```ts
// The user whose data the local database holds. An ID, not a secret.
const KEY = 'recipes.dbOwner';

function storage(): Storage | undefined {
  return globalThis.localStorage;
}

export const dbOwner = {
  get(): string | null {
    return storage()?.getItem(KEY) ?? null;
  },
  set(userId: string): void {
    storage()?.setItem(KEY, userId);
  },
  clear(): void {
    storage()?.removeItem(KEY);
  },
};
```

- [ ] **Step 8: Apply the decision in the bridge**

`apps/mobile/src/db/DatabaseSessionBridge.tsx`:

```tsx
import { usePowerSync } from '@powersync/react';
import { useEffect, useRef } from 'react';
import { localDataAction, type SettledSession } from '../session/sessionState';
import { useSession } from '../session/SessionProvider';
import { createConnector } from '../sync/connector';
import { dbOwner } from './dbOwner';
import { useNetworkOnline } from './useNetworkOnline';

const connector = createConnector();

/**
 * Keeps the local database in step with the session and the network.
 * - Local data is wiped only when the user signs out, or when a different
 *   user signs in (localDataAction). A session the server ended keeps it.
 * - Signed in with a household and online: connect, so sync and uploads run.
 * - Signed in but offline: disconnect, keeping local data and the queue. An
 *   open sync stream does not fail when the network drops, so without this
 *   the app would show Online and wait on PowerSync's backoff to reconnect.
 * - Signed out: disconnect.
 */
export function DatabaseSessionBridge() {
  const db = usePowerSync();
  const { state } = useSession();
  const online = useNetworkOnline();
  const status = state.status;
  const userId = state.status === 'signedIn' ? state.userId : null;
  const hasHousehold = state.status === 'signedIn' && state.claims !== null;
  const byUser = state.status === 'signedOut' && state.byUser;
  // Serialise transitions so a wipe always finishes before the next connect.
  const queue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    if (status === 'loading') return;
    const session: SettledSession =
      status === 'signedIn' && userId !== null
        ? { status: 'signedIn', userId }
        : { status: 'signedOut', byUser };
    queue.current = queue.current
      .then(async () => {
        if (localDataAction(session, dbOwner.get()) === 'wipe') {
          await db.disconnectAndClear();
          dbOwner.clear();
        }
        if (session.status === 'signedIn' && hasHousehold && online) {
          dbOwner.set(session.userId);
          await db.connect(connector);
        } else {
          await db.disconnect();
        }
      })
      .catch((error: unknown) => console.error('Database session change failed', error));
  }, [db, status, userId, hasHousehold, byUser, online]);

  return null;
}
```

The dependencies are primitives on purpose: a token refresh creates a new state object, and reconnecting on every refresh would restart sync.

- [ ] **Step 9: Share the e2e helpers**

In `e2e/helpers.ts`, change the first import line to:

```ts
import { expect, type Browser, type Page } from '@playwright/test';
```

and append:

```ts
const AUTH_STORAGE_KEY = 'supabase.auth.token';

/** A signed-in page in its own browser context, as on its own device. */
export async function session(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, email);
  return page;
}

export function unique(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Ends every session of the page's user on the server, as an admin revoking it would. */
export async function revokeSession(page: Page): Promise<void> {
  const accessToken = await page.evaluate((key) => {
    const saved = JSON.parse(localStorage.getItem(key) ?? 'null') as { access_token?: string };
    return saved?.access_token ?? '';
  }, AUTH_STORAGE_KEY);
  const response = await fetch(`${env.authUrl}/logout?scope=global`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  expect(response.status).toBe(204);
}

/** Moves the saved access token's expiry into the past, so the next start must renew it. */
export async function expireSavedSession(page: Page): Promise<void> {
  await page.evaluate((key) => {
    const saved = JSON.parse(localStorage.getItem(key) ?? 'null') as { expires_at?: number };
    if (!saved) throw new Error('No saved session');
    saved.expires_at = Math.floor(Date.now() / 1000) - 60;
    localStorage.setItem(key, JSON.stringify(saved));
  }, AUTH_STORAGE_KEY);
}
```

In `e2e/sync.spec.ts`, delete the local `session` and `unique` functions, and change the imports to:

```ts
import { expect, test } from '@playwright/test';
import { addRecipe, SEED, session, unique } from './helpers';
```

- [ ] **Step 10: Write the session e2e tests**

`e2e/session.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import {
  addRecipe,
  expireSavedSession,
  freshEmail,
  revokeSession,
  session,
  signIn,
  unique,
} from './helpers';

test('when the server ends the session, unsynced recipes survive and upload after the same user signs back in', async ({
  browser,
}) => {
  const email = freshEmail('revoked');
  const page = await session(browser, email);
  const context = page.context();
  await expect(page.getByText(/^Online · /)).toBeVisible({ timeout: 30_000 });

  // Hold uploads so the recipe stays unsynced while online.
  await context.route('**/api/upload', (route) => route.abort());
  const title = unique('Kept casserole');
  await addRecipe(page, title);
  await expect(page.getByText(/· 1 unsynced$/)).toBeVisible({ timeout: 30_000 });

  await revokeSession(page);
  await expireSavedSession(page);
  await page.reload();
  await expect(page.getByLabel('Email')).toBeVisible({ timeout: 30_000 });

  await context.unroute('**/api/upload');
  await signIn(page, email);
  await expect(page.getByText(title, { exact: true })).toBeVisible();
  await expect(page.getByText('Online · 0 unsynced')).toBeVisible({ timeout: 45_000 });

  // The server has it: a fresh device for the same user receives it.
  const other = await session(browser, email);
  await expect(other.getByText(title, { exact: true })).toBeVisible({ timeout: 30_000 });
});

test('when the server ends the session and a different user signs in, the old data is wiped first', async ({
  browser,
}) => {
  const page = await session(browser, freshEmail('previous'));
  const title = unique('Private pie');
  await addRecipe(page, title);
  await expect(page.getByText('Online · 0 unsynced')).toBeVisible({ timeout: 30_000 });

  await revokeSession(page);
  await expireSavedSession(page);
  await page.reload();
  await expect(page.getByLabel('Email')).toBeVisible({ timeout: 30_000 });

  await signIn(page, freshEmail('next'));
  await expect(page.getByText('No recipes yet')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(title)).toHaveCount(0);
});

test('signing out while offline still wipes the local data', async ({ browser }) => {
  const page = await session(browser, freshEmail('offline-out'));
  const title = unique('Forgotten fudge');
  await addRecipe(page, title);
  await expect(page.getByText('Online · 0 unsynced')).toBeVisible({ timeout: 30_000 });

  await page.context().setOffline(true);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByLabel('Email')).toBeVisible();

  await page.context().setOffline(false);
  await signIn(page, freshEmail('after-offline-out'));
  await expect(page.getByText('No recipes yet')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(title)).toHaveCount(0);
});
```

- [ ] **Step 11: Run the session tests against the old bridge to see the first one fail**

Stash the bridge and provider changes only, so the old wipe-on-any-sign-out behaviour is built:

```bash
rtk proxy git stash push apps/mobile/src/db/DatabaseSessionBridge.tsx apps/mobile/src/session/SessionProvider.tsx
rtk pnpm test:e2e e2e/session.spec.ts
rtk proxy git stash pop
```

Expected while stashed: the first test fails at `getByText(title)` after signing back in (the old code wiped the data on the involuntary sign-out). The other two pass. Typecheck errors from the stash do not stop Metro's build; if they do, skip this step and note it in the commit body.

- [ ] **Step 12: Run everything**

Run: `rtk pnpm lint && rtk pnpm typecheck && rtk pnpm test && rtk pnpm test:e2e`
Expected: all exit 0; unit 89 (78 + 11); e2e 19 (16 + 3).

- [ ] **Step 13: Commit**

```bash
rtk git add apps/mobile/src/session apps/mobile/src/db e2e
rtk proxy git commit -q -F <message file>
```

Message: `fix(app): keep the session and unsynced recipes when renewal fails or the server ends the session (FR-1, FR-28, NFR-4)`.

---

### Task 3: Installable app: manifest, icons, HTML template, cache headers

**Files:**
- Create: `apps/mobile/scripts/make-icons.py`
- Create: `apps/mobile/public/icons/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`
- Create: `apps/mobile/public/manifest.webmanifest`
- Create: `apps/mobile/public/index.html`
- Modify: `apps/mobile/app.json`
- Modify: `deploy/Caddyfile`
- Test: `e2e/install.spec.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `/manifest.webmanifest`, `/icons/*`, the HTML tags, and the cache headers that Task 4's `sw.js` relies on (`no-cache`).

- [ ] **Step 1: Write the failing tests**

`e2e/install.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

test('the manifest makes the app installable', async ({ request }) => {
  const response = await request.get('/manifest.webmanifest');
  expect(response.ok()).toBe(true);
  const manifest = (await response.json()) as {
    name: string;
    short_name: string;
    display: string;
    start_url: string;
    scope: string;
    icons: { src: string; sizes: string; purpose?: string }[];
  };
  expect(manifest).toMatchObject({
    name: 'Recipes',
    short_name: 'Recipes',
    display: 'standalone',
    start_url: '/',
    scope: '/',
  });
  expect(manifest.icons.map((icon) => icon.sizes)).toEqual(
    expect.arrayContaining(['192x192', '512x512']),
  );
  expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
  for (const icon of manifest.icons) {
    const image = await request.get(icon.src);
    expect(image.headers()['content-type'], icon.src).toBe('image/png');
  }
});

test('the page links the manifest and the iOS home-screen icon', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    'href',
    '/manifest.webmanifest',
  );
  const touchIcon = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
  expect(touchIcon).toBe('/icons/apple-touch-icon.png');
  expect((await request.get(touchIcon ?? '')).headers()['content-type']).toBe('image/png');
  await expect(page.locator('meta[name="theme-color"]')).toHaveCount(1);
  await expect(page).toHaveTitle('Recipes');
});

test('the page is revalidated and hashed bundles are cached for good', async ({ page, request }) => {
  expect((await request.get('/')).headers()['cache-control']).toBe('no-cache');
  expect((await request.get('/sign-in')).headers()['cache-control']).toBe('no-cache');
  await page.goto('/');
  const bundle = await page.locator('script[src^="/_expo/static/"]').first().getAttribute('src');
  expect((await request.get(bundle ?? '')).headers()['cache-control']).toBe(
    'public, max-age=31536000, immutable',
  );
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `rtk pnpm test:e2e e2e/install.spec.ts`
Expected: all three fail (the manifest request returns the app's `index.html`, so `response.json()` throws; no `link[rel="manifest"]`; no `cache-control` header).

- [ ] **Step 3: Generate the icons**

`apps/mobile/scripts/make-icons.py`:

```python
"""Generates the web app icons from assets/icon.png (run once; output is committed).

Usage, from apps/mobile: python3 scripts/make-icons.py
"""
from pathlib import Path

from PIL import Image

SOURCE = Path("assets/icon.png")
OUT = Path("public/icons")
# The Expo placeholder's background, so the maskable padding blends in.
BACKGROUND = (230, 244, 253)


def resized(size: int) -> Image.Image:
    return Image.open(SOURCE).convert("RGB").resize((size, size), Image.LANCZOS)


def maskable(size: int) -> Image.Image:
    # Android may crop to a circle: keep the artwork inside the central 80%.
    canvas = Image.new("RGB", (size, size), BACKGROUND)
    inner = int(size * 0.8)
    offset = (size - inner) // 2
    canvas.paste(resized(inner), (offset, offset))
    return canvas


OUT.mkdir(parents=True, exist_ok=True)
resized(192).save(OUT / "icon-192.png", optimize=True)
resized(512).save(OUT / "icon-512.png", optimize=True)
maskable(512).save(OUT / "icon-maskable-512.png", optimize=True)
resized(180).save(OUT / "apple-touch-icon.png", optimize=True)
print("wrote", sorted(path.name for path in OUT.iterdir()))
```

Run: `cd apps/mobile && python3 scripts/make-icons.py`
Expected: `wrote ['apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png']`.

- [ ] **Step 4: Write the manifest**

`apps/mobile/public/manifest.webmanifest`:

```json
{
  "name": "Recipes",
  "short_name": "Recipes",
  "description": "Your household's recipes, on and offline.",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#1a5d3a",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    {
      "src": "/icons/icon-maskable-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "maskable"
    }
  ]
}
```

Caddy serves `.webmanifest` as `application/manifest+json`; if it does not, add `header /manifest.webmanifest Content-Type application/manifest+json` in Step 7.

- [ ] **Step 5: Write the HTML template**

`apps/mobile/public/index.html` (Expo uses `public/index.html` as the template for single-output web builds and injects the scripts and favicon link itself):

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
    <!-- viewport-fit=cover lets the app fill the screen around the iPhone notch. -->
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover"
    />
    <title>Recipes</title>
    <link rel="manifest" href="/manifest.webmanifest" />
    <!-- iOS takes the home-screen icon from this tag, not the manifest. -->
    <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
    <meta name="theme-color" content="#1a5d3a" />
    <meta name="apple-mobile-web-app-title" content="Recipes" />
    <!-- The `react-native-web` recommended style reset: https://necolas.github.io/react-native-web/docs/setup/#root-element -->
    <style id="expo-reset">
      /* These styles make the body full-height */
      html,
      body {
        height: 100%;
      }
      /* These styles disable body scrolling if you are using <ScrollView> */
      body {
        overflow: hidden;
      }
      /* These styles make the root element full-height */
      #root {
        display: flex;
        height: 100%;
        flex: 1;
      }
    </style>
  </head>

  <body>
    <noscript>You need to enable JavaScript to run this app.</noscript>
    <!-- The root element for your Expo app. -->
    <div id="root"></div>
  </body>
</html>
```

In `apps/mobile/app.json`, change `"name": "mobile"` to `"name": "Recipes"` so Expo's own title and metadata match.

- [ ] **Step 6: Check Expo used the template**

Run: `cd apps/mobile && rtk pnpm run build:web && rtk proxy grep -c "manifest.webmanifest" dist/index.html && ls dist/icons dist/manifest.webmanifest`
Expected: `1`, the four icons, and the manifest. If the count is `0`, Expo ignored the template: check `npx expo customize --help` for the template path this SDK expects and move the file there.

- [ ] **Step 7: Add the cache headers**

In `deploy/Caddyfile`, inside the `(app)` snippet's `route`, replace the final `handle { ... }` block with:

```caddyfile
		# Content-hashed bundle names: safe to cache for good.
		handle /_expo/static/* {
			root * /srv/web
			header Cache-Control "public, max-age=31536000, immutable"
			file_server
		}
		# Everything else of the web app, including sw.js and index.html under
		# any app path, is revalidated on each load. Headers are set before the
		# index.html fallback rewrite, so app paths cannot be matched by name.
		handle {
			root * /srv/web
			header Cache-Control "no-cache"
			try_files {path} /index.html
			file_server
		}
```

- [ ] **Step 8: Run the tests and confirm they pass**

Run: `rtk pnpm test:e2e e2e/install.spec.ts`
Expected: 3 passed.

- [ ] **Step 9: Run everything and commit**

Run: `rtk pnpm lint && rtk pnpm typecheck && rtk pnpm test && rtk pnpm test:e2e`
Expected: all exit 0; e2e 22.

If `prettier --check` flags `public/index.html` or the manifest, run `rtk pnpm format` and re-check.

```bash
rtk git add apps/mobile/scripts apps/mobile/public/icons apps/mobile/public/manifest.webmanifest apps/mobile/public/index.html apps/mobile/app.json deploy/Caddyfile e2e/install.spec.ts
rtk proxy git commit -q -F <message file>
```

Message: `feat(app): web app manifest, icons, and cache headers for Add to Home Screen (NFR-4)`.

---

### Task 4: The service worker and the update banner

**Files:**
- Modify: `apps/mobile/package.json` (dependency and `build:web`)
- Create: `apps/mobile/workbox.config.cjs`
- Create: `apps/mobile/src/pwa/serviceWorker.ts`
- Test: `apps/mobile/src/pwa/serviceWorker.test.ts`
- Create: `apps/mobile/src/pwa/UpdateBanner.tsx`
- Modify: `apps/mobile/app/_layout.tsx`
- Modify: `e2e/helpers.ts`
- Test: `e2e/offline-start.spec.ts`

**Interfaces:**
- Consumes: Task 2's `session`, `unique`, `expireSavedSession`, `freshEmail`, `signIn`, `addRecipe`, `SEED` helpers; Task 3's `no-cache` on `/sw.js`; Task 2's stale-session behaviour.
- Produces:
  - `registerServiceWorker(): Promise<void>`
  - `watchRegistration(registration: RegistrationLike, hasController: () => boolean): void`
  - `subscribeUpdate(listener: () => void): () => void`, `updateReady(): boolean`, `applyUpdate(): void`, `resetUpdateStateForTests(): void`
  - `UpdateBanner` component
  - e2e helper `waitForServiceWorker(page: Page): Promise<void>`

- [ ] **Step 1: Write the failing unit tests**

`apps/mobile/src/pwa/serviceWorker.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { resetUpdateStateForTests, updateReady, watchRegistration } from './serviceWorker';

class FakeWorker extends EventTarget {
  state = 'installing';
  postMessage(): void {}
  finishInstalling(): void {
    this.state = 'installed';
    this.dispatchEvent(new Event('statechange'));
  }
}

class FakeRegistration extends EventTarget {
  waiting: FakeWorker | null = null;
  installing: FakeWorker | null = null;
  async update(): Promise<void> {}
  startUpdate(worker: FakeWorker): void {
    this.installing = worker;
    this.dispatchEvent(new Event('updatefound'));
  }
}

afterEach(() => resetUpdateStateForTests());

describe('watchRegistration', () => {
  it('reports a worker that is already waiting when the page has a controller', () => {
    const registration = new FakeRegistration();
    registration.waiting = new FakeWorker();
    watchRegistration(registration, () => true);
    expect(updateReady()).toBe(true);
  });

  it('does not report the first install, when nothing controls the page yet', () => {
    const registration = new FakeRegistration();
    const worker = new FakeWorker();
    watchRegistration(registration, () => false);
    registration.startUpdate(worker);
    registration.waiting = worker;
    worker.finishInstalling();
    expect(updateReady()).toBe(false);
  });

  it('reports a replacement worker once it finishes installing', () => {
    const registration = new FakeRegistration();
    const worker = new FakeWorker();
    watchRegistration(registration, () => true);
    registration.startUpdate(worker);
    expect(updateReady()).toBe(false);
    registration.waiting = worker;
    worker.finishInstalling();
    expect(updateReady()).toBe(true);
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `rtk vitest run apps/mobile/src/pwa/serviceWorker.test.ts`
Expected: FAIL, "Failed to resolve import ./serviceWorker".

- [ ] **Step 3: Implement registration and update tracking**

`apps/mobile/src/pwa/serviceWorker.ts`:

```ts
// Registers the Workbox-generated worker (ADR-0009) and tracks a new version
// waiting to take over. Uses the browser API directly, so Workbox adds
// nothing to the app at runtime.

export type WorkerLike = EventTarget & {
  state: string;
  postMessage(message: unknown): void;
};

export type RegistrationLike = EventTarget & {
  waiting: WorkerLike | null;
  installing: WorkerLike | null;
  update(): Promise<unknown>;
};

let waiting: WorkerLike | null = null;
const listeners = new Set<() => void>();

function setWaiting(worker: WorkerLike | null): void {
  waiting = worker;
  listeners.forEach((listener) => listener());
}

export function subscribeUpdate(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function updateReady(): boolean {
  return waiting !== null;
}

export function resetUpdateStateForTests(): void {
  waiting = null;
  listeners.clear();
}

/**
 * Reports a worker that is installed and waiting to replace the one in
 * control. The first install has nothing to replace (no controller), so it
 * is not reported.
 */
export function watchRegistration(
  registration: RegistrationLike,
  hasController: () => boolean,
): void {
  const check = () => {
    if (registration.waiting && hasController()) setWaiting(registration.waiting);
  };
  check();
  registration.addEventListener('updatefound', () => {
    const installing = registration.installing;
    installing?.addEventListener('statechange', () => {
      if (installing.state === 'installed') check();
    });
  });
}

/** Activates the waiting worker; the page reloads once it takes control. */
export function applyUpdate(): void {
  if (!waiting) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), {
    once: true,
  });
  // Workbox's generated worker calls skipWaiting() on this message.
  waiting.postMessage({ type: 'SKIP_WAITING' });
}

export async function registerServiceWorker(): Promise<void> {
  // Never on the Expo dev server: a cached old bundle would hide new code.
  if (process.env.NODE_ENV !== 'production') return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.register('/sw.js');
    watchRegistration(registration, () => navigator.serviceWorker.controller !== null);
    // iOS home-screen apps often resume rather than restart, so check for a
    // new version whenever the app comes back to the front.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        registration.update().catch(() => undefined);
      }
    });
  } catch (error) {
    console.error('Service worker registration failed; the app works online only', error);
  }
}
```

If TypeScript rejects passing a real `ServiceWorkerRegistration` to `watchRegistration`, cast at that call with a comment (`registration as unknown as RegistrationLike // structural subset`).

- [ ] **Step 4: Run the unit tests and confirm they pass**

Run: `rtk vitest run apps/mobile/src/pwa/serviceWorker.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Add the banner and register from the layout**

`apps/mobile/src/pwa/UpdateBanner.tsx`:

```tsx
import { useSyncExternalStore } from 'react';
import { Pressable, Text, View } from 'react-native';
import { applyUpdate, subscribeUpdate, updateReady } from './serviceWorker';

/** Offers the new version; never reloads by itself, so typing is not lost. */
export function UpdateBanner() {
  const ready = useSyncExternalStore(subscribeUpdate, updateReady, () => false);
  if (!ready) return null;
  return (
    <View
      role="status"
      style={{
        backgroundColor: '#1a5d3a',
        padding: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <Text style={{ color: '#fff', flex: 1 }}>A new version is ready.</Text>
      <Pressable role="button" onPress={applyUpdate}>
        <Text style={{ color: '#fff', fontWeight: '600', textDecorationLine: 'underline' }}>
          Reload
        </Text>
      </Pressable>
    </View>
  );
}
```

`apps/mobile/app/_layout.tsx`:

```tsx
import { Slot } from 'expo-router';
import { useEffect } from 'react';
import { DatabaseProvider } from '../src/db/DatabaseProvider';
import { DatabaseSessionBridge } from '../src/db/DatabaseSessionBridge';
import { registerServiceWorker } from '../src/pwa/serviceWorker';
import { UpdateBanner } from '../src/pwa/UpdateBanner';
import { SessionProvider } from '../src/session/SessionProvider';

export default function RootLayout() {
  useEffect(() => {
    void registerServiceWorker();
  }, []);

  return (
    <SessionProvider>
      <DatabaseProvider>
        <DatabaseSessionBridge />
        <UpdateBanner />
        <Slot />
      </DatabaseProvider>
    </SessionProvider>
  );
}
```

- [ ] **Step 6: Add the e2e helper and write the failing offline tests**

Append to `e2e/helpers.ts`:

```ts
/** Waits until the service worker controls the page, so it can open offline. */
export async function waitForServiceWorker(page: Page): Promise<void> {
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, undefined, {
    timeout: 30_000,
  });
}
```

`e2e/offline-start.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import {
  addRecipe,
  expireSavedSession,
  freshEmail,
  SEED,
  session,
  unique,
  waitForServiceWorker,
} from './helpers';

test('the app opens with no network once it has been loaded, and offline writes sync later', async ({
  browser,
}) => {
  const member = await session(browser, SEED.memberA);
  await expect(member.getByText('Seed pancakes', { exact: true })).toBeVisible({ timeout: 30_000 });
  await waitForServiceWorker(member);

  await member.context().setOffline(true);
  await member.reload();
  await expect(member.getByRole('heading', { name: 'Recipes' })).toBeVisible();
  await expect(member.getByText('Seed pancakes', { exact: true })).toBeVisible();
  await expect(member.getByText(/^Offline · /)).toBeVisible();

  const title = unique('Cold start pie');
  await addRecipe(member, title);
  await expect(member.getByText('Offline · 1 unsynced')).toBeVisible({ timeout: 30_000 });

  const admin = await session(browser, SEED.adminA);
  await member.context().setOffline(false);
  await expect(admin.getByText(title, { exact: true })).toBeVisible({ timeout: 45_000 });
});

test('an expired token offline keeps the user signed in, and it renews once online', async ({
  browser,
}) => {
  const page = await session(browser, freshEmail('stale'));
  const first = unique('Stale-token stew');
  await addRecipe(page, first);
  await expect(page.getByText('Online · 0 unsynced')).toBeVisible({ timeout: 30_000 });
  await waitForServiceWorker(page);

  await page.context().setOffline(true);
  await expireSavedSession(page);
  await page.reload();
  await expect(page.getByText(first, { exact: true })).toBeVisible();
  await expect(page.getByLabel('Email')).toHaveCount(0);

  const second = unique('Stale-token soup');
  await addRecipe(page, second);
  await expect(page.getByText('Offline · 1 unsynced')).toBeVisible({ timeout: 30_000 });

  await page.context().setOffline(false);
  await expect(page.getByText('Online · 0 unsynced')).toBeVisible({ timeout: 60_000 });
  const expiresAt = await page.evaluate(
    () =>
      (JSON.parse(localStorage.getItem('supabase.auth.token') ?? '{}') as { expires_at?: number })
        .expires_at ?? 0,
  );
  expect(expiresAt * 1000).toBeGreaterThan(Date.now());
});

test('opening offline before anyone signs in shows the sign-in screen and a clear message', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByLabel('Email')).toBeVisible();
  await waitForServiceWorker(page);

  await page.context().setOffline(true);
  await page.reload();
  await expect(page.getByLabel('Email')).toBeVisible();
  await page.getByLabel('Email').fill(freshEmail('nobody'));
  await page.getByRole('button', { name: 'Send code' }).click();
  await expect(
    page.getByText('Could not reach the server. Check your connection and try again.'),
  ).toBeVisible();
});

test('the service worker leaves API and auth requests to the network', async ({ page }) => {
  await page.goto('/');
  await waitForServiceWorker(page);
  const types = await page.evaluate(async () => {
    const api = await fetch('/api/health');
    const auth = await fetch('/auth/health');
    return [api.headers.get('content-type'), auth.headers.get('content-type')];
  });
  expect(types[0]).toContain('application/json');
  expect(types[1]).toContain('application/json');
});

test('sw.js is never cached by HTTP and precaches the app shell', async ({ request }) => {
  const response = await request.get('/sw.js');
  expect(response.ok()).toBe(true);
  expect(response.headers()['cache-control']).toBe('no-cache');
  expect(response.headers()['content-type']).toContain('javascript');
  const source = await response.text();
  expect(source).toContain('precacheAndRoute');
  expect(source).toContain('index.html');
});
```

Run: `rtk pnpm test:e2e e2e/offline-start.spec.ts`
Expected: 5 failed. The first four time out in `waitForServiceWorker`, because no worker is registered yet and nothing controls the page. The last fails on `content-type`: `/sw.js` does not exist yet, so Caddy's fallback returns `index.html` as `text/html`.

- [ ] **Step 7: Add Workbox and generate the worker**

Run: `cd apps/mobile && rtk pnpm add -D workbox-cli@7.4.1`

If pnpm refuses an install script with `ERR_PNPM_IGNORED_BUILDS`, add the named packages under `allowBuilds:` in `pnpm-workspace.yaml` with `false` (as for esbuild) and a comment, then re-run. If pnpm's minimum-release-age policy blocks a package, report the package and version rather than adding an exclusion silently.

`apps/mobile/workbox.config.cjs`:

```js
// Generates dist/sw.js after `expo export` (ADR-0009). Build time only:
// nothing from Workbox is bundled into the app except this generated worker.
module.exports = {
  globDirectory: 'dist',
  globPatterns: ['**/*'],
  globIgnores: ['sw.js', 'workbox-*.js', '**/*.map'],
  swDest: 'dist/sw.js',
  // PowerSync's WebAssembly builds are up to 2.4 MB; all four are precached
  // rather than guessing which one a browser loads.
  maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
  // Any app path opens offline; Expo Router routes on the client.
  navigateFallback: '/index.html',
  // Services, not app pages: always the network.
  navigateFallbackDenylist: [
    /^\/auth\//,
    /^\/api\//,
    /^\/sync\//,
    /^\/email-templates\//,
    /^\/local-ca\.crt$/,
  ],
  // Take control on first install, so the app works offline straight away.
  clientsClaim: true,
  // A new version waits until the user taps Reload (UpdateBanner).
  skipWaiting: false,
  cleanupOutdatedCaches: true,
  sourcemap: false,
};
```

In `apps/mobile/package.json`, change `build:web` to:

```json
"build:web": "pnpm run copy-assets && expo export --platform web && workbox generateSW workbox.config.cjs",
```

Run: `cd apps/mobile && rtk pnpm run build:web && ls dist/sw.js dist/workbox-*.js && rtk proxy grep -c "OPFSCoopSyncVFS" dist/sw.js`
Expected: both files listed; the count is at least `1` (the VFS module is in the precache list). Workbox prints the number of precached files and their size (about 9 to 10 MB without source maps).

- [ ] **Step 8: Run the offline tests and confirm they pass**

Run: `rtk pnpm test:e2e e2e/offline-start.spec.ts`
Expected: 5 passed.

If an offline reload fails with `net::ERR_INTERNET_DISCONNECTED`, the page was not yet controlled: confirm `waitForServiceWorker` ran after the first load. If PowerSync's worker fails to load offline, open `dist/sw.js` and check that `@powersync/worker.js` and the `.wasm` files are in the precache list.

- [ ] **Step 9: Run everything**

Run: `rtk pnpm lint && rtk pnpm typecheck && rtk pnpm test && rtk pnpm test:e2e`
Expected: all exit 0; unit 92 (89 + 3); e2e 27 (22 + 5).

- [ ] **Step 10: Commit**

```bash
rtk git add apps/mobile/package.json apps/mobile/workbox.config.cjs apps/mobile/src/pwa apps/mobile/app/_layout.tsx e2e pnpm-lock.yaml pnpm-workspace.yaml
rtk proxy git commit -q -F <message file>
```

Message: `feat(app): Workbox service worker for offline start, with an update banner (FR-28, NFR-4)`.

---

### Task 5: Build label and storage status

**Files:**
- Modify: `apps/mobile/src/config.ts`
- Create: `apps/mobile/src/pwa/storageStatus.ts`
- Create: `apps/mobile/src/components/BuildFooter.tsx`
- Modify: `apps/mobile/src/screens/RecipeListScreen.tsx`, `apps/mobile/src/screens/SignInScreen.tsx`
- Modify: `deploy/proxy.Dockerfile`
- Test: `e2e/install.spec.ts` (one more test)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `config.buildTime: string`; `requestPersistentStorage(): Promise<'persistent' | 'best effort' | 'unknown'>`; `useStorageStatus(): 'checking' | 'persistent' | 'best effort' | 'unknown'`; `BuildFooter` component.

- [ ] **Step 1: Write the failing test**

Append to `e2e/install.spec.ts`:

```ts
test('the footer shows the build time and the storage status', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByLabel('Build')).toHaveText(
    /^Build \d{4}-\d{2}-\d{2} \d{2}:\d{2} · Storage: (persistent|best effort|unknown)$/,
  );
});
```

Run: `rtk pnpm test:e2e e2e/install.spec.ts`
Expected: the new test fails (no element labelled "Build").

- [ ] **Step 2: Add the build time to the config**

In `apps/mobile/src/config.ts`, add a property to `config`:

```ts
  // Set by the proxy image build (deploy/proxy.Dockerfile); `dev` elsewhere.
  buildTime: process.env.EXPO_PUBLIC_BUILD_TIME || 'dev',
```

- [ ] **Step 3: Request persistent storage**

`apps/mobile/src/pwa/storageStatus.ts`:

```ts
import { useEffect, useState } from 'react';

export type StorageStatus = 'persistent' | 'best effort' | 'unknown';

let request: Promise<StorageStatus> | null = null;

/**
 * Asks the browser once not to evict the app's data when space runs low.
 * Safari decides by its own rules; the footer shows what it chose.
 */
export function requestPersistentStorage(): Promise<StorageStatus> {
  request ??= (async () => {
    const storage = typeof navigator === 'undefined' ? undefined : navigator.storage;
    if (!storage?.persist || !storage.persisted) return 'unknown';
    try {
      if (await storage.persisted()) return 'persistent';
      return (await storage.persist()) ? 'persistent' : 'best effort';
    } catch {
      return 'unknown';
    }
  })();
  return request;
}

export function useStorageStatus(): StorageStatus | 'checking' {
  const [status, setStatus] = useState<StorageStatus | 'checking'>('checking');
  useEffect(() => {
    let live = true;
    void requestPersistentStorage().then((result) => {
      if (live) setStatus(result);
    });
    return () => {
      live = false;
    };
  }, []);
  return status;
}
```

- [ ] **Step 4: Add the footer**

`apps/mobile/src/components/BuildFooter.tsx`:

```tsx
import { Text } from 'react-native';
import { config } from '../config';
import { useStorageStatus } from '../pwa/storageStatus';

/** Lets the tester see which build is running and what Safari decided about storage. */
export function BuildFooter() {
  const storage = useStorageStatus();
  return (
    <Text aria-label="Build" style={{ color: '#666', fontSize: 12, marginTop: 24 }}>
      {`Build ${config.buildTime} · Storage: ${storage}`}
    </Text>
  );
}
```

In `apps/mobile/src/screens/RecipeListScreen.tsx`, import `BuildFooter` from `'../components/BuildFooter'` and render `<BuildFooter />` after the Sign out `Pressable`, inside the outer `View`.

In `apps/mobile/src/screens/SignInScreen.tsx`, import `BuildFooter` the same way and render `<BuildFooter />` after the `{message ? ... : null}` block, inside the outer `View`.

- [ ] **Step 5: Set the build time in the image**

In `deploy/proxy.Dockerfile`, replace:

```dockerfile
# No EXPO_PUBLIC_* values are set: the bundle uses same-origin paths, so this
# image is identical on every host.
ENV METRO_MAX_WORKERS=2
RUN pnpm --filter mobile run build:web
```

with:

```dockerfile
# Only the build time is set: the bundle uses same-origin paths, so this image
# holds no host name or key and runs on every host. The time shows in the
# app's footer; the layer is reused, time included, when no source changed.
ENV METRO_MAX_WORKERS=2
RUN EXPO_PUBLIC_BUILD_TIME="$(date -u '+%Y-%m-%d %H:%M')" pnpm --filter mobile run build:web
```

- [ ] **Step 6: Run the test and confirm it passes**

Run: `rtk pnpm test:e2e e2e/install.spec.ts`
Expected: 4 passed.

- [ ] **Step 7: Run everything and commit**

Run: `rtk pnpm lint && rtk pnpm typecheck && rtk pnpm test && rtk pnpm test:e2e`
Expected: all exit 0; e2e 28.

```bash
rtk git add apps/mobile/src deploy/proxy.Dockerfile e2e/install.spec.ts
rtk proxy git commit -q -F <message file>
```

Message: `feat(app): footer with build time and persistent-storage status (NFR-4)`.

---

### Task 6: Documentation, clean verification, and the owner's phone check

**Files:**
- Create: `docs/adr/0009-installable-web-app-with-workbox.md`
- Modify: `docs/adr/README.md`, `ARCHITECTURE.md`, `README.md`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write ADR-0009**

`docs/adr/0009-installable-web-app-with-workbox.md`:

```markdown
# 0009. Installable web app with a Workbox-generated service worker

- **Status:** Accepted
- **Date:** 2026-10-16
- **Builds on:** ADR-0007 (web first)

## Context
ADR-0007 delivers the app on the web first. To try it as a phone app, the owner needs it on the iPhone home screen and able to open with no connection (FR-28, NFR-4). Without a service worker the app's files load from the network, so it works offline only while already open. Safari also needs a storage mode that suits it, and an offline start must not sign the user out and wipe unsynced recipes.

## Decision
- **App shell:** after `expo export`, `workbox generateSW` writes `sw.js`, which precaches every file of the build (about 10 MB, including PowerSync's four WebAssembly builds). Navigations fall back to the cached `index.html`. `/auth`, `/api`, `/sync`, `/email-templates` and `/local-ca.crt` always go to the network. The app registers the worker in production builds only.
- **Updates:** a new worker installs in the background and waits. A banner offers "Reload", which activates it. The app never reloads by itself, so typing is not lost. Caddy sends `sw.js` and every other non-hashed file with `no-cache`, and hashed bundles as `immutable`.
- **Installability:** a web app manifest, icons, and an `apple-touch-icon` in Expo's HTML template.
- **Storage:** the local database uses PowerSync's `OPFSCoopSyncVFS` on every browser, as PowerSync recommends for Safari/iOS. The app requests persistent storage.
- **Session:** when renewing the access token fails because the network is unreachable, the app stays signed in from the saved session. Local data is wiped only on an explicit sign-out or when a different user signs in.

New dependency: `workbox-cli` (development only, `apps/mobile`).

## Alternatives considered
- **A hand-written service worker:** no dependency, but we would own precache versioning, cleanup and update handling, where service worker bugs usually are; the symptom is a phone stuck on an old version.
- **No service worker, long HTTP cache lifetimes:** Safari does not promise to keep or serve those files offline.
- **`workbox-window` for registration:** a runtime dependency for about 40 lines of browser API code.
- **Automatic reload on update:** simpler, but can discard a half-typed recipe.
- **Keep IndexedDB storage:** no switch-over, but no multi-tab support on Safari and not PowerSync's recommendation there.

## Consequences
- The first visit downloads about 10 MB; later builds download only changed files.
- Switching storage mode leaves earlier IndexedDB data unused; each browser re-downloads from the server, and anything unsynced in the old storage is stranded.
- OPFS has known issues in Safari private browsing; the app shows a message there.
- While offline with an expired token, the UI shows the last known role; writes after a demotion are rejected on upload.
- The service worker is a second place where the app's files live; when debugging "old code" on a device, check the footer's build time first.
```

In `docs/adr/README.md`, add after the 0008 row:

```markdown
| [0009](0009-installable-web-app-with-workbox.md) | Installable web app with a Workbox-generated service worker | Accepted |
```

- [ ] **Step 2: Update ARCHITECTURE.md**

In the §2 container diagram, replace the `mobile` and `localDb` lines with:

```
    Container(mobile, "Web App", "Expo / React Native Web, TypeScript; Workbox service worker", "UI, cook mode, local search, PDF generation, offline queue; installable, opens offline (ADR-0009)")
    ContainerDb(localDb, "On-device Database", "SQLite in the browser (OPFS, via PowerSync web SDK)", "Household's recipes; full-text index; pending-upload queue")
```

In the §2 responsibilities table, append to the Mobile App row's Notes: `; a service worker precaches the app's files so it opens offline (ADR-0009)`. In §9, change `Current: ADR-0001 through ADR-0008.` to `Current: ADR-0001 through ADR-0009.` Bump the status line's date to the day of the change.

- [ ] **Step 3: Update the README phone section**

In `README.md`, replace the last paragraph of "Testing on a phone" (starting "The authority is kept in") with:

```markdown
The authority is kept in `.local/caddy/` (git-ignored), so `pnpm db:reset` keeps it and the phone stays trusted. Deleting that folder creates a new authority, which the phone must trust again.

To use it as an app, open the HTTPS address in Safari and choose Share → Add to Home Screen. The home-screen app has its own storage, so sign in once more there. After the first load it opens with no connection; a banner offers to reload when a new build is ready. The footer shows the build time and whether Safari granted persistent storage.

Before loading a build that changes the local storage mode (as the phone preview did, from IndexedDB to OPFS), wait until the app shows "0 unsynced": unsynced changes in the old storage are not carried over.

Phone checklist:
1. Add to Home Screen; the "Recipes" icon appears.
2. Open it from the home screen: full screen, no address bar. Sign in.
3. Airplane mode on, close the app fully, reopen: recipes show and the status says "Offline". Add one; it shows as unsynced. Airplane mode off: it syncs and appears on the PC.
4. Rebuild on the PC (`pnpm dev:backend`) and bring the app to the front: the banner appears; tap Reload; the footer's build time changes.
5. Restart the phone and reopen: still signed in, data present.
6. Reopen after a few days: still signed in, data present.
```

- [ ] **Step 4: Verify from a clean state**

```bash
rtk pnpm dev:backend:stop
rtk proxy docker compose --profile dev down -v
rtk pnpm install --frozen-lockfile
rtk pnpm db:reset
rtk pnpm lint && rtk pnpm typecheck && rtk pnpm test && rtk pnpm test:stack && rtk pnpm test:rls && rtk pnpm test:api && rtk pnpm test:e2e
```

Expected: every command exits 0; unit 92, stack 6, RLS 33, API 18, e2e 28. Then confirm no secret is in the web bundle or the worker:

```bash
rtk proxy docker compose exec proxy sh -c 'grep -rlE "ANTHROPIC|POSTGRES_PASSWORD|API_LOGIN_PASSWORD|JWT_SECRET" /srv/web && echo LEAK || echo clean'
```

Expected: `clean`.

- [ ] **Step 5: Commit the docs**

```bash
rtk git add docs/adr ARCHITECTURE.md README.md
rtk proxy git commit -q -F <message file>
```

Message: `docs: ADR-0009 installable web app with a Workbox service worker; phone checklist (FR-28, NFR-4)`.

- [ ] **Step 6: Hand the checklist to the owner**

Before handing over, remind the owner that the phone's current Safari data is in the old IndexedDB storage: check the phone shows "0 unsynced" before opening the new build. Then ask them to run the README's six-step phone checklist and report each result. Fix anything that fails before opening the pull request.

- [ ] **Step 7: Push and open the pull request (confirm with the owner first)**

Pushing and opening a pull request are outward-facing: confirm with the owner before `git push -u origin feat/phone-preview`. Base the pull request on `main` if PR #1 has merged; otherwise on `feat/walking-skeleton`, and say so in its description. After the first CI run, report each job's result.

---

## Spec coverage

| Spec section | Task |
|---|---|
| §1 success criterion 1 (home screen, full screen) | 3; checked on the phone in 6 |
| §1 success criterion 2 (offline cold start, syncs later) | 4 (e2e), 6 (phone) |
| §1 success criterion 3 (updates without reinstalling) | 4 (banner, unit tests), 6 (phone) |
| §1 success criterion 4 (survives close, restart, days) | 1 (OPFS), 2 (session), 5 (persistent storage), 6 (phone) |
| §2 decisions and known consequences | 1, 2, 3, 4; ADR-0009 in 6 |
| §3 Installable app (manifest, template, icons) | 3 |
| §3 Service worker (Workbox config, build step, dependency) | 4 |
| §3 Registration and updates | 4 |
| §3 Build label and storage status | 5 |
| §3 Proxy cache headers | 3 |
| §4 Service worker behaviour (requests, first install, update flow, failures) | 4 |
| §5 Session and local data (`resolveSession`, `localDataAction`, owner) | 2 |
| §6 Storage on Safari (OPFS, open failure, persist) | 1, 5 |
| §7 Unit tests | 2, 4 |
| §7 E2E 1 (offline cold start) | 4 |
| §7 E2E 2 (expired token offline) | 4 |
| §7 E2E 3 (session ended by the server) | 2 |
| §7 E2E 4 (installability, headers) | 3, 4 (`sw.js`) |
| §7 Owner's checklist | 6 |
| §8 Documentation | 6 |
| §9 Acceptance criteria | 6 (clean verification, phone checklist, CI) |
