// Starts the Expo web dev server pointed at the stack at PUBLIC_URL.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

if (existsSync('.env')) process.loadEnvFile('.env');
const base = process.env.PUBLIC_URL;
if (!base) {
  console.error('PUBLIC_URL is not set. Run `pnpm env:init` first.');
  process.exit(1);
}

const child = spawn('pnpm', ['--filter', 'mobile', 'run', 'web'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    EXPO_PUBLIC_AUTH_URL: `${base}/auth`,
    EXPO_PUBLIC_API_URL: `${base}/api`,
    EXPO_PUBLIC_POWERSYNC_URL: `${base}/sync`,
  },
});
child.on('exit', (code) => process.exit(code ?? 1));
