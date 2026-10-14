import { existsSync } from 'node:fs';

if (existsSync('.env')) process.loadEnvFile('.env');

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Run \`pnpm env:init\` first.`);
  return value;
}

const dbHost = () => `127.0.0.1:${process.env.DB_HOST_PORT ?? '54329'}`;

export const env = {
  get publicUrl() {
    return required('PUBLIC_URL');
  },
  get authUrl() {
    return `${required('PUBLIC_URL')}/auth`;
  },
  get apiUrl() {
    return `${required('PUBLIC_URL')}/api`;
  },
  get jwksUrl() {
    return `${required('PUBLIC_URL')}/auth/.well-known/jwks.json`;
  },
  get mailUrl() {
    return `http://127.0.0.1:${process.env.MAIL_HOST_PORT ?? '8025'}`;
  },
  /** Superuser. Tests use it only to arrange or inspect state no client can reach. */
  get adminDbUrl() {
    return `postgres://postgres:${required('POSTGRES_PASSWORD')}@${dbHost()}/app`;
  },
  /** The same login the API container uses. */
  get apiDbUrl() {
    return `postgres://api_login:${required('API_LOGIN_PASSWORD')}@${dbHost()}/app`;
  },
  get jwtKeys() {
    return process.env.JWT_KEYS ?? '';
  },
  get jwtSecret() {
    return required('JWT_SECRET');
  },
  get corsDevOrigin() {
    return required('CORS_DEV_ORIGIN');
  },
};
