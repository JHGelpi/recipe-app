import { existsSync } from 'node:fs';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Run \`pnpm dev:backend\` first.`);
  return value;
}

export const env = {
  get supabaseUrl() {
    return required('EXPO_PUBLIC_SUPABASE_URL');
  },
  get anonKey() {
    return required('EXPO_PUBLIC_SUPABASE_ANON_KEY');
  },
  get dbUrl() {
    return required('TEST_DB_URL');
  },
  get mailUrl() {
    return required('TEST_MAIL_URL');
  },
};
