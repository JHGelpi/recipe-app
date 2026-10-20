// The pure parts of pnpm infra:secrets (infrastructure spec §4). No I/O here.

export const VAULT_FILE = 'infra/ansible/group_vars/all/vault.yml';

/** The values infra:secrets takes from `tofu output -json`. */
export function tofuValues(outputs) {
  const get = (name) => {
    const value = outputs[name]?.value;
    if (typeof value !== 'string' || value === '')
      throw new Error(`Missing OpenTofu output: ${name}`);
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
