// CI: the production overlay publishes no ports, keeps the tunnel out of drills,
// and keeps one address from using up the sign-in email budget.
import { execFileSync } from 'node:child_process';
import { composeArgs, DRILL_PROFILES, PROD_PROFILES } from './lib.mjs';

// The example file stands in for .env.production; these fill its required blanks.
const filler = {
  TUNNEL_TOKEN: 'check',
  POSTGRES_PASSWORD: 'x',
  APP_OWNER_PASSWORD: 'x',
  API_LOGIN_PASSWORD: 'x',
  AUTH_DB_PASSWORD: 'x',
  POWERSYNC_REPL_PASSWORD: 'x',
  POWERSYNC_STORAGE_PASSWORD: 'x',
  JWT_SECRET: 'x',
};

const config = (profiles) =>
  JSON.parse(
    execFileSync(
      'docker',
      [
        'compose',
        ...composeArgs().map((arg) =>
          arg === '.env.production' ? '.env.production.example' : arg,
        ),
        ...profiles.flatMap((profile) => ['--profile', profile]),
        'config',
        '--format',
        'json',
      ],
      { encoding: 'utf8', env: { ...process.env, ...filler } },
    ),
  );

const prod = config(PROD_PROFILES);
const published = Object.entries(prod.services).filter(([, s]) => (s.ports ?? []).length > 0);
if (published.length) {
  throw new Error(`Production publishes ports: ${published.map(([name]) => name).join(', ')}`);
}
if (!prod.services.cloudflared) throw new Error('Production has no tunnel');
// Issue #61: one address must not be able to use up the site's email budget.
const auth = prod.services.auth.environment;
const expected = {
  GOTRUE_RATE_LIMIT_HEADER: 'X-Client-IP',
  GOTRUE_RATE_LIMIT_EMAIL_SENT: '60',
  GOTRUE_RATE_LIMIT_OTP: '2',
};
for (const [name, value] of Object.entries(expected)) {
  if (String(auth[name]) !== value) {
    throw new Error(`Production auth ${name} is ${auth[name]}, expected ${value}`);
  }
}
const drill = config(DRILL_PROFILES).services;
if (drill.cloudflared) throw new Error('A drill would start the tunnel');
if (drill.backup) throw new Error('A drill would start the nightly backup loop');
console.log(
  'Production compose config: no published ports; tunnel and backup loop only in production; sign-in email limits set.',
);
