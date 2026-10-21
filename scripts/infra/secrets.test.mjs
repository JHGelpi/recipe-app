import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseVaultYaml } from './lib.mjs';

const script = resolve('scripts/infra/secrets.mjs');

/** A scratch checkout with fake tofu and ansible-vault on PATH. */
function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'infra-secrets-'));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  mkdirSync(join(dir, 'infra/ansible/group_vars/all'), { recursive: true });
  copyFileSync('.env.production.example', join(dir, '.env.production.example'));
  const outputs = {
    tunnel_token: { value: 'eyJtunnel' },
    backup_bucket: { value: 'dishkept-backups-t' },
    backup_key_json: { value: '{"type":"service_account"}' },
  };
  writeFileSync(join(bin, 'tofu'), `#!/bin/sh\necho '${JSON.stringify(outputs)}'\n`);
  // Records the password it was given, and writes stdin (the plaintext) as the "encrypted" file.
  writeFileSync(
    join(bin, 'ansible-vault'),
    `#!/bin/sh
out=""; while [ $# -gt 0 ]; do [ "$1" = "--output" ] && out="$2"; shift; done
printf '%s' "$DISHKEPT_VAULT_PASS" > "${dir}/password-seen"
cat > "$out"
`,
  );
  chmodSync(join(bin, 'tofu'), 0o755);
  chmodSync(join(bin, 'ansible-vault'), 0o755);
  return { dir, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } };
}

const answers = [
  'noreply@example.com', // SMTP_USER
  'app-pass', // SMTP_PASS
  'noreply@example.com', // SMTP_FROM
  'sk-ant-x', // ANTHROPIC_API_KEY
  'age1public', // BACKUP_AGE_RECIPIENT
  'me@example.com', // OWNER_EMAIL
  'github_pat_abc_123', // the VM's read token
  'vault-pw', // new Vault password
  'vault-pw', // again
];

describe('pnpm infra:secrets (final review 1)', () => {
  it('asks every question, then encrypts with the typed password', () => {
    const { dir, env } = scratch();
    const run = spawnSync('node', [script], {
      cwd: dir,
      env,
      input: `${answers.join('\n')}\n`,
      encoding: 'utf8',
      timeout: 15_000,
    });
    expect(run.status, run.stderr + run.stdout).toBe(0);
    expect(readFileSync(join(dir, 'password-seen'), 'utf8')).toBe('vault-pw');
    const vault = parseVaultYaml(
      readFileSync(join(dir, 'infra/ansible/group_vars/all/vault.yml'), 'utf8'),
    );
    expect(vault.env).toMatch(/^SMTP_PASS=app-pass$/m);
    expect(vault.env).toMatch(/^TUNNEL_TOKEN=eyJtunnel$/m);
    // Backup alerts go to someone who reads mail, not to the no-reply sender.
    expect(vault.env).toMatch(/^BACKUP_ALERT_TO=me@example.com$/m);
    expect(vault.githubToken).toBe('github_pat_abc_123');
    // Nothing else written: no plaintext env file beside the "encrypted" one.
    expect(readdirSync(dir).sort()).toEqual(
      ['.env.production.example', 'bin', 'infra', 'password-seen'].sort(),
    );
  });

  it('writes nothing when the two passwords differ', () => {
    const { dir, env } = scratch();
    const run = spawnSync('node', [script], {
      cwd: dir,
      env,
      input: `${[...answers.slice(0, -1), 'other'].join('\n')}\n`,
      encoding: 'utf8',
      timeout: 15_000,
    });
    expect(run.status).toBe(1);
    expect(readdirSync(join(dir, 'infra/ansible/group_vars/all'))).toEqual([]);
  });
});
