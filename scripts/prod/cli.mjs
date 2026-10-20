// The prod:* commands (production spec §2–§5). Never reads .env.
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import {
  backupAge,
  drillCounts,
  DRILL_PROFILES,
  buildProdEnv,
  checkoutBlockers,
  composeArgs,
  deployBlockers,
  deploySequence,
  ENV_FILE,
  LIST_BACKUPS_SH,
  newSigningKeys,
  normalizeEmail,
  parseFlags,
  PHOTO_PATH,
  photoCheckProblem,
  pickBackup,
  PROD_PROFILES,
  RECREATABLE,
} from './lib.mjs';

const profiles = (list) => list.flatMap((p) => ['--profile', p]);
const compose = (args, opts = {}, profileList = PROD_PROFILES) =>
  spawnSync('docker', ['compose', ...composeArgs(), ...profiles(profileList), ...args], {
    stdio: 'inherit',
    ...opts,
  });
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
/** Thrown rather than exiting, so every `finally` (the drill's teardown) still runs. */
class Stop extends Error {}
const fail = (message) => {
  throw new Stop(message);
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

/** The build time baked into the served bundle (the app footer's "Build ..."). */
function deployedBuild() {
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
  return build.stdout?.trim() || 'unknown';
}

const [command, ...args] = process.argv.slice(2);
let flags;
try {
  flags = parseFlags(args);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
const rest = flags.positional;

/** Clean, current main: what the stack reads its sync rules and migrations from. */
function requireCurrentMain(action) {
  git('fetch', 'origin', 'main');
  const blockers = deployBlockers({
    branch: git('rev-parse', '--abbrev-ref', 'HEAD'),
    dirty: git('status', '--porcelain') !== '',
    head: git('rev-parse', 'HEAD'),
    originMain: git('rev-parse', 'origin/main'),
  });
  if (blockers.length) fail(`Not ${action}:\n- ${blockers.join('\n- ')}`);
}

/** --key-file, for runs with no one at the prompt (the VM trial), or the question. */
async function keyPathFromFlagOrAsk() {
  if (flags.keyFile) {
    const keyPath = resolve(flags.keyFile);
    if (!existsSync(keyPath) || !statSync(keyPath).isFile()) fail(`No key file at ${keyPath}`);
    return keyPath;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await askKeyPath(rl);
  } finally {
    rl.close();
  }
}

/** The private key file, as an absolute path (a bare name would be a Compose volume). */
async function askKeyPath(rl) {
  const keyPath = resolve((await rl.question('Path to your age private key file: ')).trim());
  if (!existsSync(keyPath) || !statSync(keyPath).isFile()) fail(`No key file at ${keyPath}`);
  return keyPath;
}

/**
 * The newest backup in the bucket or on this PC, or the named day's newest;
 * fetched from BACKUP_REMOTE (the bucket) when it is not local. Runs without
 * starting the database (--no-deps).
 */
async function fetchBackup(date) {
  const inBackup = (script, stdio) =>
    compose(['run', '--rm', '--no-deps', '-T', '--entrypoint', 'sh', 'backup', '-c', script], {
      stdio,
      encoding: 'utf8',
    });
  const listed = inBackup(LIST_BACKUPS_SH, ['ignore', 'pipe', 'pipe']);
  if ((listed.stderr ?? '').includes('bucket-unreachable'))
    console.log('WARNING: the bucket could not be listed; choosing from this PC’s copies.');
  const wanted = pickBackup((listed.stdout ?? '').split('\n'), date);
  if (!wanted) fail(date ? `No backup from ${date}.` : 'No backup found in the bucket or here.');
  const fetched = inBackup(
    `[ -f /backups/${wanted} ] || rclone copyto "\${BACKUP_REMOTE:-offsite:$BACKUP_BUCKET}/${wanted}" /backups/${wanted}; [ -s /backups/${wanted} ]`,
    ['ignore', 'inherit', 'inherit'],
  );
  if (fetched.status !== 0)
    fail(`Could not get ${wanted} locally or from the bucket. Nothing was changed.`);
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
    const values = {
      POSTGRES_PASSWORD: hex(),
      APP_OWNER_PASSWORD: hex(),
      API_LOGIN_PASSWORD: hex(),
      AUTH_DB_PASSWORD: hex(),
      POWERSYNC_REPL_PASSWORD: hex(),
      POWERSYNC_STORAGE_PASSWORD: hex(),
      JWT_SECRET: randomBytes(32).toString('hex'),
      JWT_KEYS: newSigningKeys(),
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
    requireCurrentMain('deploying');
    // The site goes public only once the gate is on (deploySequence).
    for (const step of deploySequence({ tunnel: flags.tunnel })) {
      if (step.args) {
        if (compose(step.args, {}, step.profiles).status !== 0)
          fail('Deploy failed: pnpm prod:logs');
      } else if (step.stampBackup) {
        process.env.BUILD_TIME = deployedBuild();
        if (compose(['up', '-d', '--no-deps', 'backup'], {}, ['backup']).status !== 0)
          fail('Deploy failed: pnpm prod:logs backup');
      } else if (step.restartSync) {
        compose(['restart', 'sync']);
      } else if (step.gate) {
        ensureGate();
      }
    }
    if (!flags.tunnel)
      console.log('Started without the tunnel: the site is not reachable from outside.');
    commands.status();
  },

  status() {
    compose(['ps']);
    console.log(`Deployed build: ${deployedBuild()}`);
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
  // Starts the containers already built. They reread sync rules and migrations
  // from this checkout, so it must be clean, current main too.
  start() {
    requireCurrentMain('starting');
    compose(['start']);
  },

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

  'backup-now'() {
    process.env.BUILD_TIME = deployedBuild();
    return compose(['run', '--rm', '-e', 'BUILD_TIME', 'backup', 'now']);
  },

  // Sends the backup alert's test message, so the mail settings can be checked (bug batch §5).
  'test-alert': () =>
    compose(['run', '--rm', '--no-deps', '--entrypoint', '/opt/backup/alert.sh', 'backup', 'test']),

  // Prints a new JWT_KEYS line for the signing-key rotation (RUNBOOK).
  'new-signing-key': () => console.log(`JWT_KEYS='${newSigningKeys()}'`),
  // Recreates one service, for a changed mounted file such as the GCS key (RUNBOOK).
  recreate() {
    const service = rest[0];
    // Only the backup loop: the others reread sync rules and migrations from
    // this checkout, which prod:deploy checks is clean, current main.
    if (!RECREATABLE.includes(service ?? ''))
      fail(`Usage: pnpm prod:recreate ${RECREATABLE.join('|')}`);
    // Its environment carries the deployed build; recreating without it would lose the stamp.
    process.env.BUILD_TIME = deployedBuild();
    if (
      compose(['up', '-d', '--no-deps', '--force-recreate', service], {}, ['backup']).status !== 0
    )
      fail('Recreate failed: pnpm prod:logs');
  },

  async restore() {
    const date = rest[0];
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) fail('Usage: pnpm prod:restore [YYYY-MM-DD]');
    requireCurrentMain('restoring');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const keyPath = await askKeyPath(rl);
    const file = await fetchBackup(date);
    console.log(
      `Restoring ${file}. Everything saved after it is lost unless a phone still holds it unsynced.`,
    );
    if ((await rl.question('Type "restore" to continue: ')).trim() !== 'restore')
      fail('Cancelled.');
    rl.close();
    // The backup loop's environment carries the deployed build: read it while the proxy runs,
    // so the `up` after the restore keeps the stamp.
    process.env.BUILD_TIME = deployedBuild();
    compose(['stop', 'api', 'auth', 'sync', 'proxy']);
    const result = compose(
      ['run', '--rm', '-v', `${keyPath}:/run/secrets/age.key:ro`, 'backup', 'restore', file],
      { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' },
    );
    process.stdout.write(result.stdout ?? '');
    if (result.status !== 0) {
      // restore.sh prints "restore: replacing" only once decryption and unpacking worked.
      if (!(result.stdout ?? '').includes('restore: replacing')) {
        compose(['up', '-d', '--wait']);
        fail(
          'Restore failed before anything was replaced (wrong key or damaged file). Production is running again.',
        );
      }
      fail(
        'Restore failed while replacing the data; the stack is stopped. Run prod:restore again with the same backup.',
      );
    }
    compose(['up', '-d', '--wait']);
    compose(['restart', 'sync']);
    commands.status();
  },

  async 'restore-test'() {
    // The drill builds its images from this checkout.
    requireCurrentMain('running the drill');
    const keyPath = await keyPathFromFlagOrAsk();
    const file = await fetchBackup();
    const drill = (args, opts = {}) =>
      spawnSync(
        'docker',
        ['compose', ...composeArgs('dishkept-drill'), ...profiles(DRILL_PROFILES), ...args],
        { encoding: 'utf8', ...opts },
      );
    try {
      if (drill(['up', '-d', '--wait', 'db'], { stdio: 'inherit' }).status !== 0)
        fail('The drill database did not start');
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
      const check = manifest.photo_check;
      if (check && !PHOTO_PATH.test(check.file))
        fail(`The manifest's photo path is not valid: ${check.file}`);
      const sha = check
        ? drill([
            'run',
            '--rm',
            '--entrypoint',
            'sh',
            'backup',
            '-c',
            `sha256sum /data/photos/${check.file} 2>/dev/null | cut -d' ' -f1`,
          ]).stdout.trim()
        : '';
      const photo = photoCheckProblem(manifest, sha);
      if (photo) diffs.push(photo);
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

/** First deploy: list the owner and turn the gate on. Later deploys change nothing here. */
function ensureGate() {
  if (psql(`select count(*) from public.signup_allowed`) !== '0') return;
  const owner = readFileSync(ENV_FILE, 'utf8')
    .match(/^OWNER_EMAIL=(.+)$/m)?.[1]
    ?.trim();
  const email = normalizeEmail(owner ?? '') ?? fail('Set OWNER_EMAIL in .env.production first.');
  psql(`insert into public.signup_allowed (email) values (${literal(email)})`);
  psql(`update public.signup_settings set gate_on = true`);
  console.log(`Gate on; ${email} is allowed.`);
}

try {
  if (process.env.COMPOSE_FILE) fail('Unset COMPOSE_FILE first: prod:* names its own files.');
  const blockers = checkoutBlockers({ cwd: process.cwd(), hasDevEnv: existsSync('.env') });
  if (blockers.length) fail(`Not here:\n- ${blockers.join('\n- ')}`);
  const run = commands[command];
  if (!run) fail(`Unknown command: ${command}. One of: ${Object.keys(commands).join(', ')}`);
  await run();
} catch (error) {
  if (!(error instanceof Stop)) throw error;
  console.error(error.message);
  // An open prompt would keep the process alive; every finally has already run.
  process.exit(1);
}
