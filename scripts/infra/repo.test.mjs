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

describe('the VM fits the free tier (free-tier change)', () => {
  const vm = () => readFileSync('infra/tofu/vm.tf', 'utf8');
  const main = () => readFileSync('infra/tofu/main.tf', 'utf8');

  it('defaults to an e2-micro, overridable with -var machine_type', () => {
    expect(main()).toMatch(/variable "machine_type" \{[^}]*default\s*=\s*"e2-micro"/);
    expect(vm()).toMatch(/machine_type\s*=\s*var\.machine_type/);
  });

  it('uses the free 30 GB standard disk', () => {
    expect(vm()).toMatch(/size\s*=\s*30\b/);
    expect(vm()).toMatch(/type\s*=\s*"pd-standard"/);
  });
});
