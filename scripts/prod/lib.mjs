// Decisions behind the prod:* commands and the guard, kept pure for tests.
import { generateKeyPairSync, randomUUID } from 'node:crypto';

export const PROJECT = 'dishkept';
export const ENV_FILE = '.env.production';
/** backup: the nightly job. tunnel: cloudflared, which only production may run. */
export const PROD_PROFILES = ['backup', 'tunnel'];
/**
 * A drill starts no profiled service: not the tunnel (a second connector would
 * serve the drill publicly) and not the nightly loop (it holds the real bucket key).
 * Its restore runs `backup` by name, which needs no profile.
 */
export const DRILL_PROFILES = [];

export function composeArgs(project = PROJECT) {
  return [
    '-p',
    project,
    '--env-file',
    ENV_FILE,
    '-f',
    'docker-compose.yml',
    '-f',
    'docker-compose.prod.yml',
  ];
}

/** Reasons a dev or test command must not run here; empty when it is safe. */
export function productionSignals({ env, argv, dotenv, prodEnvPresent = false }) {
  const reasons = [];
  if (prodEnvPresent) reasons.push('.env.production is here: this is the production checkout');
  if (env.COMPOSE_PROJECT_NAME === PROJECT) reasons.push('COMPOSE_PROJECT_NAME is dishkept');
  if ((env.COMPOSE_FILE ?? '').includes('docker-compose.prod.yml'))
    reasons.push('COMPOSE_FILE names the production overlay');
  if ((env.COMPOSE_ENV_FILES ?? '').includes(ENV_FILE))
    reasons.push('COMPOSE_ENV_FILES names .env.production');
  if (argv.some((arg) => arg.includes(ENV_FILE))) reasons.push('the command names .env.production');
  if (/^APP_ENV=production\s*$/m.test(dotenv)) reasons.push('.env says APP_ENV=production');
  if (/^COMPOSE_PROJECT_NAME=dishkept\s*$/m.test(dotenv))
    reasons.push('.env names the dishkept project');
  return reasons;
}

export function deployBlockers({ branch, dirty, head, originMain }) {
  const blockers = [];
  if (branch !== 'main') blockers.push(`on ${branch}, not main`);
  if (dirty) blockers.push('the working tree has uncommitted changes');
  if (head !== originMain) blockers.push('HEAD is not origin/main (pull or push first)');
  return blockers;
}

export function backupAge(lastSuccessIso, now) {
  const at = lastSuccessIso ? Date.parse(lastSuccessIso) : NaN;
  if (Number.isNaN(at)) return { hours: null, stale: true };
  const hours = Math.round((now.getTime() - at) / 3_600_000);
  return { hours, stale: hours > 26 };
}

export function normalizeEmail(input) {
  const email = input.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

/**
 * Fills each empty `NAME=` line. Single quotes keep values literal for Compose;
 * Compose has no escape inside them, so callers refuse values containing `'`.
 */
export function buildProdEnv(template, values) {
  return template
    .split('\n')
    .map((line) => {
      const name = /^([A-Z0-9_]+)=$/.exec(line)?.[1];
      if (!name || values[name] === undefined) return line;
      const value = values[name];
      return /^[A-Za-z0-9_.:/@+-]*$/.test(value) ? `${name}=${value}` : `${name}='${value}'`;
    })
    .join('\n');
}

/** Every count that differs between a backup's manifest and what a drill restored. */
export function drillCounts(manifest, actual) {
  return Object.entries(manifest.counts).flatMap(([name, expected]) =>
    actual[name] === expected
      ? []
      : [`${name}: backup ${expected}, restored ${actual[name] ?? 'missing'}`],
  );
}

/**
 * Production runs from its own clone on the Linux disk: the stack reads sync
 * rules and migrations from the checkout on every start, and a Windows drive
 * cannot keep .env.production private.
 */
export function checkoutBlockers({ cwd, hasDevEnv }) {
  const blockers = [];
  if (cwd.startsWith('/mnt/')) {
    blockers.push(
      `${cwd} is on a Windows drive; clone the repo to ~/dishkept and run prod:* there`,
    );
  }
  if (hasDevEnv) {
    blockers.push('this checkout has a dev .env; production runs from its own clone (~/dishkept)');
  }
  return blockers;
}

/** First deploy order: services, then the gate, and only then the public tunnel. */
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
