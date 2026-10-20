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
  const env = 'APP_ENV=production\nJWT_KEYS=\'[{"kid":"a"}]\'\nTZ=America/New_York\n';
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
