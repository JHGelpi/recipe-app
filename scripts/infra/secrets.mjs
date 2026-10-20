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
