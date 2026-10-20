// CI and local: backup → restore drill round trip, with a throwaway key and a
// local folder in place of GCS (production spec §6). Never touches dishkept.
import { execFileSync, spawnSync } from 'node:child_process';
import { drillCounts, LIST_BACKUPS_SH, photoCheckProblem, pickBackup } from './prod/lib.mjs';

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

const env = [
  '-e',
  `BACKUP_AGE_RECIPIENT=${recipient}`,
  '-e',
  'BACKUP_REMOTE=/backups/offsite',
  '-e',
  'BUILD_TIME=2026-01-02 03:04',
];
const SAMPLE = '00000000-0000-4000-8000-00000000b4c4/00000000-0000-4000-8000-00000000b4c5.jpg';
dc([
  'run',
  '--rm',
  '--entrypoint',
  'sh',
  'backup',
  '-c',
  `mkdir -p /data/photos/${SAMPLE.split('/')[0]} && printf 'sample photo bytes' > /data/photos/${SAMPLE}`,
]);
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
if (!/dishkept-\d{4}-\d{2}-\d{2}T\d{4}Z\.tar\.age$/.test(newest)) fail(`bad name ${newest}`);
if (!listing.includes(newest.split('/').pop())) fail('not uploaded to the remote');

// 1d. The restore's listing: the bucket (here BACKUP_REMOTE) and local copies, newest picked, no database started.
const names = dc([
  'run',
  '--rm',
  '--no-deps',
  ...env,
  '--entrypoint',
  'sh',
  'backup',
  '-c',
  LIST_BACKUPS_SH,
]);
if (pickBackup(names.split('\n')) !== newest.split('/').pop())
  fail(`the listing did not pick the newest:\n${names}`);

// 1b. Catch-up: a slot never tried (PC off at BACKUP_TIME) runs at the next tick; the next tick does not.
dc(['run', '--rm', '--entrypoint', 'sh', 'backup', '-c', 'echo 0 > /backups/last-attempt']);
const due = dc(['run', '--rm', ...env, 'backup', 'tick']);
if (!due.includes('backup ok')) fail(`a missed slot did not back up:\n${due}`);
const again = dc(['run', '--rm', ...env, 'backup', 'tick']);
if (!again.includes('not due')) fail(`a tried slot backed up again:\n${again}`);

// 1c. A psql that fails while the manifest is built fails the run; nothing is uploaded (Review Focus 2).
const before = dc([
  'run',
  '--rm',
  '--entrypoint',
  'sh',
  'backup',
  '-c',
  'ls -1 /backups/offsite | wc -l',
]).trim();
const broken = spawnSync('docker', [
  'compose',
  '--profile',
  'backup',
  'run',
  '--rm',
  ...env,
  '--entrypoint',
  'sh',
  'backup',
  '-c',
  `mkdir -p /tmp/fake && printf '%s\\n' '#!/bin/sh' 'case "$*" in *public.shares*) echo "fake psql failure" >&2; exit 2;; esac' 'exec /usr/local/bin/psql "$@"' > /tmp/fake/psql && chmod +x /tmp/fake/psql && sleep 61 && PATH=/tmp/fake:$PATH /opt/backup/backup.sh`,
]);
if (broken.status === 0) fail('a failing psql in the manifest still reported success');
const after = dc([
  'run',
  '--rm',
  '--entrypoint',
  'sh',
  'backup',
  '-c',
  'ls -1 /backups/offsite | wc -l',
]).trim();
if (after !== before) fail('a failed manifest was uploaded');

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

// 2b. The alert carries a Date header and the run's last lines.
const alertId = mail.messages.find((m) => m.Subject.includes('backup FAILED')).ID;
const headers = await (
  await fetch(`http://127.0.0.1:8025/api/v1/message/${alertId}/headers`)
).json();
if (!headers.Date?.length) fail('the alert has no Date header');
const body = (await (await fetch(`http://127.0.0.1:8025/api/v1/message/${alertId}`)).json()).Text;
if (!body.includes('nosuchremote')) fail(`the alert has no log lines:\n${body}`);

// 2c. TLS by port: STARTTLS on 587, implicit TLS on 465, none for Mailpit.
const flags = (port) =>
  dc(['run', '--rm', '--entrypoint', 'sh', 'backup', '/opt/backup/smtp-tls.sh', port]).trim();
if (flags('587') !== '--tls=on --tls-starttls=on') fail(`587: ${flags('587')}`);
if (flags('465') !== '--tls=on --tls-starttls=off') fail(`465: ${flags('465')}`);
if (flags('1025') !== '--tls=off --tls-starttls=off') fail(`1025: ${flags('1025')}`);

// 2d. The test alert sends with no log (Review Focus 4).
dc([
  'run',
  '--rm',
  '--no-deps',
  '-e',
  'BACKUP_ALERT_TO=ops-test@example.test',
  '--entrypoint',
  '/opt/backup/alert.sh',
  'backup',
  'test',
]);
const tested = await (
  await fetch('http://127.0.0.1:8025/api/v1/search?query=to:ops-test@example.test')
).json();
if (!tested.messages?.some((m) => m.Subject === 'Dishkept alert test')) fail('no test alert');

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
  if (manifest.build !== '2026-01-02 03:04') fail(`manifest build ${manifest.build}`);
  if (!/^\d{4}-\d{2}-\d{2}T\d{4}Z$/.test(manifest.time ?? ''))
    fail(`manifest time ${manifest.time}`);
  if (!manifest.photo_check?.sha256) fail('manifest has no photo check');
  const sampleHash = ddc([
    'run',
    '--rm',
    '--entrypoint',
    'sh',
    'backup',
    '-c',
    `sha256sum /data/photos/${manifest.photo_check.file} | cut -d' ' -f1`,
  ]).trim();
  const photoProblem = photoCheckProblem(manifest, sampleHash);
  if (photoProblem) fail(photoProblem);
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
  spawnSync(
    'docker',
    [
      'compose',
      '--profile',
      'backup',
      'run',
      '--rm',
      '--entrypoint',
      'sh',
      'backup',
      '-c',
      `rm -rf /data/photos/${SAMPLE.split('/')[0]}`,
    ],
    { stdio: 'inherit' },
  );
  spawnSync('docker', ['compose', ...drill, '--profile', 'backup', 'down', '-v'], {
    stdio: 'inherit',
    env: drillEnv,
  });
}
