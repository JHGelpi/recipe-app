import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('infra files (final review)', () => {
  // A non-executable --vault-password-file is read as the password itself (final review 3).
  it.each(['infra/bootstrap.sh', 'scripts/infra/vault-pass.sh'])(
    '%s is executable in git',
    (file) => {
      const mode = execFileSync('git', ['ls-files', '-s', file], { encoding: 'utf8' }).split(
        ' ',
      )[0];
      expect(mode).toBe('100755');
    },
  );

  // A fresh project has neither on: the service account and IAM bindings need them (final review 7).
  it.each(['iam.googleapis.com', 'cloudresourcemanager.googleapis.com'])(
    'OpenTofu enables %s whether or not there is a VM',
    (api) => {
      const tf = readFileSync('infra/tofu/apis.tf', 'utf8');
      const block = tf.match(
        new RegExp(`resource "google_project_service" "[a-z_]+" \\{[^}]*"${api}"[^}]*\\}`),
      )?.[0];
      expect(block, api).toBeDefined();
      expect(block).not.toContain('count');
    },
  );
});
