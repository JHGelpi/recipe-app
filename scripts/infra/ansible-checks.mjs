// Behaviour checks of the Ansible roles in --check mode, on scratch git repos (final review
// 4–6). Part of pnpm test:infra; touches no real host or clone.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ansibleDir = resolve('infra/ansible');
const env = { ...process.env, ANSIBLE_CONFIG: join(ansibleDir, 'ansible.cfg') };
const dummies = ['vault_prod_env=x', 'vault_gcs_backup_key=x', 'vault_github_read_token=x'];
const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' });

/** A bare "origin" with one commit on main, and a clean clone of it. */
function repos() {
  const dir = mkdtempSync(join(tmpdir(), 'infra-ansible-'));
  const origin = join(dir, 'origin.git');
  const work = join(dir, 'seed');
  // Not `init -b`: older git (2.25 on Ubuntu 20.04) lacks it.
  git(dir, 'init', '-q', '--bare', origin);
  git(origin, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  git(dir, 'clone', '-q', origin, work);
  git(work, 'checkout', '-q', '-b', 'main');
  writeFileSync(join(work, 'README'), 'x\n');
  git(work, 'add', 'README');
  git(work, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'one');
  git(work, 'push', '-q', 'origin', 'main');
  // Cloned by Ansible's git module, as the app role does: its first look at a clone it
  // didn't make reports a changed remote, and later runs don't.
  const clone = join(dir, 'dishkept');
  execFileSync(
    'ansible',
    [
      'localhost',
      '-c',
      'local',
      '-m',
      'ansible.builtin.git',
      '-a',
      `repo=${origin} dest=${clone} version=main`,
    ],
    { env, stdio: 'pipe' },
  );
  return { dir, origin, clone };
}

/** Runs the app and deploy roles on localhost in --check mode. */
function roles(dir, vars) {
  const play = join(dir, 'play.yml');
  writeFileSync(
    play,
    `- hosts: localhost\n  connection: local\n  gather_facts: true\n  roles: [app, deploy]\n`,
  );
  return spawnSync(
    'ansible-playbook',
    [
      play,
      '--check',
      '-e',
      `roles_path=${ansibleDir}/roles`,
      ...dummies.flatMap((d) => ['-e', d]),
      ...Object.entries(vars).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
    ],
    { env: { ...env, ANSIBLE_ROLES_PATH: join(ansibleDir, 'roles') }, encoding: 'utf8' },
  );
}

const failures = [];
const check = (name, ok, output) => {
  console.log(`${ok ? 'ok' : 'FAIL'}: ${name}`);
  if (!ok) failures.push(`${name}\n${output.slice(-1500)}`);
};

{
  // Final review 4: a local commit ahead of origin must stop the run, not be reset away.
  const { dir, origin, clone } = repos();
  writeFileSync(join(clone, 'local'), 'mine\n');
  git(clone, 'add', 'local');
  git(clone, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'local only');
  const run = roles(dir, { app_dir: clone, repo_url: origin });
  check(
    'a clone with commits not on origin/main is refused',
    run.status !== 0 && run.stdout.includes('commits that are not on origin/main'),
    run.stdout + run.stderr,
  );
}

{
  // The baseline for the next check: an up-to-date clone installs nothing.
  const { dir, origin, clone } = repos();
  const run = roles(dir, { app_dir: clone, repo_url: origin });
  check(
    'an up-to-date clone runs no install',
    run.status === 0 && !run.stdout.includes('RUNNING HANDLER [app : Install dependencies]'),
    run.stdout + run.stderr,
  );
}

{
  // Final review 5: force_deploy reinstalls and deploys, so a failed deploy can be retried.
  const { dir, origin, clone } = repos();
  const run = roles(dir, { app_dir: clone, repo_url: origin, force_deploy: 'true' });
  check(
    'force_deploy runs both handlers',
    run.status === 0 &&
      run.stdout.includes('RUNNING HANDLER [app : Install dependencies]') &&
      run.stdout.includes('RUNNING HANDLER [deploy : Deploy Dishkept]'),
    run.stdout + run.stderr,
  );
}

{
  // Final review 6: trial.yml on the PC must stop before anything runs there.
  const run = spawnSync(
    'ansible-playbook',
    ['trial.yml', '-l', 'pc', '--check', ...dummies.flatMap((d) => ['-e', d])],
    { cwd: ansibleDir, env, encoding: 'utf8', input: '\n' },
  );
  check(
    'trial.yml refuses the PC before any role runs',
    run.status !== 0 &&
      run.stdout.includes('the trial runs on the VM only') &&
      !run.stdout.includes('TASK [app :'),
    run.stdout + run.stderr,
  );
}

{
  // Free-tier change: the VM gets a swap file; the PC never does.
  const list = (host) =>
    spawnSync(
      'ansible-playbook',
      ['site.yml', '-l', host, '--list-tasks', ...dummies.flatMap((d) => ['-e', d])],
      {
        cwd: ansibleDir,
        env,
        encoding: 'utf8',
      },
    ).stdout;
  check('the VM gets a swap file', list('vm').includes('swap : '), list('vm'));
  // On the PC, a dry run of just the swap tasks must skip them all.
  const pc = spawnSync(
    'ansible-playbook',
    ['site.yml', '-l', 'pc', '--check', '--tags', 'swap', ...dummies.flatMap((d) => ['-e', d])],
    { cwd: ansibleDir, env, encoding: 'utf8' },
  );
  // Only fact-gathering runs: every swap task is skipped, and nothing changes.
  const recap = /pc\s*:\s*ok=(\d+)\s+changed=(\d+).*skipped=(\d+)/.exec(pc.stdout);
  check(
    'the PC gets no swap file',
    pc.status === 0 && recap?.[1] === '1' && recap?.[2] === '0' && Number(recap?.[3]) >= 3,
    pc.stdout + pc.stderr,
  );
}

if (failures.length) {
  console.error(`\n${failures.join('\n\n')}`);
  process.exit(1);
}
console.log('ansible checks: ok');
