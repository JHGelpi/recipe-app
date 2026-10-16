// Creates .env from .env.example, generating every secret.
// Safe to re-run: an existing .env is never touched.
import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

if (existsSync('.env')) {
  console.log('.env already exists; leaving it alone.');
  process.exit(0);
}

const hex = () => randomBytes(24).toString('hex');

function signingKeys() {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = privateKey.export({ format: 'jwk' });
  const key = { ...jwk, kid: randomUUID(), alg: 'ES256', use: 'sig', key_ops: ['sign', 'verify'] };
  // Single quotes keep the JSON literal for both Docker Compose and Node.
  return `'${JSON.stringify([key])}'`;
}

const generated = {
  POSTGRES_PASSWORD: hex(),
  APP_OWNER_PASSWORD: hex(),
  API_LOGIN_PASSWORD: hex(),
  AUTH_DB_PASSWORD: hex(),
  POWERSYNC_REPL_PASSWORD: hex(),
  POWERSYNC_STORAGE_PASSWORD: hex(),
  JWT_SECRET: randomBytes(32).toString('hex'),
  JWT_KEYS: signingKeys(),
};

const lines = readFileSync('.env.example', 'utf8')
  .split('\n')
  .map((line) => {
    const name = /^([A-Z_]+)=$/.exec(line)?.[1];
    return name && generated[name] ? `${name}=${generated[name]}` : line;
  });

writeFileSync('.env', lines.join('\n'), { mode: 0o600 });
console.log('Wrote .env with generated secrets.');
