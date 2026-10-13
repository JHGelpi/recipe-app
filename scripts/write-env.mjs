// Writes local env files from the running Supabase stack.
// The app file gets only public values; the root file adds test-only values.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const output = execFileSync('pnpm', ['exec', 'supabase', 'status', '-o', 'env'], {
  encoding: 'utf8',
});
const vars = Object.fromEntries(
  [...output.matchAll(/^([A-Z_]+)="?([^"\n]*)"?$/gm)].map((match) => [match[1], match[2]]),
);

for (const name of ['API_URL', 'ANON_KEY', 'DB_URL']) {
  if (!vars[name]) {
    console.error(`supabase status did not report ${name}. Is the stack running?`);
    process.exit(1);
  }
}

const publicLines = [
  `EXPO_PUBLIC_SUPABASE_URL=${vars.API_URL}`,
  `EXPO_PUBLIC_SUPABASE_ANON_KEY=${vars.ANON_KEY}`,
  'EXPO_PUBLIC_POWERSYNC_URL=http://localhost:8080',
];
const testLines = [
  `TEST_DB_URL=${vars.DB_URL}`,
  `TEST_MAIL_URL=${vars.MAILPIT_URL ?? vars.INBUCKET_URL ?? 'http://127.0.0.1:54324'}`,
];

writeFileSync('apps/mobile/.env.local', publicLines.join('\n') + '\n');
writeFileSync('.env.local', [...publicLines, ...testLines].join('\n') + '\n');
console.log('Wrote .env.local and apps/mobile/.env.local');
