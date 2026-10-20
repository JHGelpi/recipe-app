# Bug batch PR 4: Production scripts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the production-script findings of spec §5. Backups fail loudly and carry their build and time, alert emails use the right TLS and say why, the restore drill checks a photo's bytes and the latest backup in the bucket, the runbook's rotations work as written, and the dev guards close their gaps.

**Architecture:**
- **Shell scripts:** the backup scripts in `scripts/backup/` stay POSIX `sh` in the backup image.
- **Decisions in `lib.mjs`:** every decision the Node CLI makes goes in `scripts/prod/lib.mjs` as a pure function with a unit test: picking a backup, the photo check, the guard, the TLS flags and the signing key.
- **The drill:** the shell behaviour is proven by `pnpm test:backup`, the existing backup → restore drill against the dev stack.
- **The JWT rotation:** a new `pnpm test:jwt-rotation` runs it on a throwaway Compose project on its own ports.

**Tech Stack:** POSIX sh (age, rclone, msmtp, jq, psql in `postgres:17-alpine`), Node 22 ESM scripts, Docker Compose, Caddy, Playwright, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-19-bug-batch-design.md` (§5, and the PR 4 parts of §6 and §7)

## Global Constraints

- CLAUDE.md rule 9: never run test, seed or reset commands against the `dishkept` project. Every new dev or test script starts with `node scripts/guard.mjs`. Only `pnpm prod:*` touches production. Nothing in this plan runs a `prod:*` command; they refuse a dev checkout anyway.
- **Never run `pnpm db:reset`.** After `pnpm test:e2e` or `pnpm dev:backend:test`, run `pnpm dev:backend`, then `docker compose restart sync`.
- Backup names include the time: `dishkept-YYYY-MM-DDTHHMMZ.tar.age` (UTC).
- Alert email: STARTTLS on port 587, implicit TLS on 465, chosen by `SMTP_PORT`. Mailpit's 1025 stays plain.
- The guard reads quoted values (`APP_ENV="production"`, `'production'`).
- Don't send the owner's email or any secret to an outside service. The only mail sent in tests goes to Mailpit.
- Conventional Commits. Every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Found while planning

- **The alert email never got the backup's log.** `backup.sh`'s exit trap removed `$work` before calling `alert.sh "$step" "$work"`, and nothing wrote a log there. Task 2 captures the run's output into a log file and removes it only after the alert.
- **`build` needs a source that matches the app's footer.** The proxy image bakes in its own build time, and Docker's layer cache keeps it while no source changes. So `prod:deploy` and `prod:backup-now` read that time from the running proxy, as `prod:status` already does, and pass it as `BUILD_TIME`.
- **"`fetchBackup` uses `BACKUP_REMOTE`" and "with no date, lists the bucket":** the restore takes the newest name across the bucket and this PC's copies.
  - A local copy newer than the bucket's means that night's upload failed, and it is still the newest data.
  - If the bucket can't be listed, the local copies are used and the person is told.
- **The GCS key rotation needs a command, not only a flag.** Only `prod:*` may touch production, and a bare `docker compose … --force-recreate backup` needs the project, env file and both compose files. Task 4 adds `pnpm prod:recreate backup`, which runs `up -d --no-deps --force-recreate backup`.
- **The JWT rotation step can't work as written.** `pnpm env:init` "in an empty folder" has no `package.json` and no `.env.example` to run against. Task 4:
  - adds `pnpm prod:new-signing-key`, which prints a new `JWT_KEYS=` line;
  - tries the rotation on a throwaway project with `pnpm test:jwt-rotation`;
  - writes the runbook from what that trial shows: whether people stay signed in, or must sign in again.
- **The look e2e flake (PR #17 CI):** in "the end of the list scrolls clear of the tab bar", the footer was measured below the tab bar (786 > 540), because the list was still laying out after `scrollIntoViewIfNeeded`. Task 6 makes it poll until the footer settles.

## Review Focus

1. **A legacy-named backup (`dishkept-2026-10-19.tar.age`) next to new timed ones:** restoring that day picks its newest file, "latest" picks the newest overall, and pruning still keeps the 7 newest. *Test:* Task 3's `pickBackup` unit test with mixed names, and Task 1's retention check.
2. **A psql that fails partway through the manifest (database restarting, a lock):** the run fails, nothing is uploaded, and the alert names the step. *Test:* Task 1's fake-`psql` case in `test:backup`.
3. **The bucket can't be listed (offline, expired key) during `prod:restore` with no date:** the newest local copy is used, with a warning, not a crash or "no backup". *Test:* Task 3's `pickBackup` with only local names. The CLI path prints the warning.
4. **An alert sent before any log exists (a failure at the first step), and the test alert:** both still send, with a Date header. *Test:* Task 2's `test:backup` checks for `prod:test-alert`'s message, sent with no log.
5. **Quoted or commented values in `.env` (`APP_ENV="production"  # live`):** the guard still refuses. *Test:* Task 5's guard unit cases.

---

### Task 1: Backups: a checked manifest, the build, timed names

**Files:**
- Modify:
  - `scripts/backup/backup.sh`, `deploy/backup.Dockerfile` (add `jq`);
  - `docker-compose.yml` (backup service: `BUILD_TIME`), `scripts/test-backup.mjs`;
  - `scripts/prod/lib.mjs`, `scripts/prod/lib.test.mjs`, `scripts/prod/cli.mjs`;
  - `docs/RUNBOOK.md`.

**Interfaces:**
- Produces:
  - backups named `dishkept-YYYY-MM-DDTHHMMZ.tar.age`;
  - `manifest.json`:
    - `{ date, time, build, migration, counts: {...}, photo_check: { file, sha256 } | null }`;
    - `time` is `YYYY-MM-DDTHHMMZ`;
    - `photo_check` is the first photo file in sorted order;
  - `deploySequence()` gains `{ stampBackup: true }` right after the first `up`;
  - `deployedBuild()` in `cli.mjs` returns `string`, the bundle's `YYYY-MM-DD HH:MM` or `'unknown'`.
- Consumed by Task 3: `photo_check` and the name pattern.

- [ ] **Step 1: Write the failing drill checks.** In `scripts/test-backup.mjs`:
  - **Build time:** change `env` to pass a build time:

```js
const env = [
  '-e',
  `BACKUP_AGE_RECIPIENT=${recipient}`,
  '-e',
  'BACKUP_REMOTE=/backups/offsite',
  '-e',
  'BUILD_TIME=2026-01-02 03:04',
];
```

  - **Name pattern:** replace the name check with:

```js
if (!/dishkept-\d{4}-\d{2}-\d{2}T\d{4}Z\.tar\.age$/.test(newest)) fail(`bad name ${newest}`);
```

  - The retention setup already makes nine legacy names (`dishkept-2000-01-0N.tar.age`). The timed name sorts after them, so "7 kept, newest is the timed one" checks Review Focus 1's pruning half.
  - **A sample photo:** just before `// 1. Retention`, add one so the drill has a file to check:

```js
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
```

  - **A failing psql:** after the catch-up block (1b), add:

```js
// 1c. A psql that fails while the manifest is built fails the run; nothing is uploaded (Review Focus 2).
const before = dc(['run', '--rm', '--entrypoint', 'sh', 'backup', '-c', 'ls -1 /backups/offsite | wc -l']).trim();
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
const after = dc(['run', '--rm', '--entrypoint', 'sh', 'backup', '-c', 'ls -1 /backups/offsite | wc -l']).trim();
if (after !== before) fail('a failed manifest was uploaded');
```

  The `sleep 61` moves the run into a new minute, so its name can't match the one just uploaded.
  - **The manifest:** after `const manifest = JSON.parse(...)` in the drill section, add:

```js
if (manifest.build !== '2026-01-02 03:04') fail(`manifest build ${manifest.build}`);
if (!/^\d{4}-\d{2}-\d{2}T\d{4}Z$/.test(manifest.time ?? '')) fail(`manifest time ${manifest.time}`);
if (!manifest.photo_check?.sha256) fail('manifest has no photo check');
```

  - **Clean up the sample:** in the `finally`, before the drill `down`, add:

```js
spawnSync(
  'docker',
  ['compose', '--profile', 'backup', 'run', '--rm', '--entrypoint', 'sh', 'backup', '-c', `rm -rf /data/photos/${SAMPLE.split('/')[0]}`],
  { stdio: 'inherit' },
);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm dev:backend && pnpm test:backup 2>&1 | tail -5`

Expected: `FAIL: bad name /backups/dishkept-2026-…-….tar.age` (date-only name).

- [ ] **Step 3: Write the backup.** Replace `scripts/backup/backup.sh`:

```sh
#!/bin/sh
# One backup: app database + photos + manifest, age-encrypted, uploaded, 7 kept locally.
set -eu
# A failing tar or age inside a pipe must fail the script, not upload a partial file.
set -o pipefail
export PGHOST=db PGUSER=postgres PGDATABASE=app PGPASSWORD="$POSTGRES_PASSWORD"
step=start
work=$(mktemp -d)
# Everything this run prints goes to its log, shown at the end and sent with an alert.
exec 3>&1 4>&2
exec >"$work/log" 2>&1
finish() {
  status=$?
  exec 1>&3 2>&4
  cat "$work/log"
  [ "$status" -eq 0 ] || /opt/backup/alert.sh "$step" "$work/log" || true
  rm -rf "$work"
  exit "$status"
}
trap finish EXIT

stamp=$(date -u +%Y-%m-%dT%H%MZ)
name="dishkept-$stamp.tar.age"

# Any failing query fails the run: set -e does not see failures inside $( ) in a heredoc.
q() { psql -v ON_ERROR_STOP=1 -Atc "$1"; }
number() {
  case "$1" in '' | *[!0-9]*) echo "not a count: '$1'" >&2; exit 1 ;; esac
  printf '%s' "$1"
}

step=prune-passes
psql -v ON_ERROR_STOP=1 -qc "delete from public.signup_passes where expires_at <= now()"

step=dump
pg_dump --format=custom --file="$work/app.dump" app

step=photos
tar -C /data/photos -cf "$work/photos.tar" .

step=manifest
migration=$(q 'select max(version) from dbmate.schema_migrations')
users=$(number "$(q 'select count(*) from auth.users')")
households=$(number "$(q 'select count(*) from public.households')")
memberships=$(number "$(q 'select count(*) from public.memberships')")
recipes=$(number "$(q 'select count(*) from public.recipes')")
photos=$(number "$(q 'select count(*) from public.photos')")
shares=$(number "$(q 'select count(*) from public.shares')")
files=$(number "$(find /data/photos -type f | wc -l | tr -d ' ')")
# One photo's bytes, so a drill can prove files come back intact, not only counted.
sample=$(cd /data/photos && find . -type f -name '*.jpg' | sed 's|^\./||' | sort | head -n 1)
if [ -n "$sample" ]; then
  check=$(jq -n --arg file "$sample" --arg sha256 "$(sha256sum "/data/photos/$sample" | cut -d' ' -f1)" \
    '{file: $file, sha256: $sha256}')
else
  check=null
fi
jq -n --arg date "${stamp%%T*}" --arg time "$stamp" --arg build "${BUILD_TIME:-unknown}" \
  --arg migration "$migration" --argjson check "$check" \
  --argjson users "$users" --argjson households "$households" --argjson memberships "$memberships" \
  --argjson recipes "$recipes" --argjson photos "$photos" --argjson shares "$shares" \
  --argjson files "$files" \
  '{date: $date, time: $time, build: $build, migration: $migration,
    counts: {users: $users, households: $households, memberships: $memberships,
             recipes: $recipes, photos: $photos, shares: $shares, photo_files: $files},
    photo_check: $check}' > "$work/manifest.json"

step=encrypt
tar -C "$work" -cf - app.dump photos.tar manifest.json | age -r "$BACKUP_AGE_RECIPIENT" -o "/backups/$name"

step=upload
rclone copyto "/backups/$name" "${BACKUP_REMOTE:-offsite:$BACKUP_BUCKET}/$name"

step=prune-local
ls -1 /backups/dishkept-*.tar.age | sort | head -n -7 | xargs -r rm --

date -u +%FT%TZ > /backups/last-success
echo "backup ok: $name"
```

  - In `deploy/backup.Dockerfile`, change the `apk add` line to `RUN apk add --no-cache age rclone msmtp tzdata coreutils jq`.
  - In `docker-compose.yml`, add `BUILD_TIME: ${BUILD_TIME:-}` to the backup service's `environment`, after `BACKUP_ALERT_TO`.
  - `alert.sh` gets the log path in `$2`. Task 2 changes `alert.sh` to read it; until then it ignores `$2`.

- [ ] **Step 4: Pass the deployed build from the CLI.**
  - In `scripts/prod/lib.mjs`, change `deploySequence()` so its first `up` is followed by `{ stampBackup: true }`:

```js
export function deploySequence() {
  return [
    { profiles: ['backup'], args: ['up', '-d', '--build', '--wait', '--remove-orphans'] },
    // The nightly loop records the build the proxy now serves (bug batch §5).
    { stampBackup: true },
    { restartSync: true },
    { gate: true },
    { profiles: PROD_PROFILES, args: ['up', '-d', '--wait', 'cloudflared'] },
  ];
}
```

  - Add to `scripts/prod/lib.test.mjs`:

```js
it('deploy stamps the backup loop with the build right after the stack is up', () => {
  const steps = deploySequence();
  expect(steps.findIndex((step) => step.stampBackup)).toBe(1);
});
```

  - In `scripts/prod/cli.mjs`, add a helper after `literal`:

```js
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
```

  - In `status()`, use `console.log(\`Deployed build: ${deployedBuild()}\`);` in place of its inline grep.
  - In `deploy()`'s loop, add this branch before `else if (step.restartSync)`:

```js
      } else if (step.stampBackup) {
        process.env.BUILD_TIME = deployedBuild();
        if (compose(['up', '-d', '--no-deps', 'backup'], {}, ['backup']).status !== 0)
          fail('Deploy failed: pnpm prod:logs backup');
```

  - Change `'backup-now'` to:

```js
  'backup-now'() {
    process.env.BUILD_TIME = deployedBuild();
    return compose(['run', '--rm', '-e', 'BUILD_TIME', 'backup', 'now']);
  },
```

- [ ] **Step 5: Drop the runbook's one-a-day note.** In `docs/RUNBOOK.md`, delete the paragraph that starts "That also means **a second backup on the same day fails at upload**". In step 8's Check, change `dishkept-YYYY-MM-DD.tar.age` to `dishkept-YYYY-MM-DDTHHMMZ.tar.age`.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run scripts && pnpm test:backup 2>&1 | tail -3`

Expected: vitest PASS. `test:backup ok: {...}`. The failing-psql case (1c) passes, because the run fails and uploads nothing.

- [ ] **Step 7: Commit**

```bash
git add scripts/backup/backup.sh deploy/backup.Dockerfile docker-compose.yml scripts/test-backup.mjs scripts/prod docs/RUNBOOK.md
git commit -m "fix(backup): a checked jq manifest that fails on any psql error; the deployed build; timed names; a photo sample (production spec §5)"
```

---

### Task 2: Alert email: TLS by port, a Date header, the log, and a test alert

**Files:**
- Create: `scripts/backup/smtp-tls.sh`
- Modify: `scripts/backup/alert.sh`, `scripts/prod/cli.mjs`, `package.json`, `scripts/test-backup.mjs`, `docs/RUNBOOK.md`, `CLAUDE.md` (the prod command list)

**Interfaces:**
- Consumes (Task 1): `backup.sh` calls `alert.sh <step> <logfile>`.
- Produces:
  - `smtp-tls.sh <port>` prints the msmtp TLS flags;
  - `alert.sh test` sends "Dishkept alert test";
  - `pnpm prod:test-alert`.

- [ ] **Step 1: Write the failing checks.** In `scripts/test-backup.mjs`:
  - after the existing alert check (section 2), add:

```js
// 2b. The alert carries a Date header and the run's last lines.
const alertId = mail.messages.find((m) => m.Subject.includes('backup FAILED')).ID;
const headers = await (await fetch(`http://127.0.0.1:8025/api/v1/message/${alertId}/headers`)).json();
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
dc(['run', '--rm', '--no-deps', '-e', 'BACKUP_ALERT_TO=ops-test@example.test', '--entrypoint', '/opt/backup/alert.sh', 'backup', 'test']);
const tested = await (
  await fetch('http://127.0.0.1:8025/api/v1/search?query=to:ops-test@example.test')
).json();
if (!tested.messages?.some((m) => m.Subject === 'Dishkept alert test')) fail('no test alert');
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test:backup 2>&1 | tail -3`

Expected: `FAIL: the alert has no log lines:` (Mailpit's API always reports a Date, so the header check alone can't fail; the log check fails first).

- [ ] **Step 3: Implement.**
  - Create `scripts/backup/smtp-tls.sh`:

```sh
#!/bin/sh
# msmtp's TLS flags for an SMTP port: STARTTLS on 587, none for Mailpit's 1025
# (tests), implicit TLS otherwise (465).
case "${1:-}" in
  587) echo '--tls=on --tls-starttls=on' ;;
  1025) echo '--tls=off --tls-starttls=off' ;;
  *) echo '--tls=on --tls-starttls=off' ;;
esac
```

  - Replace `scripts/backup/alert.sh`:

```sh
#!/bin/sh
# Emails the owner that a backup failed, with the run's last 30 lines, through
# the stack's SMTP settings. `alert.sh test` sends a test message instead.
set -u
to="${BACKUP_ALERT_TO:-$SMTP_FROM}"
if [ "$1" = test ]; then
  subject='Dishkept alert test'
  text='This is a test of the backup alert. Nothing failed.'
else
  subject="Dishkept backup FAILED ($1)"
  text="The nightly backup failed at step: $1"
fi
{
  printf 'From: %s <%s>\nTo: %s\nDate: %s\nSubject: %s\n\n' \
    "${SMTP_SENDER_NAME:-Dishkept}" "$SMTP_FROM" "$to" "$(date -R)" "$subject"
  echo "$text"
  if [ -n "${2:-}" ] && [ -s "$2" ]; then
    echo
    echo "Last lines of the run:"
    tail -n 30 "$2"
  fi
  echo
  echo "Run: pnpm prod:logs backup"
} | msmtp --host="$SMTP_HOST" --port="$SMTP_PORT" $(/opt/backup/smtp-tls.sh "$SMTP_PORT") \
    --auth="$([ -n "${SMTP_USER:-}" ] && echo on || echo off)" --user="${SMTP_USER:-}" \
    --passwordeval="printf %s \"\$SMTP_PASS\"" --from="$SMTP_FROM" "$to"
```

  (`$(…)` is unquoted on purpose: it expands to two flags.)
  - In `scripts/prod/cli.mjs`, add to `commands`:

```js
  // Sends the backup alert's test message, so the mail settings can be checked (bug batch §5).
  'test-alert': () =>
    compose(['run', '--rm', '--no-deps', '--entrypoint', '/opt/backup/alert.sh', 'backup', 'test']),
```

  - In `package.json`, after `"prod:backup-now"`, add `"prod:test-alert": "node scripts/prod/cli.mjs test-alert",`.
  - In `docs/RUNBOOK.md`, add an Everyday row: `| Check that alert emails arrive | \`pnpm prod:test-alert\` (sends "Dishkept alert test" to \`BACKUP_ALERT_TO\`) |`.
  - In step 3 (Zoho), add: "Port `587` also works: the alert then uses STARTTLS."
  - In `CLAUDE.md`'s Commands comment, add `test-alert` to the `prod:*` list.

- [ ] **Step 4: Run the tests**

Run: `pnpm test:backup 2>&1 | tail -3`

Expected: `test:backup ok: {...}`.

- [ ] **Step 5: Commit**

```bash
git add scripts/backup scripts/prod/cli.mjs package.json scripts/test-backup.mjs docs/RUNBOOK.md CLAUDE.md
git commit -m "fix(backup): alerts use STARTTLS on 587, carry a Date and the run's last lines; prod:test-alert (production spec §5)"
```

---

### Task 3: Restore and the drill: the latest in the bucket, BACKUP_REMOTE, --no-deps, a photo's hash, a clean main

**Files:**
- Modify: `scripts/prod/lib.mjs`, `scripts/prod/lib.test.mjs`, `scripts/prod/cli.mjs`, `scripts/test-backup.mjs`, `docs/RUNBOOK.md`

**Interfaces:**
- Consumes (Task 1): names `dishkept-YYYY-MM-DDTHHMMZ.tar.age`, and `manifest.photo_check`.
- Produces:
  - `pickBackup(names: string[], date?: string): string | null`;
  - `photoCheckProblem(manifest, sha256: string): string | null`;
  - `PHOTO_PATH: RegExp`;
  - `LIST_BACKUPS_SH: string`, which prints `bucket-unreachable` on stderr when the listing fails.

- [ ] **Step 1: Write the failing unit tests.** Add to `scripts/prod/lib.test.mjs`, importing `pickBackup`, `photoCheckProblem` and `PHOTO_PATH`:

```js
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
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run scripts/prod/lib.test.mjs`

Expected: FAIL, `pickBackup is not a function`.

- [ ] **Step 3: Implement the pure parts.** Add to `scripts/prod/lib.mjs`:

```js
const BACKUP_NAME = /^dishkept-\d{4}-\d{2}-\d{2}(T\d{4}Z)?\.tar\.age$/;

/**
 * The backup to restore: the newest of the given day, or the newest of all.
 * Names sort by time; a legacy date-only name sorts before that day's timed ones.
 */
export function pickBackup(names, date) {
  const valid = [...new Set(names.map((name) => name.trim()))].filter((name) =>
    BACKUP_NAME.test(name),
  );
  const matching = date ? valid.filter((name) => name.startsWith(`dishkept-${date}`)) : valid;
  return matching.sort().at(-1) ?? null;
}

/** Household and photo ids only: a manifest's path is used in a shell command. */
export const PHOTO_PATH = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/;

/** Why the drill's sample photo does not match the backup's hash, or null. */
export function photoCheckProblem(manifest, sha256) {
  const check = manifest.photo_check;
  if (!check || sha256 === check.sha256) return null;
  return `photo ${check.file}: backup ${check.sha256}, restored ${sha256 || 'missing'}`;
}

/**
 * Run in the backup container: every backup name in the bucket (or
 * BACKUP_REMOTE) and on this PC, one per line. An unreachable bucket is
 * reported on stderr, and the local names still print.
 */
export const LIST_BACKUPS_SH =
  'rclone lsf "${BACKUP_REMOTE:-offsite:$BACKUP_BUCKET}" --include "dishkept-*.tar.age" || echo bucket-unreachable >&2; ls -1 /backups';
```

  `LIST_BACKUPS_SH` is a plain JS string, so its `${…}` is left for the shell.

- [ ] **Step 4: Run the unit tests**

Run: `npx vitest run scripts/prod/lib.test.mjs`

Expected: PASS.

- [ ] **Step 5: Use them in the CLI.** In `scripts/prod/cli.mjs`:
  - import `LIST_BACKUPS_SH`, `pickBackup`, `photoCheckProblem` and `PHOTO_PATH`;
  - replace `fetchBackup`:

```js
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
```

  - At the start of `'restore-test'`, add `requireCurrentMain('running the drill');`: the drill builds images from this checkout.
  - In `'restore-test'`, after `const diffs = drillCounts(manifest, actual);`:

```js
      const check = manifest.photo_check;
      if (check && !PHOTO_PATH.test(check.file)) fail(`The manifest's photo path is not valid: ${check.file}`);
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
```

- [ ] **Step 6: Prove the shell parts in `test:backup`.** In `scripts/test-backup.mjs`:
  - import `LIST_BACKUPS_SH`, `photoCheckProblem` and `pickBackup` from `./prod/lib.mjs`;
  - after the retention checks (section 1), add:

```js
// 1d. The restore's listing: the bucket (here BACKUP_REMOTE) and local copies, newest picked, no database started.
const names = dc(['run', '--rm', '--no-deps', ...env, '--entrypoint', 'sh', 'backup', '-c', LIST_BACKUPS_SH]);
if (pickBackup(names.split('\n')) !== newest.split('/').pop())
  fail(`the listing did not pick the newest:\n${names}`);
```

  - in the drill section, after the manifest checks from Task 1:

```js
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
```

- [ ] **Step 7: Update the runbook's Restore section.**
  - Step 2 becomes: "Run `pnpm prod:restore` for the newest backup, in the bucket or on this PC, or `pnpm prod:restore 2026-10-19` for that day's newest. A backup not on this PC is fetched from the bucket. If the bucket can't be reached, it says so and chooses from this PC's copies."
  - Step 8's drill note gains: "The drill checks the counts and one photo file's bytes against the backup. It needs a clean, current `main`, like deploy."

- [ ] **Step 8: Run the tests**

Run: `npx vitest run scripts && pnpm test:backup 2>&1 | tail -3`

Expected: PASS, then `test:backup ok: {...}`.

- [ ] **Step 9: Commit**

```bash
git add scripts/prod scripts/test-backup.mjs docs/RUNBOOK.md
git commit -m "fix(restore): the newest backup in the bucket or here, from BACKUP_REMOTE without starting the database; the drill checks a photo's hash and needs a clean main (production spec §5)"
```

---

### Task 4: Runbook rotations that work as written

**Files:**
- Create: `scripts/test-jwt-rotation.mjs`
- Modify:
  - `scripts/prod/lib.mjs`, `scripts/prod/lib.test.mjs`, `scripts/prod/cli.mjs`;
  - `scripts/init-env.mjs`, `package.json`;
  - `docs/RUNBOOK.md`, `CLAUDE.md`.

**Interfaces:**
- Produces:
  - `newSigningKeys(): string`, the JSON array of one ES256 JWK;
  - `pnpm prod:new-signing-key`, `pnpm prod:recreate <service>`, `pnpm test:jwt-rotation`.

- [ ] **Step 1: Write the failing unit test.** Add to `scripts/prod/lib.test.mjs`, importing `newSigningKeys`:

```js
it('a new signing key is one ES256 private JWK with its own id', () => {
  const [key, ...rest] = JSON.parse(newSigningKeys());
  expect(rest).toEqual([]);
  expect(key).toMatchObject({ kty: 'EC', crv: 'P-256', alg: 'ES256', use: 'sig' });
  expect(typeof key.d).toBe('string');
  expect(JSON.parse(newSigningKeys())[0].kid).not.toBe(key.kid);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run scripts/prod/lib.test.mjs`

Expected: FAIL, `newSigningKeys is not a function`.

- [ ] **Step 3: One key generator.**
  - Add to `scripts/prod/lib.mjs`, with `import { generateKeyPairSync, randomUUID } from 'node:crypto';` at the top:

```js
/** A fresh JWT_KEYS value: one ES256 private key as a JWK array (GoTrue signs with it). */
export function newSigningKeys() {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return JSON.stringify([
    {
      ...privateKey.export({ format: 'jwk' }),
      kid: randomUUID(),
      alg: 'ES256',
      use: 'sig',
      key_ops: ['sign', 'verify'],
    },
  ]);
}
```

  - In `scripts/prod/cli.mjs`'s `init`:
    - drop the inline `privateKey`/`jwk` code and use `JWT_KEYS: newSigningKeys(),`;
    - remove `generateKeyPairSync` and `randomUUID` from its crypto import if nothing else uses them.
  - Add commands:

```js
  // Prints a new JWT_KEYS line for the signing-key rotation (RUNBOOK).
  'new-signing-key': () => console.log(`JWT_KEYS='${newSigningKeys()}'`),
  // Recreates one service, for a changed mounted file such as the GCS key (RUNBOOK).
  recreate() {
    const service = rest[0];
    if (!['backup', 'api', 'auth', 'sync', 'proxy'].includes(service ?? ''))
      fail('Usage: pnpm prod:recreate backup|api|auth|sync|proxy');
    if (compose(['up', '-d', '--no-deps', '--force-recreate', service], {}, ['backup']).status !== 0)
      fail('Recreate failed: pnpm prod:logs');
  },
```

  - In `scripts/init-env.mjs`, replace `signingKeys()` with `import { newSigningKeys } from './prod/lib.mjs';` and `JWT_KEYS: \`'${newSigningKeys()}'\`,`.
  - In `package.json`, add `"prod:new-signing-key": "node scripts/prod/cli.mjs new-signing-key",` and `"prod:recreate": "node scripts/prod/cli.mjs recreate",`.

  Run: `npx vitest run scripts/prod/lib.test.mjs`
  Expected: PASS.

- [ ] **Step 4: Write the rotation trial.** Create `scripts/test-jwt-rotation.mjs`:

```js
// The runbook's signing-key rotation, tried on a throwaway Compose project
// (recipe-app-jwt-trial) on its own ports, from a copy of dev's .env with a
// fresh key. Never touches dishkept or dev's data (bug batch spec §5).
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { newSigningKeys } from './prod/lib.mjs';

const ENV_FILE = '.local/jwt-trial.env';
const PORTS = {
  PROXY_PORT: '8190',
  LAN_HTTPS_PORT: '8543',
  DB_HOST_PORT: '54349',
  MAIL_HOST_PORT: '8125',
};
const base = `http://localhost:${PORTS.PROXY_PORT}`;
const mail = `http://127.0.0.1:${PORTS.MAIL_HOST_PORT}`;
const dc = (...args) =>
  execFileSync(
    'docker',
    ['compose', '-p', 'recipe-app-jwt-trial', '--env-file', ENV_FILE, '--profile', 'dev', ...args],
    { stdio: 'inherit' },
  );
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fail = (message) => {
  throw new Error(message);
};

function writeEnv(keys) {
  const overridden = new Set(['PUBLIC_URL', 'JWT_KEYS', ...Object.keys(PORTS)]);
  const lines = readFileSync('.env', 'utf8')
    .split('\n')
    .filter((line) => !overridden.has(line.split('=')[0]));
  lines.push(`PUBLIC_URL=${base}`, `JWT_KEYS='${keys}'`);
  for (const [name, value] of Object.entries(PORTS)) lines.push(`${name}=${value}`);
  writeFileSync(ENV_FILE, `${lines.join('\n')}\n`, { mode: 0o600 });
}

const post = (path, body) =>
  fetch(`${base}/auth${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

async function signIn(email) {
  if (!(await post('/otp', { email, create_user: true })).ok) fail(`no code sent to ${email}`);
  let code;
  for (let i = 0; i < 40 && !code; i++) {
    await sleep(500);
    const found = await (await fetch(`${mail}/api/v1/search?query=to:${encodeURIComponent(email)}`)).json();
    const id = found.messages?.[0]?.ID;
    if (id) code = /\b(\d{6})\b/.exec((await (await fetch(`${mail}/api/v1/message/${id}`)).json()).Text)?.[1];
  }
  if (!code) fail(`no code arrived for ${email}`);
  const verified = await post('/verify', { type: 'email', email, token: code });
  if (!verified.ok) fail(`sign-in refused for ${email}: ${verified.status}`);
  return verified.json();
}

const api = async (token) =>
  (await fetch(`${base}/api/imports/usage`, { headers: { Authorization: `Bearer ${token}` } })).status;

mkdirSync('.local', { recursive: true });
try {
  writeEnv(newSigningKeys());
  dc('up', '-d', '--build', '--wait');
  const before = await signIn(`rotate-before-${Date.now()}@example.test`);
  if ((await api(before.access_token)) !== 200) fail('the API refused a token before rotation');

  // The runbook's steps: a new JWT_KEYS line, then what prod:deploy does (up, restart sync).
  writeEnv(newSigningKeys());
  dc('up', '-d', '--wait');
  dc('restart', 'sync');

  const after = await signIn(`rotate-after-${Date.now()}@example.test`);
  const result = { signInAfter: await api(after.access_token), oldAccessToken: await api(before.access_token) };
  const refreshed = await fetch(`${base}/auth/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: before.refresh_token }),
  });
  result.oldRefresh = refreshed.status;
  if (refreshed.ok) result.refreshedToken = await api((await refreshed.json()).access_token);
  console.log(`test:jwt-rotation: ${JSON.stringify(result)}`);
  if (result.signInAfter !== 200) fail('a sign-in after the rotation was refused by the API');
} finally {
  dc('down', '-v');
  rmSync(ENV_FILE, { force: true });
}
```

  - In `package.json`, add `"test:jwt-rotation": "node scripts/guard.mjs && node scripts/test-jwt-rotation.mjs",` after `test:backup`.

- [ ] **Step 5: Run the trial**

Run: `pnpm test:jwt-rotation 2>&1 | tail -3`

Expected: `test:jwt-rotation: {"signInAfter":200,...}`. Record the full JSON in the ledger. The dev stack on 8090 is untouched: `curl -s -o /dev/null -w '%{http_code}' http://localhost:8090/healthz` prints `200`.

- [ ] **Step 6: Write the rotations from what the trial showed.** In `docs/RUNBOOK.md`'s "Rotating secrets":
  - **Token signing key:**

```markdown
- **Token signing key:** run `pnpm prod:new-signing-key`. It prints a `JWT_KEYS='…'` line; put it in `.env.production` in place of the old `JWT_KEYS=` line. Then `pnpm prod:deploy`. <OUTCOME>
```

  - `<OUTCOME>` comes from the trial's JSON:
    - `refreshedToken` is 200: "People stay signed in: each app renews its session with the new key within 10 minutes."
    - `oldRefresh` is not 2xx, or `refreshedToken` is not 200: "Everyone signs in again."
    - If `oldAccessToken` is 200: "Tokens signed with the old key keep working until they expire, at most 10 minutes."
  - (`pnpm test:jwt-rotation` tries this on a throwaway project; it is listed in CLAUDE.md's commands.)
  - **GCS key:**

```markdown
- **GCS key:** `gcloud iam service-accounts keys create` a new key, replace `.local/gcs-backup-key.json`, then `pnpm prod:recreate backup` (a deploy doesn't restart the backup loop for a changed key file). Run `pnpm prod:backup-now` to check it uploads, then delete the old key in the Cloud Console.
```

  - In `CLAUDE.md`'s Commands block:
    - add `pnpm test:jwt-rotation   # the runbook's signing-key rotation on a throwaway project (needs dev's .env)`;
    - add `test-alert, recreate, new-signing-key` to the `prod:*` list.

- [ ] **Step 7: Commit**

```bash
git add scripts/prod scripts/init-env.mjs scripts/test-jwt-rotation.mjs package.json docs/RUNBOOK.md CLAUDE.md
git commit -m "fix(runbook): the signing-key and GCS key rotations work as written, tried on a throwaway project; prod:new-signing-key and prod:recreate (production spec §5)"
```

---

### Task 5: Safety: quoted values, .local, the gate after an interrupted run, the Caddy comment

**Files:**
- Create: `e2e/setup.ts`
- Modify: `scripts/prod/lib.mjs`, `scripts/prod/lib.test.mjs`, `.dockerignore`, `playwright.config.ts`, `deploy/Caddyfile`

- [ ] **Step 1: Write the failing guard tests.** In `scripts/prod/lib.test.mjs`, add rows to the guard's `it.each`:

```js
    [{ ...safe, dotenv: 'APP_ENV="production"\n' }],
    [{ ...safe, dotenv: "APP_ENV='production'\n" }],
    [{ ...safe, dotenv: 'APP_ENV="production"  # live\n' }],
    [{ ...safe, dotenv: 'COMPOSE_PROJECT_NAME="dishkept"\n' }],
    [{ ...safe, dotenv: "COMPOSE_PROJECT_NAME='dishkept'\n" }],
```

  and one passing case:

```js
  it('passes a dev .env that only mentions production in a comment or another value', () =>
    expect(
      productionSignals({ ...safe, dotenv: '# APP_ENV=production\nAPP_ENV=development\n' }),
    ).toEqual([]));
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run scripts/prod/lib.test.mjs`

Expected: FAIL. The five quoted rows give `expected 0 to be greater than 0`.

- [ ] **Step 3: Read values the way Compose does.** In `scripts/prod/lib.mjs`:

```js
/** A .env value as Compose reads it: quotes removed, a trailing " # comment" dropped. */
function dotenvValue(dotenv, name) {
  const line = dotenv.split('\n').find((l) => new RegExp(`^${name}\\s*=`).test(l));
  if (line === undefined) return null;
  const raw = line.slice(line.indexOf('=') + 1).trim();
  const quoted = /^(["'])(.*)\1/.exec(raw);
  return quoted ? quoted[2] : raw.replace(/\s+#.*$/, '').trim();
}
```

  - In `productionSignals`, replace the two `.env` checks with:

```js
  if (dotenvValue(dotenv, 'APP_ENV') === 'production') reasons.push('.env says APP_ENV=production');
  if (dotenvValue(dotenv, 'COMPOSE_PROJECT_NAME') === PROJECT)
    reasons.push('.env names the dishkept project');
```

  Run: `npx vitest run scripts/prod/lib.test.mjs`
  Expected: PASS.

- [ ] **Step 4: Keep `.local/` out of images, and turn the gate off before e2e.**
  - Add `.local` as a line to `.dockerignore`.
  - Create `e2e/setup.ts`:

```ts
import { setGate } from './helpers';

// An interrupted run can leave the sign-up gate on (specs turn it off in
// afterEach), which would refuse every fresh sign-up in the next run.
export default async function setup(): Promise<void> {
  await setGate(false);
}
```

  - In `playwright.config.ts`, add `globalSetup: './e2e/setup.ts',` above `globalTeardown`.
- [ ] **Step 5: Check the gate reset.**

Run: `pnpm dev:backend:test && docker compose exec -T db psql -U postgres -d app -qc "update public.signup_settings set gate_on = true" && npx playwright test e2e/look.spec.ts -g "a long title wraps" --reporter=line | tail -2; docker compose exec -T db psql -U postgres -d app -Atc "select gate_on from public.signup_settings"`

Expected: the test passes, and the last line prints `f`.

- [ ] **Step 6: Move the Caddyfile comment.** In `deploy/Caddyfile`'s global block:
  - the two lines "A browser that sends plain HTTP to the HTTPS port is redirected to HTTPS rather than shown an error." move to just above `servers :8443 {`;
  - the "Production: the tunnel connector forwards the visitor's scheme and address." line stays above `servers :8080 {`.

  Check: `docker compose exec -T proxy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile` after `pnpm dev:backend`. Expected: `Valid configuration`.

- [ ] **Step 7: Commit**

```bash
git add scripts/prod/lib.mjs scripts/prod/lib.test.mjs .dockerignore e2e/setup.ts playwright.config.ts deploy/Caddyfile
git commit -m "fix(safety): the guard reads quoted values; .local stays out of images; e2e turns the gate off first; the Caddy comment sits by its redirect (production spec §5)"
```

---

### Task 6: The look e2e waits for the list to settle (PR #17 CI)

**Files:**
- Modify: `e2e/look.spec.ts:31-40`

- [ ] **Step 1: Poll until the footer clears the bar.** Replace the body after the `click` on "Recipes":

```ts
  const footer = page.getByLabel('Build');
  const bar = page.getByRole('navigation', { name: 'Main' });
  // The list can still be laying out its rows after the first scroll, so
  // scroll and measure until the footer settles (PR #17 CI).
  await expect
    .poll(async () => {
      await footer.scrollIntoViewIfNeeded();
      const end = (await footer.boundingBox())!;
      const top = (await bar.boundingBox())!;
      return end.y + end.height - (top.y + 1);
    })
    .toBeLessThanOrEqual(0);
```

- [ ] **Step 2: Run it 10 times**

Run: `npx playwright test e2e/look.spec.ts -g "scrolls clear of the tab bar" --repeat-each=10 --reporter=line | tail -2`

Expected: `10 passed`. (This fixes a CI-only timing flake that has never failed locally; there is no failing run to show first. Record a ledger ruling.)

- [ ] **Step 3: Commit**

```bash
git add e2e/look.spec.ts
git commit -m "test(e2e): the end-of-list check waits for the list to settle (PR #17 CI)"
```

---

### Final verification (after Task 6)

- [ ] `pnpm lint && pnpm typecheck`: clean.
- [ ] `pnpm test`: all pass.
- [ ] `pnpm dev:backend && pnpm test:stack && pnpm test:rls`: all pass.
- [ ] `pnpm test:backup`: `test:backup ok`.
- [ ] `pnpm test:prod-config`: ok.
- [ ] `pnpm dev:backend:test && pnpm test:api && pnpm test:e2e`: all pass.
- [ ] `pnpm dev:backend && docker compose restart sync`.
