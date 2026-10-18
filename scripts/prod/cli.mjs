// The prod:* commands (production spec §2–§5). Never reads .env.
import { execFileSync, spawnSync } from 'node:child_process';
import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import {
  backupAge,
  drillCounts,
  DRILL_PROFILES,
  buildProdEnv,
  composeArgs,
  deployBlockers,
  ENV_FILE,
  normalizeEmail,
  PROD_PROFILES,
} from './lib.mjs';

const profiles = (list) => list.flatMap((p) => ['--profile', p]);
const compose = (args, opts = {}) =>
  spawnSync('docker', ['compose', ...composeArgs(), ...profiles(PROD_PROFILES), ...args], {
    stdio: 'inherit',
    ...opts,
  });
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const fail = (message) => {
  console.error(message);
  process.exit(1);
};
const psql = (sql) => {
  const result = compose(
    [
      'exec',
      '-T',
      'db',
      'psql',
      '-U',
      'postgres',
      '-d',
      'app',
      '-v',
      'ON_ERROR_STOP=1',
      '-Atc',
      sql,
    ],
    { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' },
  );
  if (result.status !== 0) fail('psql failed');
  return result.stdout.trim();
};
const literal = (value) => `'${value.replaceAll("'", "''")}'`;

if (process.env.COMPOSE_FILE) fail('Unset COMPOSE_FILE first: prod:* names its own files.');
const [command, ...rest] = process.argv.slice(2);

/** The newest local copy, or the named day's; fetched from GCS when it is not local. */
async function fetchBackup(date) {
  const name = (args) =>
    compose(['run', '--rm', '-T', '--entrypoint', 'sh', 'backup', '-c', args], {
      stdio: ['ignore', 'pipe', 'inherit'],
      encoding: 'utf8',
    }).stdout.trim();
  const wanted = date
    ? `dishkept-${date}.tar.age`
    : name('ls -1 /backups/dishkept-*.tar.age 2>/dev/null | sort | tail -n 1 | xargs -r basename');
  if (!wanted) fail('No local backup; name a date to fetch one from GCS.');
  name(
    `[ -f /backups/${wanted} ] || rclone copyto "offsite:$BACKUP_BUCKET/${wanted}" /backups/${wanted}`,
  );
  return `/backups/${wanted}`;
}

const commands = {
  async init() {
    if (existsSync(ENV_FILE)) fail(`${ENV_FILE} exists; edit it by hand.`);
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const ask = async (name, hint) => {
      for (;;) {
        const value = (await rl.question(`${name} (${hint}): `)).trim();
        if (value && !value.includes("'")) return value;
        console.log("Required, and may not contain a single quote ('). Try again.");
      }
    };
    const hex = () => randomBytes(24).toString('hex');
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = {
      ...privateKey.export({ format: 'jwk' }),
      kid: randomUUID(),
      alg: 'ES256',
      use: 'sig',
      key_ops: ['sign', 'verify'],
    };
    const values = {
      POSTGRES_PASSWORD: hex(),
      APP_OWNER_PASSWORD: hex(),
      API_LOGIN_PASSWORD: hex(),
      AUTH_DB_PASSWORD: hex(),
      POWERSYNC_REPL_PASSWORD: hex(),
      POWERSYNC_STORAGE_PASSWORD: hex(),
      JWT_SECRET: randomBytes(32).toString('hex'),
      JWT_KEYS: JSON.stringify([jwk]),
      TUNNEL_TOKEN: await ask('TUNNEL_TOKEN', 'Cloudflare tunnel token'),
      SMTP_USER: await ask('SMTP_USER', 'Zoho login, e.g. wes@data2insightsllc.com'),
      SMTP_PASS: await ask('SMTP_PASS', 'Zoho app-specific password'),
      SMTP_FROM: await ask('SMTP_FROM', 'must equal SMTP_USER for Zoho'),
      ANTHROPIC_API_KEY: await ask('ANTHROPIC_API_KEY', 'sk-ant-...'),
      BACKUP_BUCKET: await ask('BACKUP_BUCKET', 'GCS bucket name'),
      BACKUP_AGE_RECIPIENT: await ask('BACKUP_AGE_RECIPIENT', 'age1... public key'),
      OWNER_EMAIL: await ask('OWNER_EMAIL', 'your sign-in address, added to the allowed list'),
    };
    rl.close();
    values.BACKUP_ALERT_TO = values.SMTP_FROM;
    writeFileSync(ENV_FILE, buildProdEnv(readFileSync('.env.production.example', 'utf8'), values), {
      mode: 0o600,
    });
    console.log(`Wrote ${ENV_FILE}. Next: pnpm prod:deploy`);
  },

  deploy() {
    git('fetch', 'origin', 'main');
    const blockers = deployBlockers({
      branch: git('rev-parse', '--abbrev-ref', 'HEAD'),
      dirty: git('status', '--porcelain') !== '',
      head: git('rev-parse', 'HEAD'),
      originMain: git('rev-parse', 'origin/main'),
    });
    if (blockers.length) fail(`Not deploying:\n- ${blockers.join('\n- ')}`);
    if (compose(['up', '-d', '--build', '--wait', '--remove-orphans']).status !== 0)
      fail('Deploy failed: pnpm prod:logs');
    compose(['restart', 'sync']);
    const owner = readFileSync(ENV_FILE, 'utf8')
      .match(/^OWNER_EMAIL=(.+)$/m)?.[1]
      ?.trim();
    // First deploy: turn the gate on and list the owner. Later deploys change nothing here.
    if (owner && psql(`select count(*) from public.signup_allowed`) === '0') {
      psql(
        `insert into public.signup_allowed (email) values (${literal(normalizeEmail(owner) ?? fail('OWNER_EMAIL is not an email'))})`,
      );
      psql(`update public.signup_settings set gate_on = true`);
      console.log(`Gate on; ${owner} is allowed.`);
    }
    commands.status();
  },

  status() {
    compose(['ps']);
    // The build time baked into the served bundle (the app footer's "Build ...").
    const build = compose(
      [
        'exec',
        '-T',
        'proxy',
        'sh',
        '-c',
        "grep -rhoE '20[0-9]{2}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}' /srv/web/_expo/static/js | head -n 1",
      ],
      { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' },
    );
    console.log(`Deployed build: ${build.stdout?.trim() || 'unknown'}`);
    const last = compose(['exec', '-T', 'backup', 'cat', '/backups/last-success'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    });
    const age = backupAge(last.status === 0 ? last.stdout.trim() : null, new Date());
    console.log(age.hours === null ? 'Backups: none yet' : `Last backup: ${age.hours} h ago`);
    if (age.stale) console.log('WARNING: no successful backup in the last 26 hours.');
  },

  logs: () => compose(['logs', '--tail', '200', ...rest]),
  stop: () => compose(['stop']),

  allow() {
    const email = normalizeEmail(rest[0] ?? '') ?? fail('Usage: pnpm prod:allow you@example.com');
    psql(
      `insert into public.signup_allowed (email) values (${literal(email)}) on conflict do nothing`,
    );
    console.log(`Allowed ${email}`);
  },
  disallow() {
    const email =
      normalizeEmail(rest[0] ?? '') ?? fail('Usage: pnpm prod:disallow you@example.com');
    psql(`delete from public.signup_allowed where email = ${literal(email)}`);
    console.log(`Removed ${email}`);
  },
  allowed: () =>
    console.log(psql(`select email from public.signup_allowed order by email`) || '(none)'),
  gate() {
    if (!['on', 'off'].includes(rest[0] ?? '')) fail('Usage: pnpm prod:gate on|off');
    psql(`update public.signup_settings set gate_on = ${rest[0] === 'on'}`);
    console.log(`Gate ${rest[0]}`);
  },

  'backup-now': () => compose(['run', '--rm', 'backup', 'now']),

  async restore() {
    const date = rest[0];
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) fail('Usage: pnpm prod:restore [YYYY-MM-DD]');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const keyPath = (await rl.question('Path to your age private key file: ')).trim();
    if (!existsSync(keyPath)) fail(`No file at ${keyPath}`);
    const file = await fetchBackup(date);
    console.log(
      `Restoring ${file}. Everything saved after it is lost unless a phone still holds it unsynced.`,
    );
    if ((await rl.question('Type "restore" to continue: ')).trim() !== 'restore')
      fail('Cancelled.');
    rl.close();
    compose(['stop', 'api', 'auth', 'sync', 'proxy']);
    const result = compose([
      'run',
      '--rm',
      '-v',
      `${keyPath}:/run/secrets/age.key:ro`,
      'backup',
      'restore',
      file,
    ]);
    if (result.status !== 0) fail('Restore failed; the stack is stopped. pnpm prod:logs backup');
    compose(['up', '-d', '--wait']);
    compose(['restart', 'sync']);
    commands.status();
  },

  async 'restore-test'() {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const keyPath = (await rl.question('Path to your age private key file: ')).trim();
    rl.close();
    const file = await fetchBackup();
    const drill = (args, opts = {}) =>
      spawnSync(
        'docker',
        ['compose', ...composeArgs('dishkept-drill'), ...profiles(DRILL_PROFILES), ...args],
        { encoding: 'utf8', ...opts },
      );
    try {
      drill(['up', '-d', '--wait', 'db']);
      // Read the file straight from production's backups volume, read-only.
      const source = `/source/${file.split('/').pop()}`;
      const restored = drill([
        'run',
        '--rm',
        '-v',
        'dishkept_backups:/source:ro',
        '-v',
        `${keyPath}:/run/secrets/age.key:ro`,
        'backup',
        'restore',
        source,
      ]);
      if (restored.status !== 0) fail(`Drill restore failed:\n${restored.stderr}`);
      const manifest = JSON.parse(
        restored.stdout.slice(restored.stdout.indexOf('{'), restored.stdout.lastIndexOf('}') + 1),
      );
      if (drill(['up', '-d', '--wait']).status !== 0)
        fail('The restored drill stack did not become healthy');
      const q = (sql) =>
        Number(
          drill([
            'exec',
            '-T',
            'db',
            'psql',
            '-U',
            'postgres',
            '-d',
            'app',
            '-Atc',
            sql,
          ]).stdout.trim(),
        );
      const actual = Object.fromEntries(
        [
          ['users', 'auth.users'],
          ['households', 'public.households'],
          ['memberships', 'public.memberships'],
          ['recipes', 'public.recipes'],
          ['photos', 'public.photos'],
          ['shares', 'public.shares'],
        ].map(([k, t]) => [k, q(`select count(*) from ${t}`)]),
      );
      actual.photo_files = Number(
        drill([
          'run',
          '--rm',
          '--entrypoint',
          'sh',
          'backup',
          '-c',
          'find /data/photos -type f | wc -l',
        ]).stdout.trim(),
      );
      const diffs = drillCounts(manifest, actual);
      console.log(
        diffs.length
          ? `DRILL FAILED:\n- ${diffs.join('\n- ')}`
          : `DRILL PASSED: ${JSON.stringify(actual)}`,
      );
      if (diffs.length) process.exitCode = 1;
    } finally {
      drill(['down', '-v'], { stdio: 'inherit' });
    }
  },
};

const run = commands[command];
if (!run) fail(`Unknown command: ${command}. One of: ${Object.keys(commands).join(', ')}`);
await run();
