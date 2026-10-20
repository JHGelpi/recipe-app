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
    const found = await (
      await fetch(`${mail}/api/v1/search?query=to:${encodeURIComponent(email)}`)
    ).json();
    const id = found.messages?.[0]?.ID;
    if (id)
      code = /\b(\d{6})\b/.exec(
        (await (await fetch(`${mail}/api/v1/message/${id}`)).json()).Text,
      )?.[1];
  }
  if (!code) fail(`no code arrived for ${email}`);
  const verified = await post('/verify', { type: 'email', email, token: code });
  if (!verified.ok) fail(`sign-in refused for ${email}: ${verified.status}`);
  return verified.json();
}

const api = async (token) =>
  (await fetch(`${base}/api/imports/usage`, { headers: { Authorization: `Bearer ${token}` } }))
    .status;

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
  // The API refetches the key set at most every 30 s (jose's cooldown), so ask
  // at once and again after it.
  const result = { signInAtOnce: await api(after.access_token) };
  await sleep(31_000);
  result.signInAfter = await api(after.access_token);
  result.oldAccessToken = await api(before.access_token);
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
