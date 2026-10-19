// CI and local: backup → restore drill round trip, with a throwaway key and a
// local folder in place of GCS (production spec §6). Never touches dishkept.
import { execFileSync, spawnSync } from 'node:child_process';
import { drillCounts } from './prod/lib.mjs';

const dc = (args, opts = {}) =>
  execFileSync('docker', ['compose', '--profile', 'backup', ...args], {
    encoding: 'utf8',
    ...opts,
  });
const fail = (m) => {
  console.error(`FAIL: ${m}`);
  process.exit(1);
};

// A throwaway key pair, made inside the backup image.
dc(['build', 'backup']);
const keys = dc(['run', '--rm', '--entrypoint', 'age-keygen', 'backup']);
const secret = keys.match(/^AGE-SECRET-KEY-\S+$/m)?.[0] ?? fail('no key');
const recipient = keys.match(/public key: (age1\S+)/)?.[1] ?? fail('no public key');
const wrong = dc(['run', '--rm', '--entrypoint', 'age-keygen', 'backup']).match(
  /^AGE-SECRET-KEY-\S+$/m,
)[0];

const env = ['-e', `BACKUP_AGE_RECIPIENT=${recipient}`, '-e', 'BACKUP_REMOTE=/backups/offsite'];
// 1. Retention: nine old local copies; after one backup only seven remain.
dc([
  'run',
  '--rm',
  '--entrypoint',
  'sh',
  'backup',
  '-c',
  'mkdir -p /backups/offsite && for d in 01 02 03 04 05 06 07 08 09; do : > /backups/dishkept-2000-01-$d.tar.age; done',
]);
dc(['run', '--rm', ...env, 'backup', 'now'], { stdio: 'inherit' });
const listing = dc([
  'run',
  '--rm',
  '--entrypoint',
  'sh',
  'backup',
  '-c',
  'ls -1 /backups/dishkept-*.tar.age /backups/offsite',
]);
const local = listing.split('\n').filter((l) => l.startsWith('/backups/dishkept-'));
if (local.length !== 7) fail(`kept ${local.length} local copies, not 7`);
const newest = local.sort().at(-1);
if (!/dishkept-\d{4}-\d{2}-\d{2}\.tar\.age$/.test(newest)) fail(`bad name ${newest}`);
if (!listing.includes(newest.split('/').pop())) fail('not uploaded to the remote');

// 1b. Catch-up: a slot never tried (PC off at BACKUP_TIME) runs at the next tick; the next tick does not.
dc(['run', '--rm', '--entrypoint', 'sh', 'backup', '-c', 'echo 0 > /backups/last-attempt']);
const due = dc(['run', '--rm', ...env, 'backup', 'tick']);
if (!due.includes('backup ok')) fail(`a missed slot did not back up:\n${due}`);
const again = dc(['run', '--rm', ...env, 'backup', 'tick']);
if (!again.includes('not due')) fail(`a tried slot backed up again:\n${again}`);

// 2. A failing upload emails an alert (Mailpit).
const failed = spawnSync('docker', [
  'compose',
  '--profile',
  'backup',
  'run',
  '--rm',
  ...env.slice(0, 2),
  '-e',
  'BACKUP_REMOTE=nosuchremote:x',
  '-e',
  'BACKUP_ALERT_TO=ops@example.test',
  'backup',
  'now',
]);
if (failed.status === 0) fail('a broken upload reported success');
const mail = await (
  await fetch('http://127.0.0.1:8025/api/v1/search?query=to:ops@example.test')
).json();
if (!mail.messages?.some((m) => m.Subject.includes('backup FAILED'))) fail('no alert email');

// 3. Restore into a drill project; the wrong key fails before anything is dropped.
const drill = ['-p', 'recipe-app-drill'];
// Its own loopback port, so it never clashes with the dev database's.
const drillEnv = { ...process.env, DB_HOST_PORT: '54339' };
const ddc = (args, opts = {}) => dc([...drill, ...args], { env: drillEnv, ...opts });
try {
  ddc(['up', '-d', '--wait', 'db']);
  const copy = `/tmp/${newest.split('/').pop()}`;
  execFileSync('sh', [
    '-c',
    `docker compose --profile backup run --rm --entrypoint cat backup ${newest} > ${copy}`,
  ]);
  const run = (key) =>
    spawnSync(
      'sh',
      [
        '-c',
        `printf '%s\\n' '${key}' > /tmp/age.key && DB_HOST_PORT=54339 docker compose -p recipe-app-drill --profile backup run --rm ` +
          `-v ${copy}:/restore/in.tar.age:ro -v /tmp/age.key:/run/secrets/age.key:ro backup restore /restore/in.tar.age`,
      ],
      { encoding: 'utf8' },
    );
  const good = run(secret);
  if (good.status !== 0) fail(`restore failed:\n${good.stderr}`);
  const recipesBefore = Number(
    ddc([
      'exec',
      '-T',
      'db',
      'psql',
      '-U',
      'postgres',
      '-d',
      'app',
      '-Atc',
      'select count(*) from public.recipes',
    ]).trim(),
  );
  // The wrong key must fail before anything is dropped (Review Focus 5).
  const bad = run(wrong);
  if (bad.status === 0) fail('restore with the wrong key succeeded');
  const recipesAfter = Number(
    ddc([
      'exec',
      '-T',
      'db',
      'psql',
      '-U',
      'postgres',
      '-d',
      'app',
      '-Atc',
      'select count(*) from public.recipes',
    ]).trim(),
  );
  if (recipesAfter !== recipesBefore) fail('a failed restore changed the database');
  const manifest = JSON.parse(
    good.stdout.slice(good.stdout.indexOf('{'), good.stdout.lastIndexOf('}') + 1),
  );
  const q = (sql) =>
    Number(ddc(['exec', '-T', 'db', 'psql', '-U', 'postgres', '-d', 'app', '-Atc', sql]).trim());
  const actual = {
    users: q('select count(*) from auth.users'),
    households: q('select count(*) from public.households'),
    memberships: q('select count(*) from public.memberships'),
    recipes: q('select count(*) from public.recipes'),
    photos: q('select count(*) from public.photos'),
    shares: q('select count(*) from public.shares'),
    photo_files: Number(
      ddc([
        'run',
        '--rm',
        '--entrypoint',
        'sh',
        'backup',
        '-c',
        'find /data/photos -type f | wc -l',
      ]).trim(),
    ),
  };
  const diffs = drillCounts(manifest, actual);
  if (diffs.length) fail(`counts differ:\n- ${diffs.join('\n- ')}`);
  console.log(`test:backup ok: ${JSON.stringify(actual)}`);
} finally {
  spawnSync('docker', ['compose', ...drill, '--profile', 'backup', 'down', '-v'], {
    stdio: 'inherit',
    env: drillEnv,
  });
}
