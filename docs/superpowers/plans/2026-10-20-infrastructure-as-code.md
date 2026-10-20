# Infrastructure as code Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** OpenTofu creates Dishkept's cloud resources, and Ansible sets up the PC or a GCP VM and deploys. Both are tested statically in CI, then for real with the owner.

**Architecture:**
- `infra/tofu` holds the Cloudflare zone, tunnel and DNS record, the GCS backup bucket and its service account, and an optional VM. Its state lives in a GCS bucket made by `infra/bootstrap.sh`.
- `infra/ansible` has two hosts, `pc` (local) and `vm` (over IAP). Its roles call the existing `pnpm prod:*` commands.
- Secrets live in an Ansible Vault file, built by `pnpm infra:secrets` from OpenTofu's outputs and the owner's answers.

**Tech Stack:**
- OpenTofu 1.10, with providers `cloudflare/cloudflare ~> 4.52`, `hashicorp/google ~> 6.0` and `hashicorp/random ~> 3.6`;
- Ansible core 2.13+, using only `ansible.builtin`;
- Node 20+ scripts, with vitest for the unit tests.

**Spec:** `docs/superpowers/specs/2026-10-20-infrastructure-as-code-design.md`

## Global Constraints

- **Region** `us-east1`, **zone** `us-east1-b`. The VM is `e2-small`, Debian 12, a 20 GB `pd-balanced` disk, with **no external IP**. Its firewall allows only TCP 22 from `35.235.240.0/20`.
- **Backup bucket:** uniform access, public access prevented, deleted after 30 days. Its service account `dishkept-backup` has only `roles/storage.objectCreator` and `roles/storage.objectViewer` on that bucket.
- **Tunnel** `dishkept`, with ingress `dishkept.geltech.dev` → `http://proxy:8080`, then `http_status:404`.
- **State:** the `gcs` backend with prefix `dishkept`. The bucket is given at `tofu init -backend-config=bucket=...`.
- **Credentials:** no credential, token, key or email address is written in the repo, except inside the encrypted Vault file. Cloudflare reads `CLOUDFLARE_API_TOKEN` from the environment; GCP uses application-default credentials.
- **Plaintext secrets never touch disk:** pipes only, no temp files. The one exception is the drill's key file on the VM (`0600`), removed in an `always:` block.
- **Ansible:** only `ansible.builtin` modules; every task that handles a secret has `no_log: true`; a run names exactly one host.
- **`prod:*` stays the only way to operate production.** Ansible calls `corepack pnpm prod:deploy` and `prod:restore-test`, never `docker compose` directly.
- **Commits:** Conventional Commits that cite ADR-0018 or ADR-0021, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Lint:** run `rm -rf .vitest` before `pnpm lint`.
- **Never** run `pnpm db:reset`, `tofu apply`, or a non-`--check` Ansible run against `pc` while executing Tasks 1–6. Live runs are Task 7, with the owner.
- **Spec gap ruled here:** the repo is private, so the VM can't clone it anonymously.
  - The VM clones over HTTPS with a **read-only fine-grained GitHub token** (Contents: Read, this repo only), kept in the Vault file as `vault_github_read_token`. `infra:secrets` asks for it.
  - The PC keeps cloning with the owner's own git credentials.
  - Cost if wrong: the token expires within a year and must be rotated (RUNBOOK).

## Review Focus

1. **Running a playbook without `-l`, or with both hosts.** It must stop before touching anything, and say "name one host with -l pc or -l vm". Owned by Task 5 (the assert, plus a `--check` run with no `-l` in Step 5).
2. **The production clone has local changes, or is on another branch.** The `app` role must fail with the reason, not overwrite or reset the checkout. Owned by Task 5 (the role's assert; exercised in Task 7 step 6's `--check`).
3. **`infra:secrets` when a Vault file already exists.** It must refuse to overwrite it (rotations use `--edit` or `--refresh`). Owned by Task 3 (`planSecretsRun` test).
4. **A value with a single quote, or an empty answer**, for example an app password. It must be re-asked, as `prod:init` does, never written into an env line that Compose would misread. Owned by Task 2 (shared `promptValue` validation test).
5. **`tofu output` before the zone or tunnel exists, or with `vm=false`.** `infra:secrets --refresh` must fail clearly naming the missing output, and the VM outputs must be empty, not an error. Owned by Task 3 (`tofuValues` missing-output test) and Task 4 (the outputs use `one()` / `try()`).

---

## File structure

| File | Responsibility |
|---|---|
| `scripts/prod/lib.mjs` | Adds `deploySequence({ tunnel })`, `parseFlags(args)`, `generatedSecrets()`, `PROMPTED`, `promptValue(answer)`. |
| `scripts/prod/cli.mjs` | `deploy --no-tunnel`, `restore-test --key-file`; `init` uses the shared generators. |
| `scripts/infra/lib.mjs` (new) | Pure: `tofuValues`, `vaultYaml`, `parseVaultYaml`, `refreshEnv`, `planSecretsRun`. |
| `scripts/infra/secrets.mjs` (new) | `pnpm infra:secrets` (create, `--edit`, `--refresh`); runs `tofu` and `ansible-vault`. |
| `scripts/infra/vault-pass.sh` (new) | A vault password client: prints `$DISHKEPT_VAULT_PASS`. |
| `scripts/infra/check.mjs` (new) | `pnpm test:infra`: tofu fmt, validate, Ansible syntax checks and lint. |
| `infra/bootstrap.sh` (new) | The one-time state bucket. |
| `infra/tofu/*.tf`, `.terraform.lock.hcl` (new) | The cloud resources. |
| `infra/ansible/**` (new) | The inventory, vars, roles and playbooks. |
| `infra/README.md` (new) | Tools, credentials, and how to run each piece. |
| `.github/workflows/ci.yml` | The static job runs `pnpm test:infra`. |
| Docs | ADR-0021, the ADR index, RUNBOOK, ARCHITECTURE, CLAUDE.md. |

---

### Task 1: `prod:deploy --no-tunnel` and `prod:restore-test --key-file`

**Files:**
- Modify: `scripts/prod/lib.mjs` (`deploySequence`, add `parseFlags`)
- Modify: `scripts/prod/cli.mjs` (`deploy`, `restore-test`)
- Test: `scripts/prod/lib.test.mjs`

**Interfaces:**
- Produces:
  - `deploySequence({ tunnel = true } = {})`, which leaves out the final `cloudflared` step when `tunnel` is false;
  - `parseFlags(args: string[]): { tunnel: boolean, keyFile: string | null, positional: string[] }`;
  - CLI: `pnpm prod:deploy --no-tunnel` and `pnpm prod:restore-test --key-file <path>`.

- [ ] **Step 1: Write the failing tests**

Add `parseFlags` to the import list in `scripts/prod/lib.test.mjs`, and append:

```js
describe('the prod flags (infrastructure spec §5)', () => {
  it('deploys the tunnel last by default', () => {
    const steps = deploySequence();
    expect(steps.at(-1).args).toEqual(['up', '-d', '--wait', 'cloudflared']);
  });

  it('leaves the tunnel out with --no-tunnel, keeping every other step', () => {
    const steps = deploySequence({ tunnel: false });
    expect(steps.some((step) => step.args?.includes('cloudflared'))).toBe(false);
    expect(steps).toEqual(deploySequence().slice(0, -1));
  });

  it('reads --no-tunnel and --key-file, and keeps the rest as positional', () => {
    expect(parseFlags([])).toEqual({ tunnel: true, keyFile: null, positional: [] });
    expect(parseFlags(['--no-tunnel'])).toEqual({ tunnel: false, keyFile: null, positional: [] });
    expect(parseFlags(['--key-file', '/tmp/k', '2026-10-19'])).toEqual({
      tunnel: true,
      keyFile: '/tmp/k',
      positional: ['2026-10-19'],
    });
  });

  it('refuses --key-file without a path, and unknown flags', () => {
    expect(() => parseFlags(['--key-file'])).toThrow('--key-file needs a path');
    expect(() => parseFlags(['--tunnel=no'])).toThrow('Unknown flag: --tunnel=no');
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm vitest run scripts/prod/lib.test.mjs`
Expected: FAIL. `parseFlags` is not a function, and `deploySequence({ tunnel: false })` still ends with `cloudflared`.

- [ ] **Step 3: Implement**

In `scripts/prod/lib.mjs`, replace `deploySequence` with:

```js
/** First deploy order: services, then the gate, and only then the public tunnel. */
export function deploySequence({ tunnel = true } = {}) {
  return [
    { profiles: ['backup'], args: ['up', '-d', '--build', '--wait', '--remove-orphans'] },
    // The nightly loop records the build the proxy now serves (bug batch §5).
    { stampBackup: true },
    { restartSync: true },
    { gate: true },
    // Left out for a stack that must not take live traffic, such as the VM trial
    // (infrastructure spec §5): two connectors on one token split it.
    ...(tunnel ? [{ profiles: PROD_PROFILES, args: ['up', '-d', '--wait', 'cloudflared'] }] : []),
  ];
}

/** The flags prod:* commands take (infrastructure spec §5); the rest stay positional. */
export function parseFlags(args) {
  const flags = { tunnel: true, keyFile: null, positional: [] };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--no-tunnel') flags.tunnel = false;
    else if (arg === '--key-file') {
      const path = args[++i];
      if (!path || path.startsWith('--')) throw new Error('--key-file needs a path');
      flags.keyFile = path;
    } else if (arg.startsWith('--')) throw new Error(`Unknown flag: ${arg}`);
    else flags.positional.push(arg);
  }
  return flags;
}
```

In `scripts/prod/cli.mjs`:
- add `parseFlags` to the import list;
- replace `const [command, ...rest] = process.argv.slice(2);` with:

```js
const [command, ...args] = process.argv.slice(2);
let flags;
try {
  flags = parseFlags(args);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
const rest = flags.positional;
```

- in `deploy()`, change `for (const step of deploySequence()) {` to `for (const step of deploySequence({ tunnel: flags.tunnel })) {`;
- after that loop, before `commands.status();`, add:

```js
    if (!flags.tunnel) console.log('Started without the tunnel: the site is not reachable from outside.');
```

- add, above `askKeyPath`:

```js
/** --key-file, for runs with no one at the prompt (the VM trial), or the question. */
async function keyPathFromFlagOrAsk() {
  if (flags.keyFile) {
    const keyPath = resolve(flags.keyFile);
    if (!existsSync(keyPath) || !statSync(keyPath).isFile()) fail(`No key file at ${keyPath}`);
    return keyPath;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await askKeyPath(rl);
  } finally {
    rl.close();
  }
}
```

- in `'restore-test'`, replace these three lines:

```js
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const keyPath = await askKeyPath(rl);
    rl.close();
```

with `const keyPath = await keyPathFromFlagOrAsk();`.

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm vitest run scripts/prod && node --check scripts/prod/cli.mjs`
Expected: PASS, and the syntax check is clean.

- [ ] **Step 5: Commit**

```bash
git add scripts/prod/lib.mjs scripts/prod/lib.test.mjs scripts/prod/cli.mjs
git commit -m "feat(prod): deploy --no-tunnel and restore-test --key-file, for the VM trial (ADR-0018)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: One place that generates and validates production secrets

**Files:**
- Modify: `scripts/prod/lib.mjs` (add `generatedSecrets`, `PROMPTED`, `promptValue`)
- Modify: `scripts/prod/cli.mjs` (`init` uses them)
- Test: `scripts/prod/lib.test.mjs`

**Interfaces:**
- Produces:
  - `generatedSecrets(): Record<string, string>`, with the keys `POSTGRES_PASSWORD`, `APP_OWNER_PASSWORD`, `API_LOGIN_PASSWORD`, `AUTH_DB_PASSWORD`, `POWERSYNC_REPL_PASSWORD`, `POWERSYNC_STORAGE_PASSWORD`, `JWT_SECRET` and `JWT_KEYS`;
  - `PROMPTED: readonly { name: string, hint: string }[]`, for the six owner answers `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `ANTHROPIC_API_KEY`, `BACKUP_AGE_RECIPIENT` and `OWNER_EMAIL`;
  - `promptValue(answer: string): string | null`, which returns the trimmed value, or null when it's empty or contains `'`.

- [ ] **Step 1: Write the failing tests**

Add `generatedSecrets`, `PROMPTED` and `promptValue` to the import list, and append:

```js
describe('production secrets (infrastructure spec §4)', () => {
  it('generates every password as hex, and fresh signing keys', () => {
    const a = generatedSecrets();
    const b = generatedSecrets();
    expect(Object.keys(a).sort()).toEqual(
      [
        'API_LOGIN_PASSWORD',
        'APP_OWNER_PASSWORD',
        'AUTH_DB_PASSWORD',
        'JWT_KEYS',
        'JWT_SECRET',
        'POSTGRES_PASSWORD',
        'POWERSYNC_REPL_PASSWORD',
        'POWERSYNC_STORAGE_PASSWORD',
      ].sort(),
    );
    for (const [name, value] of Object.entries(a)) {
      if (name !== 'JWT_KEYS') expect(value, name).toMatch(/^[0-9a-f]{48,64}$/);
      expect(value, name).not.toBe(b[name]);
    }
    expect(JSON.parse(a.JWT_KEYS)[0]).toMatchObject({ alg: 'ES256', kty: 'EC' });
  });

  it('asks the owner for the values only they have', () => {
    expect(PROMPTED.map((p) => p.name)).toEqual([
      'SMTP_USER',
      'SMTP_PASS',
      'SMTP_FROM',
      'ANTHROPIC_API_KEY',
      'BACKUP_AGE_RECIPIENT',
      'OWNER_EMAIL',
    ]);
  });

  it('re-asks an empty answer or one with a single quote (Review Focus 4)', () => {
    expect(promptValue('  sk-ant-x  ')).toBe('sk-ant-x');
    expect(promptValue('')).toBeNull();
    expect(promptValue('   ')).toBeNull();
    expect(promptValue("it's")).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm vitest run scripts/prod/lib.test.mjs`
Expected: FAIL with "generatedSecrets is not a function".

- [ ] **Step 3: Implement**

In `scripts/prod/lib.mjs`, make sure `randomBytes` is imported from `node:crypto`, alongside the existing `generateKeyPairSync` and `randomUUID`, and append:

```js
/** Every secret production generates itself (prod:init and infra:secrets share these). */
export function generatedSecrets() {
  const hex = () => randomBytes(24).toString('hex');
  return {
    POSTGRES_PASSWORD: hex(),
    APP_OWNER_PASSWORD: hex(),
    API_LOGIN_PASSWORD: hex(),
    AUTH_DB_PASSWORD: hex(),
    POWERSYNC_REPL_PASSWORD: hex(),
    POWERSYNC_STORAGE_PASSWORD: hex(),
    JWT_SECRET: randomBytes(32).toString('hex'),
    JWT_KEYS: newSigningKeys(),
  };
}

/** The values only the owner has; the tunnel token and bucket come from OpenTofu. */
export const PROMPTED = [
  { name: 'SMTP_USER', hint: 'Zoho login, e.g. wes@data2insightsllc.com' },
  { name: 'SMTP_PASS', hint: 'Zoho app-specific password' },
  { name: 'SMTP_FROM', hint: 'must equal SMTP_USER for Zoho' },
  { name: 'ANTHROPIC_API_KEY', hint: 'sk-ant-...' },
  { name: 'BACKUP_AGE_RECIPIENT', hint: 'age1... public key' },
  { name: 'OWNER_EMAIL', hint: 'your sign-in address, added to the allowed list' },
];

/** An answer as stored, or null to ask again: Compose has no escape inside '…'. */
export function promptValue(answer) {
  const value = answer.trim();
  return value && !value.includes("'") ? value : null;
}
```

In `scripts/prod/cli.mjs`'s `init`:
- add `generatedSecrets`, `PROMPTED` and `promptValue` to the imports;
- remove the `randomBytes` import if nothing else uses it;
- replace the `ask` helper and the `values` object with:

```js
    const ask = async (name, hint) => {
      for (;;) {
        const value = promptValue(await rl.question(`${name} (${hint}): `));
        if (value) return value;
        console.log("Required, and may not contain a single quote ('). Try again.");
      }
    };
    const values = {
      ...generatedSecrets(),
      TUNNEL_TOKEN: await ask('TUNNEL_TOKEN', 'Cloudflare tunnel token'),
      BACKUP_BUCKET: await ask('BACKUP_BUCKET', 'GCS bucket name'),
    };
    for (const { name, hint } of PROMPTED) values[name] = await ask(name, hint);
```

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm vitest run scripts/prod && node --check scripts/prod/cli.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/prod/lib.mjs scripts/prod/lib.test.mjs scripts/prod/cli.mjs
git commit -m "refactor(prod): one place generates and validates production secrets, for prod:init and infra:secrets (ADR-0018)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `pnpm infra:secrets`

**Files:**
- Create: `scripts/infra/lib.mjs`, `scripts/infra/lib.test.mjs`, `scripts/infra/secrets.mjs`, `scripts/infra/vault-pass.sh`
- Modify: `package.json` (script `infra:secrets`)

**Interfaces:**
- Consumes: from Task 2, `buildProdEnv`, `generatedSecrets`, `PROMPTED` and `promptValue`.
- Produces:
  - `VAULT_FILE = 'infra/ansible/group_vars/all/vault.yml'`;
  - `tofuValues(outputs: object): { TUNNEL_TOKEN, BACKUP_BUCKET, keyJson }`, which throws `Missing OpenTofu output: <name>`;
  - `vaultYaml({ env, keyJson, githubToken }): string`;
  - `parseVaultYaml(text): { env, keyJson, githubToken }`;
  - `refreshEnv(env: string, values: { TUNNEL_TOKEN, BACKUP_BUCKET }): string`;
  - `planSecretsRun({ mode: 'create'|'edit'|'refresh', vaultExists: boolean }): string | null`, which returns an error message or null;
  - Ansible variables: `vault_prod_env`, `vault_gcs_backup_key`, `vault_github_read_token`.

- [ ] **Step 1: Write the failing tests**

Create `scripts/infra/lib.test.mjs`:

```js
import { describe, expect, it } from 'vitest';
import { parseVaultYaml, planSecretsRun, refreshEnv, tofuValues, vaultYaml } from './lib.mjs';

const outputs = {
  tunnel_token: { value: 'eyJ.tunnel', sensitive: true },
  backup_bucket: { value: 'dishkept-backups-x' },
  backup_key_json: { value: '{"type":"service_account","private_key":"-----BEGIN\\nabc"}' },
};

describe('tofuValues (infrastructure spec §4)', () => {
  it('reads the tunnel token, bucket and key from tofu output -json', () => {
    expect(tofuValues(outputs)).toEqual({
      TUNNEL_TOKEN: 'eyJ.tunnel',
      BACKUP_BUCKET: 'dishkept-backups-x',
      keyJson: outputs.backup_key_json.value,
    });
  });

  it('names a missing or empty output (Review Focus 5)', () => {
    expect(() => tofuValues({ ...outputs, tunnel_token: undefined })).toThrow(
      'Missing OpenTofu output: tunnel_token',
    );
    expect(() => tofuValues({ ...outputs, backup_bucket: { value: '' } })).toThrow(
      'Missing OpenTofu output: backup_bucket',
    );
  });
});

describe('the Vault file text', () => {
  const env = "APP_ENV=production\nJWT_KEYS='[{\"kid\":\"a\"}]'\nTZ=America/New_York\n";
  const keyJson = '{\n  "type": "service_account"\n}\n';

  it('round-trips the env, the key and the GitHub token, byte for byte', () => {
    const text = vaultYaml({ env, keyJson, githubToken: 'github_pat_x' });
    expect(text).toMatch(/^vault_prod_env: \|\n {2}APP_ENV=production\n/);
    expect(parseVaultYaml(text)).toEqual({ env, keyJson, githubToken: 'github_pat_x' });
  });

  it('keeps blank lines inside the env', () => {
    const spaced = 'A=1\n\n# comment\nB=2\n';
    expect(parseVaultYaml(vaultYaml({ env: spaced, keyJson, githubToken: 't' })).env).toBe(spaced);
  });
});

describe('refreshEnv', () => {
  it('replaces only the tunnel token and the bucket', () => {
    const env = 'TUNNEL_TOKEN=old\nSMTP_PASS=keep\nBACKUP_BUCKET=old-bucket\n';
    expect(refreshEnv(env, { TUNNEL_TOKEN: 'new', BACKUP_BUCKET: 'b2' })).toBe(
      'TUNNEL_TOKEN=new\nSMTP_PASS=keep\nBACKUP_BUCKET=b2\n',
    );
  });

  it('fails when a line to replace is missing', () => {
    expect(() => refreshEnv('SMTP_PASS=x\n', { TUNNEL_TOKEN: 'n', BACKUP_BUCKET: 'b' })).toThrow(
      'TUNNEL_TOKEN',
    );
  });
});

describe('planSecretsRun (Review Focus 3)', () => {
  it('creates only when there is no Vault file', () => {
    expect(planSecretsRun({ mode: 'create', vaultExists: false })).toBeNull();
    expect(planSecretsRun({ mode: 'create', vaultExists: true })).toMatch(/--edit or --refresh/);
  });

  it('edits and refreshes only an existing Vault file', () => {
    expect(planSecretsRun({ mode: 'edit', vaultExists: true })).toBeNull();
    expect(planSecretsRun({ mode: 'refresh', vaultExists: false })).toMatch(/run it without/);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `corepack pnpm vitest run scripts/infra`
Expected: FAIL with "Failed to load url ./lib.mjs".

- [ ] **Step 3: Implement the pure part**

Create `scripts/infra/lib.mjs`:

```js
// The pure parts of pnpm infra:secrets (infrastructure spec §4). No I/O here.

export const VAULT_FILE = 'infra/ansible/group_vars/all/vault.yml';

/** The values infra:secrets takes from `tofu output -json`. */
export function tofuValues(outputs) {
  const get = (name) => {
    const value = outputs[name]?.value;
    if (typeof value !== 'string' || value === '') throw new Error(`Missing OpenTofu output: ${name}`);
    return value;
  };
  return {
    TUNNEL_TOKEN: get('tunnel_token'),
    BACKUP_BUCKET: get('backup_bucket'),
    keyJson: get('backup_key_json'),
  };
}

const block = (name, text) =>
  `${name}: |\n${text
    .replace(/\n$/, '')
    .split('\n')
    .map((line) => (line ? `  ${line}` : ''))
    .join('\n')}\n`;

/** The Vault file's plaintext: literal blocks keep every byte of the env and the key. */
export function vaultYaml({ env, keyJson, githubToken }) {
  return [
    block('vault_prod_env', env),
    block('vault_gcs_backup_key', keyJson),
    `vault_github_read_token: '${githubToken}'\n`,
  ].join('');
}

/** Reads back only what vaultYaml writes. */
export function parseVaultYaml(text) {
  const blocks = {};
  let current = null;
  for (const line of text.split('\n')) {
    const head = /^([a-z_]+): (.*)$/.exec(line);
    if (head) {
      current = head[2] === '|' ? head[1] : null;
      blocks[head[1]] = head[2] === '|' ? [] : head[2].replace(/^'|'$/g, '');
    } else if (current) blocks[current].push(line.startsWith('  ') ? line.slice(2) : line);
  }
  const unblock = (lines) => `${lines.join('\n').replace(/\n+$/, '')}\n`;
  return {
    env: unblock(blocks.vault_prod_env),
    keyJson: unblock(blocks.vault_gcs_backup_key),
    githubToken: blocks.vault_github_read_token,
  };
}

/** The env with OpenTofu's two values replaced; every other line kept. */
export function refreshEnv(env, values) {
  let next = env;
  for (const [name, value] of Object.entries(values)) {
    const line = new RegExp(`^${name}=.*$`, 'm');
    if (!line.test(next)) throw new Error(`No ${name}= line in the Vault file's env`);
    next = next.replace(line, `${name}=${value}`);
  }
  return next;
}

/** Why this run must stop, or null. */
export function planSecretsRun({ mode, vaultExists }) {
  if (mode === 'create' && vaultExists)
    return `${VAULT_FILE} exists; use pnpm infra:secrets --edit or --refresh`;
  if (mode !== 'create' && !vaultExists)
    return `No ${VAULT_FILE} yet; run it without --${mode} first`;
  return null;
}
```

Note: `vault_github_read_token` is quoted with `'…'`. Fine-grained tokens are `[A-Za-z0-9_]`, so no quote can appear, and `secrets.mjs` checks the shape.

- [ ] **Step 4: Run the tests**

Run: `corepack pnpm vitest run scripts/infra`
Expected: PASS (8 tests).

- [ ] **Step 5: Write the command and the password client**

Create `scripts/infra/vault-pass.sh` and make it executable:

```sh
#!/bin/sh
# Vault password client: infra:secrets passes the password to ansible-vault
# through the environment of that one child process, never through a file.
printf '%s\n' "${DISHKEPT_VAULT_PASS:?}"
```

Create `scripts/infra/secrets.mjs`:

```js
// pnpm infra:secrets [--edit | --refresh] (infrastructure spec §4).
// Plaintext only ever moves through pipes; nothing unencrypted is written.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { buildProdEnv, generatedSecrets, PROMPTED, promptValue } from '../prod/lib.mjs';
import {
  parseVaultYaml,
  planSecretsRun,
  refreshEnv,
  tofuValues,
  vaultYaml,
  VAULT_FILE,
} from './lib.mjs';

const mode = process.argv.includes('--edit')
  ? 'edit'
  : process.argv.includes('--refresh')
    ? 'refresh'
    : 'create';
const problem = planSecretsRun({ mode, vaultExists: existsSync(VAULT_FILE) });
if (problem) {
  console.error(problem);
  process.exit(1);
}

/** A hidden answer: nothing is echoed. */
async function askHidden(question) {
  process.stdout.write(question);
  const stdin = process.stdin;
  stdin.setRawMode?.(true);
  let answer = '';
  for await (const chunk of stdin) {
    for (const ch of chunk.toString('utf8')) {
      if (ch === '\r' || ch === '\n') {
        stdin.setRawMode?.(false);
        stdin.pause();
        process.stdout.write('\n');
        return answer;
      }
      if (ch === '\u0003') process.exit(130);
      answer = ch === '\u007f' ? answer.slice(0, -1) : answer + ch;
    }
  }
  return answer;
}

const vaultEnv = (password) => ({ ...process.env, DISHKEPT_VAULT_PASS: password });
const vaultArgs = ['--vault-password-file', 'scripts/infra/vault-pass.sh'];
const tofuOutputs = () =>
  JSON.parse(execFileSync('tofu', ['-chdir=infra/tofu', 'output', '-json'], { encoding: 'utf8' }));

function encrypt(password, plaintext) {
  const result = spawnSync(
    'ansible-vault',
    ['encrypt', ...vaultArgs, '--output', VAULT_FILE, '-'],
    { input: plaintext, env: vaultEnv(password), stdio: ['pipe', 'inherit', 'inherit'] },
  );
  if (result.status !== 0) throw new Error('ansible-vault encrypt failed');
}

function decrypt(password) {
  return execFileSync('ansible-vault', ['view', ...vaultArgs, VAULT_FILE], {
    env: vaultEnv(password),
    encoding: 'utf8',
  });
}

if (mode === 'edit') {
  const password = await askHidden('Vault password: ');
  const result = spawnSync('ansible-vault', ['edit', ...vaultArgs, VAULT_FILE], {
    env: vaultEnv(password),
    stdio: 'inherit',
  });
  process.exit(result.status ?? 1);
}

if (mode === 'refresh') {
  const password = await askHidden('Vault password: ');
  const current = parseVaultYaml(decrypt(password));
  const { keyJson, ...values } = tofuValues(tofuOutputs());
  encrypt(password, vaultYaml({ ...current, env: refreshEnv(current.env, values), keyJson }));
  console.log(`Updated ${VAULT_FILE} from OpenTofu's outputs. Re-run Ansible to apply.`);
  process.exit(0);
}

// create
const { keyJson, ...fromTofu } = tofuValues(tofuOutputs());
const rl = createInterface({ input: process.stdin, output: process.stdout });
const values = { ...generatedSecrets(), ...fromTofu };
for (const { name, hint } of PROMPTED) {
  for (;;) {
    const value = promptValue(await rl.question(`${name} (${hint}): `));
    if (value) {
      values[name] = value;
      break;
    }
    console.log("Required, and may not contain a single quote ('). Try again.");
  }
}
values.BACKUP_ALERT_TO = values.SMTP_FROM;
let githubToken;
for (;;) {
  githubToken = (await rl.question('GitHub read-only token for the VM (github_pat_...): ')).trim();
  if (/^github_pat_[A-Za-z0-9_]+$/.test(githubToken)) break;
  console.log('Expected a fine-grained token: github_pat_ followed by letters, digits and _.');
}
rl.close();
const password = await askHidden('New Vault password (save it in your password manager): ');
if ((await askHidden('Again: ')) !== password || !password) {
  console.error('The passwords differ or are empty; nothing was written.');
  process.exit(1);
}
const env = buildProdEnv(readFileSync('.env.production.example', 'utf8'), values);
encrypt(password, vaultYaml({ env, keyJson, githubToken }));
console.log(`Wrote ${VAULT_FILE} (encrypted). Commit it, then run Ansible.`);
```

In `package.json`, after `test:prod-config`, add:

```json
    "infra:secrets": "node scripts/infra/secrets.mjs",
```

- [ ] **Step 6: Check `ansible-vault` reads stdin, without real secrets**

Run:

```bash
chmod +x scripts/infra/vault-pass.sh
D=$(mktemp -d) && printf 'a: 1\n' | DISHKEPT_VAULT_PASS=x ansible-vault encrypt --vault-password-file scripts/infra/vault-pass.sh --output $D/v.yml - && head -c 14 $D/v.yml; echo; DISHKEPT_VAULT_PASS=x ansible-vault view --vault-password-file scripts/infra/vault-pass.sh $D/v.yml; rm -rf $D
node --check scripts/infra/secrets.mjs
```

Expected: `$ANSIBLE_VAULT`, then `a: 1`, and a clean syntax check. If this Ansible version refuses `-` for stdin, ledger a ruling and switch `encrypt()` to `ansible-vault encrypt_string --stdin-name vault_all`. That would change the Vault file's shape, so update `parseVaultYaml`'s caller to match.

- [ ] **Step 7: Commit**

```bash
git add scripts/infra package.json
git commit -m "feat(infra): pnpm infra:secrets builds the Ansible Vault file from OpenTofu's outputs and the owner's answers (ADR-0018)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: OpenTofu, the state bootstrap, and `pnpm test:infra`

**Files:**
- Create: `scripts/infra/check.mjs`, `infra/bootstrap.sh`, `infra/tofu/main.tf`, `infra/tofu/cloudflare.tf`, `infra/tofu/backups.tf`, `infra/tofu/vm.tf`, `infra/tofu/outputs.tf`, `infra/tofu/.terraform.lock.hcl` (generated)
- Modify: `package.json` (script `test:infra`), `.gitignore`

**Interfaces:**
- Consumes: Task 3 reads the outputs `tunnel_token`, `backup_bucket` and `backup_key_json`.
- Produces:
  - the outputs `nameservers` (list), `tunnel_token`, `backup_bucket`, `backup_key_json`, `vm_name` and `vm_zone` (strings, empty when `vm = false`);
  - the variables `project`, `region`, `zone`, `cloudflare_account_id`, `domain`, `hostname`, `backup_bucket`, `owner_member` and `vm`;
  - `scripts/infra/check.mjs` exports `STEPS` (an array of `[cmd, args, cwd]`), which Task 5 extends.

- [ ] **Step 1: Write the failing check**

Create `scripts/infra/check.mjs`:

```js
// pnpm test:infra: static checks of infra/ (infrastructure spec §7). Touches no cloud account.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

export const STEPS = [
  ['tofu', ['fmt', '-check', '-recursive'], 'infra/tofu'],
  ['tofu', ['init', '-backend=false', '-input=false'], 'infra/tofu'],
  ['tofu', ['validate'], 'infra/tofu'],
];

for (const [cmd, args, cwd] of STEPS) {
  console.log(`$ (cd ${cwd} && ${cmd} ${args.join(' ')})`);
  if (!existsSync(cwd)) {
    console.error(`${cwd} is missing`);
    process.exit(1);
  }
  const result = spawnSync(cmd, args, { cwd, stdio: 'inherit' });
  if (result.error?.code === 'ENOENT') {
    console.error(`${cmd} is not installed; see infra/README.md`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log('infra: ok');
```

In `package.json`, after `infra:secrets`, add `"test:infra": "node scripts/infra/check.mjs",`.

Run: `corepack pnpm test:infra`
Expected: FAIL with `infra/tofu is missing`.

- [ ] **Step 2: Write the bootstrap**

Create `infra/bootstrap.sh` (executable):

```sh
#!/bin/sh
# One-time: the private, versioned bucket that holds OpenTofu's state
# (infrastructure spec §3). Safe to re-run: it changes nothing once the bucket exists.
set -eu
PROJECT=$(gcloud config get-value project 2>/dev/null)
[ -n "$PROJECT" ] || { echo "Set a project: gcloud config set project <id>" >&2; exit 1; }
BUCKET="gs://${PROJECT}-dishkept-tofu-state"
if gcloud storage buckets describe "$BUCKET" >/dev/null 2>&1; then
  echo "$BUCKET exists."
else
  gcloud storage buckets create "$BUCKET" --location=us-east1 \
    --uniform-bucket-level-access --public-access-prevention
  gcloud storage buckets update "$BUCKET" --versioning
  echo "Created $BUCKET."
fi
echo "Next: cd infra/tofu && tofu init -backend-config=bucket=${PROJECT}-dishkept-tofu-state"
```

- [ ] **Step 3: Write the OpenTofu files**

`infra/tofu/main.tf`:

```hcl
# Dishkept's cloud resources (infrastructure spec §3, ADR-0021).
terraform {
  required_version = ">= 1.8"
  required_providers {
    cloudflare = { source = "cloudflare/cloudflare", version = "~> 4.52" }
    google     = { source = "hashicorp/google", version = "~> 6.0" }
    random     = { source = "hashicorp/random", version = "~> 3.6" }
  }
  # The bucket is given at init: tofu init -backend-config=bucket=<project>-dishkept-tofu-state
  backend "gcs" {
    prefix = "dishkept"
  }
}

# Reads CLOUDFLARE_API_TOKEN from the environment.
provider "cloudflare" {}

# Uses application-default credentials (gcloud auth application-default login).
provider "google" {
  project = var.project
  region  = var.region
}

variable "project" {
  type        = string
  description = "The GCP project id"
}

variable "region" {
  type    = string
  default = "us-east1"
}

variable "zone" {
  type    = string
  default = "us-east1-b"
}

variable "cloudflare_account_id" {
  type        = string
  description = "The Cloudflare account id (dashboard sidebar)"
}

variable "domain" {
  type    = string
  default = "geltech.dev"
}

variable "hostname" {
  type    = string
  default = "dishkept"
}

variable "backup_bucket" {
  type        = string
  description = "The backup bucket's globally unique name"
}

variable "owner_member" {
  type        = string
  description = "Who may SSH to the VM, as an IAM member: user:you@example.com"
}

variable "vm" {
  type        = bool
  default     = false
  description = "Create the VM (the trial, or the move off the PC)"
}
```

`infra/tofu/cloudflare.tf`:

```hcl
# The zone, the tunnel and its public hostname (RUNBOOK steps 1–2, now code).
resource "cloudflare_zone" "site" {
  account_id = var.cloudflare_account_id
  zone       = var.domain
  plan       = "free"
}

resource "random_id" "tunnel_secret" {
  byte_length = 32
}

resource "cloudflare_zero_trust_tunnel_cloudflared" "dishkept" {
  account_id = var.cloudflare_account_id
  name       = "dishkept"
  secret     = random_id.tunnel_secret.b64_std
  config_src = "cloudflare"
}

resource "cloudflare_zero_trust_tunnel_cloudflared_config" "dishkept" {
  account_id = var.cloudflare_account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.dishkept.id
  config {
    ingress_rule {
      hostname = "${var.hostname}.${var.domain}"
      service  = "http://proxy:8080"
    }
    ingress_rule {
      service = "http_status:404"
    }
  }
}

resource "cloudflare_record" "app" {
  zone_id = cloudflare_zone.site.id
  name    = var.hostname
  type    = "CNAME"
  content = cloudflare_zero_trust_tunnel_cloudflared.dishkept.cname
  proxied = true
}
```

`infra/tofu/backups.tf`:

```hcl
# The backup bucket and its add-and-read-only account (RUNBOOK step 4, now code).
resource "google_storage_bucket" "backups" {
  name                        = var.backup_bucket
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  lifecycle_rule {
    condition {
      age = 30
    }
    action {
      type = "Delete"
    }
  }
}

resource "google_service_account" "backup" {
  account_id   = "dishkept-backup"
  display_name = "Dishkept backup"
}

# Create and view only: a compromised host can't delete or overwrite old backups.
resource "google_storage_bucket_iam_member" "backup_create" {
  bucket = google_storage_bucket.backups.name
  role   = "roles/storage.objectCreator"
  member = google_service_account.backup.member
}

resource "google_storage_bucket_iam_member" "backup_view" {
  bucket = google_storage_bucket.backups.name
  role   = "roles/storage.objectViewer"
  member = google_service_account.backup.member
}

resource "google_service_account_key" "backup" {
  service_account_id = google_service_account.backup.name
}
```

`infra/tofu/vm.tf`:

```hcl
# The VM, only while var.vm is true (infrastructure spec §3): no external IP,
# outbound through Cloud NAT, SSH only through IAP with OS Login.
resource "google_project_service" "compute" {
  count              = var.vm ? 1 : 0
  service            = "compute.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "iap" {
  count              = var.vm ? 1 : 0
  service            = "iap.googleapis.com"
  disable_on_destroy = false
}

resource "google_compute_network" "dishkept" {
  count                   = var.vm ? 1 : 0
  name                    = "dishkept"
  auto_create_subnetworks = false
  depends_on              = [google_project_service.compute]
}

resource "google_compute_subnetwork" "dishkept" {
  count         = var.vm ? 1 : 0
  name          = "dishkept"
  region        = var.region
  network       = google_compute_network.dishkept[0].id
  ip_cidr_range = "10.10.0.0/24"
}

resource "google_compute_router" "dishkept" {
  count   = var.vm ? 1 : 0
  name    = "dishkept"
  region  = var.region
  network = google_compute_network.dishkept[0].id
}

resource "google_compute_router_nat" "dishkept" {
  count                              = var.vm ? 1 : 0
  name                               = "dishkept"
  router                             = google_compute_router.dishkept[0].name
  region                             = var.region
  nat_ip_allocate_option             = "AUTO_ONLY"
  source_subnetwork_ip_ranges_to_nat = "ALL_SUBNETWORKS_ALL_IP_RANGES"
}

resource "google_compute_firewall" "iap_ssh" {
  count         = var.vm ? 1 : 0
  name          = "dishkept-iap-ssh"
  network       = google_compute_network.dishkept[0].id
  source_ranges = ["35.235.240.0/20"]
  target_tags   = ["dishkept"]
  allow {
    protocol = "tcp"
    ports    = ["22"]
  }
}

resource "google_project_iam_member" "os_admin_login" {
  count   = var.vm ? 1 : 0
  project = var.project
  role    = "roles/compute.osAdminLogin"
  member  = var.owner_member
}

resource "google_project_iam_member" "iap_tunnel" {
  count   = var.vm ? 1 : 0
  project = var.project
  role    = "roles/iap.tunnelResourceAccessor"
  member  = var.owner_member
}

resource "google_compute_instance" "dishkept" {
  count        = var.vm ? 1 : 0
  name         = "dishkept-vm"
  machine_type = "e2-small"
  zone         = var.zone
  tags         = ["dishkept"]
  boot_disk {
    initialize_params {
      image = "debian-cloud/debian-12"
      size  = 20
      type  = "pd-balanced"
    }
  }
  network_interface {
    subnetwork = google_compute_subnetwork.dishkept[0].id
  }
  metadata = {
    enable-oslogin = "TRUE"
  }
  depends_on = [google_compute_router_nat.dishkept]
}
```

`infra/tofu/outputs.tf`:

```hcl
output "nameservers" {
  description = "Paste these at Porkbun as geltech.dev's authoritative nameservers"
  value       = cloudflare_zone.site.name_servers
}

output "tunnel_token" {
  value     = cloudflare_zero_trust_tunnel_cloudflared.dishkept.tunnel_token
  sensitive = true
}

output "backup_bucket" {
  value = google_storage_bucket.backups.name
}

output "backup_key_json" {
  value     = base64decode(google_service_account_key.backup.private_key)
  sensitive = true
}

# Empty, not an error, when there is no VM (Review Focus 5).
output "vm_name" {
  value = try(google_compute_instance.dishkept[0].name, "")
}

output "vm_zone" {
  value = try(google_compute_instance.dishkept[0].zone, "")
}
```

Add to `.gitignore`:

```
# OpenTofu's provider cache; the lock file is committed.
infra/tofu/.terraform/
```

- [ ] **Step 4: Run the check**

Run: `chmod +x infra/bootstrap.sh && sh -n infra/bootstrap.sh && corepack pnpm test:infra`
Expected: `infra: ok`. `tofu init -backend=false` downloads the providers and writes `.terraform.lock.hcl`. If `fmt -check` fails, run `tofu -chdir=infra/tofu fmt` and re-run. If `validate` rejects an attribute (provider schemas move), fix it to the installed provider's schema, check it with `tofu providers schema -json`, and ledger a ruling.

- [ ] **Step 5: Commit**

```bash
git add scripts/infra/check.mjs package.json .gitignore infra/bootstrap.sh infra/tofu
git commit -m "feat(infra): OpenTofu for the Cloudflare tunnel and DNS, the backup bucket and an optional VM; pnpm test:infra (ADR-0018)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Ansible: inventory, roles and playbooks

**Files:**
- Create:
  - `infra/ansible/ansible.cfg`, `infra/ansible/inventory.yml`, `infra/ansible/group_vars/all/vars.yml`;
  - `infra/ansible/roles/docker/tasks/main.yml`, `infra/ansible/roles/node/tasks/main.yml`, `infra/ansible/roles/app/tasks/main.yml`;
  - `infra/ansible/roles/deploy/tasks/main.yml`, `infra/ansible/roles/deploy/handlers/main.yml`, `infra/ansible/roles/serve/tasks/main.yml`;
  - `infra/ansible/site.yml`, `infra/ansible/trial.yml`.
- Modify: `scripts/infra/check.mjs` (`STEPS`).

**Interfaces:**
- Consumes:
  - the Vault variables `vault_prod_env`, `vault_gcs_backup_key` and `vault_github_read_token` (Task 3);
  - the flags `--no-tunnel` and `--key-file` (Task 1);
  - the outputs `vm_name` and `vm_zone` (Task 4; the VM is named `dishkept-vm`, zone `us-east1-b`).
- Produces:
  - `ansible-playbook site.yml -l pc|vm [-e tunnel=false] [-e force_deploy=true]`;
  - `ansible-playbook trial.yml -l vm`.

- [ ] **Step 1: Extend the check (failing)**

In `scripts/infra/check.mjs`, append to `STEPS`:

```js
  ['ansible-playbook', ['--syntax-check', 'site.yml', 'trial.yml'], 'infra/ansible'],
  ['ansible-lint', ['site.yml', 'trial.yml', 'roles'], 'infra/ansible'],
```

Run: `corepack pnpm test:infra`
Expected: the tofu steps pass, then FAIL with `infra/ansible is missing`.

- [ ] **Step 2: Inventory, config and vars**

`infra/ansible/ansible.cfg`:

```ini
[defaults]
inventory = inventory.yml
roles_path = roles
stdout_callback = default
interpreter_python = auto_silent
```

`infra/ansible/inventory.yml`:

```yaml
# The two places production can run (infrastructure spec §4). A run names one: -l pc or -l vm.
all:
  hosts:
    pc:
      ansible_connection: local
      repo_url: https://github.com/JHGelpi/recipe-app.git
    vm:
      ansible_host: dishkept-vm
      # OS Login's user name for your Google account, for example you_example_com.
      ansible_user: "{{ lookup('ansible.builtin.env', 'DISHKEPT_VM_USER') }}"
      ansible_ssh_private_key_file: ~/.ssh/google_compute_engine
      ansible_ssh_common_args: >-
        -o ProxyCommand='gcloud compute start-iap-tunnel %h 22 --listen-on-stdin
        --zone={{ vm_zone }} --project={{ lookup('ansible.builtin.env', 'DISHKEPT_GCP_PROJECT') }}'
        -o StrictHostKeyChecking=accept-new
      # The repo is private: the VM clones with a read-only token (plan, Global Constraints).
      repo_url: "https://x-access-token:{{ vault_github_read_token }}@github.com/JHGelpi/recipe-app.git"
```

`infra/ansible/group_vars/all/vars.yml`:

```yaml
# Non-secret settings. Secrets are in vault.yml beside this file (ansible-vault).
app_dir: "{{ ansible_env.HOME }}/dishkept"
vm_zone: us-east1-b
# false starts the stack without cloudflared (prod:deploy --no-tunnel): the VM trial.
tunnel: true
force_deploy: false
```

- [ ] **Step 3: The roles**

`infra/ansible/roles/docker/tasks/main.yml`:

```yaml
- name: Install Docker's apt prerequisites
  ansible.builtin.apt:
    name: [ca-certificates, curl, git]
    update_cache: true
  become: true

- name: Add Docker's signing key
  ansible.builtin.get_url:
    url: https://download.docker.com/linux/debian/gpg
    dest: /etc/apt/keyrings/docker.asc
    mode: "0644"
  become: true

- name: Add Docker's apt repository
  ansible.builtin.apt_repository:
    repo: >-
      deb [signed-by=/etc/apt/keyrings/docker.asc]
      https://download.docker.com/linux/debian {{ ansible_distribution_release }} stable
    filename: docker
  become: true

- name: Install Docker Engine and the Compose plugin
  ansible.builtin.apt:
    name: [docker-ce, docker-ce-cli, containerd.io, docker-buildx-plugin, docker-compose-plugin]
  become: true

- name: Start Docker now and at boot
  ansible.builtin.service:
    name: docker
    state: started
    enabled: true
  become: true

- name: Let the user run docker
  ansible.builtin.user:
    name: "{{ ansible_user_id }}"
    groups: docker
    append: true
  become: true
  register: docker_group

- name: Pick up the docker group
  ansible.builtin.meta: reset_connection
```

`infra/ansible/roles/node/tasks/main.yml`:

```yaml
- name: Add NodeSource's signing key
  ansible.builtin.get_url:
    url: https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key
    dest: /etc/apt/keyrings/nodesource.asc
    mode: "0644"
  become: true

- name: Add Node 22's apt repository
  ansible.builtin.apt_repository:
    repo: deb [signed-by=/etc/apt/keyrings/nodesource.asc] https://deb.nodesource.com/node_22.x nodistro main
    filename: nodesource
  become: true

- name: Install Node 22
  ansible.builtin.apt:
    name: nodejs
    update_cache: true
  become: true

- name: Enable pnpm through corepack
  ansible.builtin.command: corepack enable
  args:
    creates: /usr/bin/pnpm
  become: true
```

`infra/ansible/roles/app/tasks/main.yml`:

```yaml
- name: Keep production off the Windows drives (the prod:* guard says the same)
  ansible.builtin.assert:
    that: not app_dir.startswith('/mnt/')
    fail_msg: "{{ app_dir }} is on a Windows drive; production runs from ~/dishkept"

- name: Look for an existing checkout
  ansible.builtin.stat:
    path: "{{ app_dir }}/.git"
  register: checkout

- name: Read the checkout's branch and changes
  ansible.builtin.shell: |
    set -e
    cd "{{ app_dir }}"
    git rev-parse --abbrev-ref HEAD
    git status --porcelain | head -n 20
  register: checkout_state
  changed_when: false
  when: checkout.stat.exists

- name: Refuse a checkout with local changes or on another branch (Review Focus 2)
  ansible.builtin.assert:
    that:
      - checkout_state.stdout_lines[0] == 'main'
      - checkout_state.stdout_lines | length == 1
    fail_msg: >-
      {{ app_dir }} must be a clean main checkout; found branch
      {{ checkout_state.stdout_lines[0] }} with changes:
      {{ checkout_state.stdout_lines[1:] | join(', ') }}
  when: checkout.stat.exists

- name: Clone or fast-forward to main
  ansible.builtin.git:
    repo: "{{ repo_url }}"
    dest: "{{ app_dir }}"
    version: main
    update: true
  register: code
  no_log: "{{ inventory_hostname == 'vm' }}"
  notify: Deploy Dishkept

- name: Install dependencies
  ansible.builtin.command: corepack pnpm install --frozen-lockfile
  args:
    chdir: "{{ app_dir }}"
  when: code.changed
  changed_when: true

- name: Make the private folder
  ansible.builtin.file:
    path: "{{ app_dir }}/.local"
    state: directory
    mode: "0700"

- name: Write .env.production
  ansible.builtin.copy:
    content: "{{ vault_prod_env }}"
    dest: "{{ app_dir }}/.env.production"
    mode: "0600"
  no_log: true
  notify: Deploy Dishkept

- name: Write the GCS backup key
  ansible.builtin.copy:
    content: "{{ vault_gcs_backup_key }}"
    dest: "{{ app_dir }}/.local/gcs-backup-key.json"
    mode: "0600"
  no_log: true
  notify: Deploy Dishkept
```

`infra/ansible/roles/deploy/handlers/main.yml`:

```yaml
- name: Deploy Dishkept
  ansible.builtin.command: corepack pnpm prod:deploy{{ '' if tunnel | bool else ' --no-tunnel' }}
  args:
    chdir: "{{ app_dir }}"
  changed_when: true
```

`infra/ansible/roles/deploy/tasks/main.yml`:

```yaml
- name: Deploy even with nothing new, when asked (-e force_deploy=true)
  ansible.builtin.debug:
    msg: Deploying because force_deploy is set
  changed_when: true
  when: force_deploy | bool
  notify: Deploy Dishkept

- name: Deploy now, so later plays see the running stack
  ansible.builtin.meta: flush_handlers
```

`infra/ansible/roles/serve/tasks/main.yml`:

```yaml
# The PC only serves while Docker Desktop runs (RUNBOOK "Keep the PC serving").
- name: Find Docker Desktop's settings file
  ansible.builtin.shell: wslpath "$(cmd.exe /c 'echo %APPDATA%' 2>/dev/null | tr -d '\r')"
  register: appdata
  changed_when: false
  failed_when: false

- name: Read Docker Desktop's settings
  ansible.builtin.slurp:
    src: "{{ appdata.stdout }}/Docker/settings-store.json"
  register: docker_settings
  failed_when: false
  when: appdata.rc == 0

- name: Warn if Docker Desktop doesn't start at sign-in
  ansible.builtin.debug:
    msg: >-
      WARNING: Docker Desktop doesn't start when you sign in, so production stops after a
      reboot. Turn on Settings > General > "Start Docker Desktop when you sign in".
  when: >-
    docker_settings.content is not defined
    or not ((docker_settings.content | b64decode | from_json).AutoStart | default(false))
```

- [ ] **Step 4: The playbooks**

`infra/ansible/site.yml`:

```yaml
# The whole setup for one host (infrastructure spec §4): ansible-playbook site.yml -l pc|vm
- name: Set up and deploy Dishkept production
  hosts: all
  gather_facts: true
  pre_tasks:
    - name: Run against exactly one host (Review Focus 1)
      ansible.builtin.assert:
        that: ansible_play_hosts_all | length == 1
        fail_msg: name one host with -l pc or -l vm
      run_once: true
  roles:
    - role: docker
      when: inventory_hostname == 'vm'
    - role: node
      when: inventory_hostname == 'vm'
    - role: app
    - role: deploy
    - role: serve
      when: inventory_hostname == 'pc'
```

`infra/ansible/trial.yml`:

```yaml
# The VM trial (infrastructure spec §6 step 8): deploy without the tunnel, then the
# restore drill against the newest backup in the bucket.
- name: Set up the VM without the tunnel
  ansible.builtin.import_playbook: site.yml
  vars:
    tunnel: false

- name: Run the restore drill on the VM
  hosts: vm
  gather_facts: false
  vars_prompt:
    - name: age_secret_key
      prompt: Your AGE-SECRET-KEY-1... line (hidden)
      private: true
  tasks:
    - name: Only on the VM
      ansible.builtin.assert:
        that: inventory_hostname == 'vm'
    - name: Drill with the key, then remove it
      block:
        - name: Write the key for the drill
          ansible.builtin.copy:
            content: "{{ age_secret_key }}\n"
            dest: /tmp/dishkept-age.key
            mode: "0600"
          no_log: true
        - name: Restore the newest backup into a throwaway stack
          ansible.builtin.command: corepack pnpm prod:restore-test --key-file /tmp/dishkept-age.key
          args:
            chdir: "{{ app_dir }}"
          register: drill
          changed_when: false
        - name: Show the drill's result
          ansible.builtin.debug:
            msg: "{{ drill.stdout_lines | select('search', 'DRILL') | list }}"
        - name: Require DRILL PASSED
          ansible.builtin.assert:
            that: "'DRILL PASSED' in drill.stdout"
      always:
        - name: Remove the key
          ansible.builtin.file:
            path: /tmp/dishkept-age.key
            state: absent
```

- [ ] **Step 5: Run the checks**

Install ansible-lint if it's missing: `python3 -m pip install --user ansible-lint`. If this Python (3.8) can't install a current release, try `'ansible-lint<6.9'`. If neither installs, ledger a ruling: `test:infra` skips ansible-lint locally with a printed notice, but only when `CI` is unset, so CI still enforces it.

Run: `corepack pnpm test:infra`
Expected: `infra: ok`. Fix any lint findings in the files, not by disabling rules. A rule that conflicts with the spec (for example `no-changed-when` on the deploy handler) gets a `# noqa: <rule>` with a reason, and a ledgered ruling.

Run, to check Review Focus 1 without touching the machine:

```bash
cd infra/ansible && ansible-playbook site.yml --check -e vault_prod_env=x -e vault_gcs_backup_key=x -e vault_github_read_token=x 2>&1 | grep -E "name one host|failed=" ; cd ../..
```

Expected: it stops at the assert with "name one host with -l pc or -l vm", without changing anything.

- [ ] **Step 6: Commit**

```bash
git add infra/ansible scripts/infra/check.mjs
git commit -m "feat(infra): Ansible sets up the PC or a VM and deploys through prod:*; the VM trial runs the restore drill (ADR-0018)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: CI, docs, and the whole suite

**Files:**
- Modify: `.github/workflows/ci.yml` (static job)
- Create: `docs/adr/0021-infrastructure-as-code.md`, `infra/README.md`
- Modify: `docs/adr/README.md`, `docs/RUNBOOK.md`, `ARCHITECTURE.md`, `CLAUDE.md`

- [ ] **Step 1: CI**

In `.github/workflows/ci.yml`'s `static` job, after `- run: pnpm test`, add:

```yaml
      - uses: opentofu/setup-opentofu@v1
        with:
          tofu_version: 1.10.5
      - run: pip install ansible-core ansible-lint
      - run: pnpm test:infra
```

- [ ] **Step 2: ADR-0021**

Create `docs/adr/0021-infrastructure-as-code.md`:

```markdown
# 0021. Infrastructure as code with OpenTofu and Ansible

- **Status:** Accepted
- **Date:** 2026-10-20

## Context

ADR-0018 runs production on the owner's PC, set up by hand from the RUNBOOK:
- Cloudflare's dashboard, for the zone and the tunnel;
- Cloud Shell, for the backup bucket;
- a hand-made clone and env file.

The owner wants that setup as code. It must work for the PC now and for a cloud VM later, because this app is a proving ground for one that must be hosted elsewhere.

## Decision

1. **OpenTofu** (`infra/tofu`) owns the cloud resources:
   - Cloudflare: the zone, the tunnel, its hostname rule and the DNS record;
   - GCS: the backup bucket, with its 30-day rule and its create-and-view-only service account;
   - a GCP VM, created only while `vm = true`. It has no external IP, outbound goes through Cloud NAT, and SSH only through IAP with OS Login.

   State is in a private, versioned GCS bucket made once by `infra/bootstrap.sh`.
2. **Ansible** (`infra/ansible`) owns the host. There are two hosts, `pc` and `vm`, and a run names one. Its roles:
   - install Docker and Node on the VM;
   - keep a clean `main` clone;
   - write the env file and the key;
   - run `pnpm prod:deploy`.

   The `prod:*` scripts stay the one way to operate production.
3. **Secrets** live in an Ansible Vault file in the private repo, built by `pnpm infra:secrets` from OpenTofu's outputs and the owner's answers. It is unlocked by one password, kept in the owner's password manager. The backup `age` secret key stays outside it.
4. **A VM trial** proves the move: create the VM, deploy without the tunnel, run the restore drill on the PC's latest backup, destroy the VM.

## Consequences

- Production can be rebuilt from the repo, the Vault password and the cloud credentials, even if the PC is lost.
- Two tools to install (OpenTofu, Ansible), and CI checks both statically (`pnpm test:infra`).
- The Porkbun nameserver change and the Windows power settings stay manual.
- The VM clones the private repo with a read-only GitHub token from the Vault file. It must be rotated before it expires.

## Alternatives considered

- **cloud-init with OpenTofu only:** no story for the PC.
- **Ansible only, with its cloud modules:** no state or plan, so drift goes unseen and teardown is messy.
- **GCP Secret Manager:** a cloud dependency for the PC target.
- **Copying `.env.production` from the PC:** the secrets die with the PC.
```

In `docs/adr/README.md`, after the 0020 row, add:

```markdown
| [0021](0021-infrastructure-as-code.md) | Infrastructure as code: OpenTofu for the cloud, Ansible for the hosts, secrets in Ansible Vault | Accepted |
```

- [ ] **Step 3: `infra/README.md`**

Create it with these sections, each with the exact commands from spec §6 and this plan.
1. **Tools:** OpenTofu ≥ 1.8, Ansible core ≥ 2.13, the gcloud CLI, and for the VM, `gcloud compute os-login ssh-keys add --key-file ~/.ssh/google_compute_engine.pub` once.
2. **Credentials, set each session:**
   - `gcloud auth application-default login`;
   - `export CLOUDFLARE_API_TOKEN=…` (Zone:Edit, DNS:Edit, Cloudflare Tunnel:Edit);
   - `export TF_VAR_project=…`, `TF_VAR_cloudflare_account_id=…`, `TF_VAR_backup_bucket=…` and `TF_VAR_owner_member=user:…`;
   - for the VM: `export DISHKEPT_VM_USER=…` and `DISHKEPT_GCP_PROJECT=…`.
3. **First time:** `infra/bootstrap.sh`, then `tofu init -backend-config=…`, then `tofu plan` / `tofu apply`.
4. **The Vault file:** `pnpm infra:secrets` (`--edit`, `--refresh`); Ansible runs take `--ask-vault-pass`.
5. **Running Ansible:**
   - `cd infra/ansible && ansible-playbook site.yml -l pc --ask-vault-pass` (`--check --diff` first);
   - `-e tunnel=false`;
   - `-e force_deploy=true`.
6. **The VM trial:**
   - `tofu apply -var vm=true`;
   - `ansible-playbook trial.yml -l vm --ask-vault-pass`;
   - `tofu apply -var vm=false`.
7. **Static checks:** `pnpm test:infra`.

- [ ] **Step 4: RUNBOOK, ARCHITECTURE, CLAUDE.md**

- **`docs/RUNBOOK.md`, "First-time setup":** replace steps 1–7 with spec §6's steps 1–7, each with its **Check:**, pointing at `infra/README.md` for the commands. The old dashboard and Cloud Shell steps are removed.
  - Keep step 0's rule (production runs from `~/dishkept` on the Linux disk), now done by the `app` role.
  - Keep steps 8–9 as they are, with step 9 noting that Ansible warns about Docker Desktop's sign-in setting.
- **`docs/RUNBOOK.md`, "Rotating secrets":**
  - each secret becomes "`pnpm infra:secrets --edit`, change the line, then `ansible-playbook site.yml -l pc --ask-vault-pass`";
  - for the GCS key: `tofu apply -replace=google_service_account_key.backup`, then `infra:secrets --refresh`, then Ansible, then `pnpm prod:recreate backup`;
  - add the GitHub read token: make a new one, `--edit`, then Ansible on the VM.
- **`docs/RUNBOOK.md`, "Moving to a VM later":** replace it with:
  1. `tofu apply -var vm=true`;
  2. `ansible-playbook site.yml -l vm -e tunnel=false --ask-vault-pass`;
  3. on the VM (`gcloud compute ssh dishkept-vm --tunnel-through-iap`), `cd ~/dishkept && corepack pnpm prod:restore`;
  4. on the PC, `pnpm prod:stop`;
  5. `ansible-playbook site.yml -l vm -e force_deploy=true --ask-vault-pass` (the tunnel is on).
- **`ARCHITECTURE.md`:** in the deployment or production section, add a short paragraph: OpenTofu (`infra/tofu`) creates Cloudflare, GCS and an optional VM, and Ansible (`infra/ansible`) sets up the PC or the VM and runs `prod:*` (ADR-0021).
- **`CLAUDE.md`:** in Commands, after `pnpm test:jwt-rotation`, add:

```bash
pnpm test:infra              # tofu fmt/validate, Ansible syntax and lint; touches no cloud account
pnpm infra:secrets           # build or update the Ansible Vault file (--edit, --refresh); infra/README.md
```

- [ ] **Step 5: Lint and the whole suite**

Run: `rm -rf .vitest && corepack pnpm lint && corepack pnpm typecheck && corepack pnpm test && corepack pnpm test:infra && corepack pnpm test:prod-config`
Expected: all pass. If prettier flags the new YAML or Markdown, run `npx prettier --write` on those files and re-run.

The app is untouched, so the e2e suite isn't required here. Run `pnpm test:e2e` only if Task 1 or 2's CLI change could reach it (it can't; `prod:*` isn't used by e2e).

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/ci.yml docs/adr infra/README.md docs/RUNBOOK.md ARCHITECTURE.md CLAUDE.md
git commit -m "docs: ADR-0021 infrastructure as code; the RUNBOOK sets up production with OpenTofu and Ansible; CI checks infra/

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The live run, with the owner (after the PR from Tasks 1–6 is merged)

This task needs the owner's credentials and approval at each step. It is **not** run by the inline executor. It runs after merge, step by step in conversation, and each `tofu apply` is shown as a plan first.

1. **The owner:**
   - creates the Cloudflare API token, and notes the account id;
   - makes the age key pair (RUNBOOK step 5);
   - has the Zoho app password and the Claude key ready;
   - creates the GitHub fine-grained token (Contents: Read, this repo, 1 year);
   - chooses the backup bucket name and a Vault password.
2. `infra/bootstrap.sh`. **Check:** it prints the bucket.
3. `tofu init -backend-config=bucket=…`, then `tofu plan`, which the owner reviews, then `tofu apply`. **Check:** it prints `nameservers`.
4. **The owner:** pastes the nameservers at Porkbun. **Check:** Cloudflare shows **Active**.
5. `pnpm infra:secrets`. Commit `vault.yml` in a small PR. **Check:** `head -1` shows `$ANSIBLE_VAULT;1.1;AES256`.
6. `ansible-playbook site.yml -l pc --check --diff --ask-vault-pass`, then without `--check`.
   - **Check:** RUNBOOK step 7's checks pass.
   - **Check:** a second run shows `changed=0`.
7. `pnpm prod:backup-now`, then `pnpm prod:restore-test`. **Check:** `DRILL PASSED`.
8. **The VM trial:**
   - `tofu apply -var vm=true`, then `ansible-playbook trial.yml -l vm --ask-vault-pass`. **Check:** `DRILL PASSED`;
   - then `tofu apply -var vm=false`. **Check:** `gcloud compute instances list` is empty.

Record each step's result, and fix any defects found here in a follow-up PR.
