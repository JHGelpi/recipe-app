import { describe, expect, it } from 'vitest';
import {
  backupAge,
  buildProdEnv,
  composeArgs,
  deployBlockers,
  DRILL_PROFILES,
  normalizeEmail,
  productionSignals,
} from './lib.mjs';

describe('the production guard', () => {
  const safe = { env: {}, argv: [], dotenv: 'PUBLIC_URL=http://localhost:8090\n' };
  it('passes plain dev', () => expect(productionSignals(safe)).toEqual([]));
  it.each([
    [{ ...safe, env: { COMPOSE_PROJECT_NAME: 'dishkept' } }],
    [{ ...safe, env: { COMPOSE_FILE: 'docker-compose.yml:docker-compose.prod.yml' } }],
    [{ ...safe, env: { COMPOSE_ENV_FILES: '.env.production' } }],
    [{ ...safe, argv: ['--env-file', '.env.production'] }],
    [{ ...safe, dotenv: 'APP_ENV=production\n' }],
    [{ ...safe, dotenv: 'COMPOSE_PROJECT_NAME=dishkept\n' }],
  ])('refuses on %j', (input) => expect(productionSignals(input).length).toBeGreaterThan(0));
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
