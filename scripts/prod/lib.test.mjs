import { describe, expect, it } from 'vitest';
import {
  backupAge,
  buildProdEnv,
  composeArgs,
  deployBlockers,
  DRILL_PROFILES,
  drillCounts,
  newSigningKeys,
  checkoutBlockers,
  deploySequence,
  normalizeEmail,
  photoCheckProblem,
  PHOTO_PATH,
  pickBackup,
  productionSignals,
  generatedSecrets,
  argsFor,
  parseFlags,
  PROMPTED,
  promptValue,
  RECREATABLE,
  withAlertAddress,
} from './lib.mjs';

describe('the production guard', () => {
  const safe = { env: {}, argv: [], dotenv: 'PUBLIC_URL=http://localhost:8090\n' };
  it('passes plain dev', () => expect(productionSignals(safe)).toEqual([]));
  it.each([
    [{ ...safe, prodEnvPresent: true }],
    [{ ...safe, env: { COMPOSE_PROJECT_NAME: 'dishkept' } }],
    [{ ...safe, env: { COMPOSE_FILE: 'docker-compose.yml:docker-compose.prod.yml' } }],
    [{ ...safe, env: { COMPOSE_ENV_FILES: '.env.production' } }],
    [{ ...safe, argv: ['--env-file', '.env.production'] }],
    [{ ...safe, dotenv: 'APP_ENV=production\n' }],
    [{ ...safe, dotenv: 'COMPOSE_PROJECT_NAME=dishkept\n' }],
    [{ ...safe, dotenv: 'APP_ENV="production"\n' }],
    [{ ...safe, dotenv: "APP_ENV='production'\n" }],
    [{ ...safe, dotenv: 'APP_ENV="production"  # live\n' }],
    [{ ...safe, dotenv: 'COMPOSE_PROJECT_NAME="dishkept"\n' }],
    [{ ...safe, dotenv: "COMPOSE_PROJECT_NAME='dishkept'\n" }],
    [{ ...safe, dotenv: "APP_ENV='production' # it's live\n" }],
    [{ ...safe, dotenv: 'APP_ENV="production" # the "live" one\n' }],
    [{ ...safe, dotenv: 'APP_ENV=development\nAPP_ENV=production\n' }],
    [{ ...safe, dotenv: 'export APP_ENV=production\n' }],
  ])('refuses on %j', (input) => expect(productionSignals(input).length).toBeGreaterThan(0));
  it('passes a dev .env that only mentions production in a comment or another value', () =>
    expect(
      productionSignals({ ...safe, dotenv: '# APP_ENV=production\nAPP_ENV=development\n' }),
    ).toEqual([]));
});

describe('deploy preconditions', () => {
  const ok = { branch: 'main', dirty: false, head: 'abc', originMain: 'abc' };
  it('passes a clean, current main', () => expect(deployBlockers(ok)).toEqual([]));
  it('refuses another branch, a dirty tree, or being behind origin/main', () => {
    expect(deployBlockers({ ...ok, branch: 'feat/x' })).toHaveLength(1);
    expect(deployBlockers({ ...ok, dirty: true })).toHaveLength(1);
    expect(deployBlockers({ ...ok, head: 'old' })).toHaveLength(1);
  });
});

describe('backup age', () => {
  const now = new Date('2026-10-20T12:00:00Z');
  it('is fresh under 26 hours and stale over', () => {
    expect(backupAge('2026-10-19T11:00:00Z', now)).toEqual({ hours: 25, stale: false });
    expect(backupAge('2026-10-19T09:00:00Z', now)).toEqual({ hours: 27, stale: true });
  });
  it('is stale when there has never been one or the time is unreadable', () => {
    expect(backupAge(null, now)).toEqual({ hours: null, stale: true });
    expect(backupAge('garbage', now)).toEqual({ hours: null, stale: true });
  });
});

it('normalizes emails for the allowed list', () => {
  expect(normalizeEmail('  Wes@Data2InsightsLLC.com ')).toBe('wes@data2insightsllc.com');
  expect(normalizeEmail('nope')).toBeNull();
});

it('fills empty template values and keeps everything else', () => {
  const template = '# c\nA=\nB=keep\nC=\n';
  expect(buildProdEnv(template, { A: '1', B: 'x', C: 'a b' })).toBe("# c\nA=1\nB=keep\nC='a b'\n");
});

it('compose args name the project, env file and both files; the drill never starts the tunnel', () => {
  expect(composeArgs()).toEqual([
    '-p',
    'dishkept',
    '--env-file',
    '.env.production',
    '-f',
    'docker-compose.yml',
    '-f',
    'docker-compose.prod.yml',
  ]);
  expect(composeArgs('dishkept-drill')[1]).toBe('dishkept-drill');
  expect(DRILL_PROFILES).not.toContain('tunnel');
});

it('the drill reports every count that differs from the manifest', () => {
  const manifest = { counts: { users: 2, recipes: 10, photo_files: 3 } };
  expect(drillCounts(manifest, { users: 2, recipes: 10, photo_files: 3 })).toEqual([]);
  expect(drillCounts(manifest, { users: 2, recipes: 9, photo_files: 3 })).toEqual([
    'recipes: backup 10, restored 9',
  ]);
  expect(drillCounts(manifest, { users: 2, recipes: 10 })).toEqual([
    'photo_files: backup 3, restored missing',
  ]);
});

describe('the production checkout', () => {
  it('passes a dedicated clone on the Linux disk', () =>
    expect(checkoutBlockers({ cwd: '/home/wes/dishkept', hasDevEnv: false })).toEqual([]));
  it('refuses a dev checkout and a Windows drive', () => {
    expect(checkoutBlockers({ cwd: '/home/wes/dishkept', hasDevEnv: true })).toHaveLength(1);
    expect(
      checkoutBlockers({ cwd: '/mnt/d/github_projects/recipe-app', hasDevEnv: false }),
    ).toHaveLength(1);
  });
});

it('a drill starts neither the tunnel nor the nightly backup loop', () => {
  expect(DRILL_PROFILES).toEqual([]);
});

it('deploy turns the gate on before the tunnel makes the site public', () => {
  const steps = deploySequence();
  const tunnel = steps.findIndex((step) => step.profiles?.includes('tunnel'));
  const gate = steps.findIndex((step) => step.gate);
  expect(steps[0].profiles).not.toContain('tunnel');
  expect(gate).toBeGreaterThan(0);
  expect(tunnel).toBeGreaterThan(gate);
});

it('deploy stamps the backup loop with the build right after the stack is up', () => {
  const steps = deploySequence();
  expect(steps.findIndex((step) => step.stampBackup)).toBe(1);
});

describe('picking a backup to restore', () => {
  const names = [
    'dishkept-2026-10-18T0330Z.tar.age',
    'dishkept-2026-10-19.tar.age',
    'dishkept-2026-10-19T0330Z.tar.age',
    'dishkept-2026-10-19T1412Z.tar.age',
    'last-success',
    'dishkept-2026-10-19T1412Z.tar.age', // the same file, in the bucket and on this PC
  ];
  it('takes the newest overall, and the newest of a given day; legacy names sort first', () => {
    expect(pickBackup(names)).toBe('dishkept-2026-10-19T1412Z.tar.age');
    expect(pickBackup(names, '2026-10-18')).toBe('dishkept-2026-10-18T0330Z.tar.age');
    expect(pickBackup(['dishkept-2026-10-19.tar.age'], '2026-10-19')).toBe(
      'dishkept-2026-10-19.tar.age',
    );
  });
  it('has nothing for a day without backups, or no names at all', () => {
    expect(pickBackup(names, '2026-10-20')).toBeNull();
    expect(pickBackup([])).toBeNull();
  });
});

it('the drill compares one photo file to the hash the backup recorded', () => {
  const manifest = { photo_check: { file: 'a/b.jpg', sha256: 'abc' } };
  expect(photoCheckProblem(manifest, 'abc')).toBeNull();
  expect(photoCheckProblem(manifest, 'xyz')).toBe('photo a/b.jpg: backup abc, restored xyz');
  expect(photoCheckProblem(manifest, '')).toBe('photo a/b.jpg: backup abc, restored missing');
  expect(photoCheckProblem({ photo_check: null }, '')).toBeNull();
});

it('photo paths in a manifest are household and photo ids only', () => {
  expect(
    PHOTO_PATH.test(
      '00000000-0000-4000-8000-00000000b4c4/00000000-0000-4000-8000-00000000b4c5.jpg',
    ),
  ).toBe(true);
  expect(PHOTO_PATH.test('../etc/passwd')).toBe(false);
  expect(PHOTO_PATH.test('a/b.jpg; rm -rf /')).toBe(false);
});

it('a new signing key is one ES256 private JWK with its own id', () => {
  const [key, ...rest] = JSON.parse(newSigningKeys());
  expect(rest).toEqual([]);
  expect(key).toMatchObject({ kty: 'EC', crv: 'P-256', alg: 'ES256', use: 'sig' });
  expect(typeof key.d).toBe('string');
  expect(JSON.parse(newSigningKeys())[0].kid).not.toBe(key.kid);
});

it('only the backup loop can be recreated: other services reread files from the checkout', () => {
  expect(RECREATABLE).toEqual(['backup']);
});

describe('the prod flags (infrastructure spec §5)', () => {
  it('deploys the tunnel last by default', () => {
    const steps = deploySequence();
    expect(steps.at(-1).args).toEqual(['up', '-d', '--wait', 'cloudflared']);
  });

  it('with --no-tunnel, starts neither the tunnel nor the backup loop (final review 2)', () => {
    // A stack that takes no traffic must not upload its own empty backup to the shared bucket.
    const steps = deploySequence({ tunnel: false });
    expect(steps.some((step) => step.args?.includes('cloudflared'))).toBe(false);
    expect(steps.some((step) => step.stampBackup)).toBe(false);
    expect(steps.some((step) => step.profiles?.includes('backup'))).toBe(false);
    expect(steps.map((step) => Object.keys(step)[0])).toEqual(['profiles', 'restartSync', 'gate']);
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

describe('argsFor (final review: prod:logs flags)', () => {
  it('passes prod:logs flags straight to Compose', () => {
    expect(argsFor('logs', ['api', '--follow', '--since', '10m'])).toEqual({
      tunnel: true,
      keyFile: null,
      positional: ['api', '--follow', '--since', '10m'],
    });
  });

  it('stays strict for every other command, so a typo never deploys the tunnel', () => {
    expect(() => argsFor('deploy', ['--no-tunel'])).toThrow('Unknown flag: --no-tunel');
    expect(argsFor('deploy', ['--no-tunnel']).tunnel).toBe(false);
  });
});

describe('withAlertAddress (a no-reply sender)', () => {
  it('sends backup alerts to the owner, not to the sender', () => {
    const values = { SMTP_FROM: 'noreply@geltech.dev', OWNER_EMAIL: 'me@example.com' };
    expect(withAlertAddress(values)).toEqual({ ...values, BACKUP_ALERT_TO: 'me@example.com' });
  });
});
