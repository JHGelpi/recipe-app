// pnpm infra:secrets [--edit | --refresh] (infrastructure spec §4).
// Plaintext only ever moves through pipes; nothing unencrypted is written.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
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

// Every prompt reads from one readline: a second reader on stdin would find it drained
// or destroyed (final review 1). Lines are queued, so answers typed or piped ahead of
// their question are kept. Hidden answers mute the echo.
let muted = false;
const rl = createInterface({
  input: process.stdin,
  output: new Writable({
    write(chunk, encoding, done) {
      if (!muted) process.stdout.write(chunk, encoding);
      done();
    },
  }),
  terminal: Boolean(process.stdin.isTTY),
});
const queued = [];
const waiting = [];
let ended = false;
rl.on('line', (line) => (waiting.length ? waiting.shift()(line) : queued.push(line)));
rl.on('close', () => {
  ended = true;
  while (waiting.length) waiting.shift()(null);
});

/** The next answer; stops the run if the input ends first. */
async function ask(question) {
  process.stdout.write(question);
  const line = queued.length
    ? queued.shift()
    : ended
      ? null
      : await new Promise((resolveLine) => waiting.push(resolveLine));
  if (line === null) {
    console.error('\nThe input ended before every question was answered; nothing was written.');
    process.exit(1);
  }
  return line;
}

/** A hidden answer: what is typed is not echoed. */
async function askHidden(question) {
  muted = true;
  try {
    return await ask(question);
  } finally {
    muted = false;
    process.stdout.write('\n');
  }
}

const vaultEnv = (password) => ({ ...process.env, DISHKEPT_VAULT_PASS: password });
// Must be executable: ansible-vault reads a non-executable file as the password itself,
// which here is the script's public text (final review 3).
const VAULT_PASS = fileURLToPath(new URL('./vault-pass.sh', import.meta.url));
if (!(statSync(VAULT_PASS).mode & 0o111)) {
  console.error(`${VAULT_PASS} is not executable; run: chmod +x ${VAULT_PASS}`);
  process.exit(1);
}
const vaultArgs = ['--vault-password-file', VAULT_PASS];
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
  // The editor needs the terminal to itself.
  rl.close();
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
const values = { ...generatedSecrets(), ...fromTofu };
for (const { name, hint } of PROMPTED) {
  for (;;) {
    const value = promptValue(await ask(`${name} (${hint}): `));
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
  githubToken = (await ask('GitHub read-only token for the VM (github_pat_...): ')).trim();
  if (/^github_pat_[A-Za-z0-9_]+$/.test(githubToken)) break;
  console.log('Expected a fine-grained token: github_pat_ followed by letters, digits and _.');
}
const password = await askHidden('New Vault password (save it in your password manager): ');
if ((await askHidden('Again: ')) !== password || !password) {
  console.error('The passwords differ or are empty; nothing was written.');
  process.exit(1);
}
const env = buildProdEnv(readFileSync('.env.production.example', 'utf8'), values);
encrypt(password, vaultYaml({ env, keyJson, githubToken }));
rl.close();
console.log(`Wrote ${VAULT_FILE} (encrypted). Commit it, then run Ansible.`);
