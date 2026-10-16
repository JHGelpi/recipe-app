import type { VerifierConfig } from './auth/verify';

export type Config = { port: number; databaseUrl: string; verifier: VerifierConfig };

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const audience = env.JWT_AUDIENCE ?? 'authenticated';
  return {
    port: Number(env.PORT ?? 3000),
    databaseUrl: required(env, 'DATABASE_URL'),
    // A published key set when the auth service signs asymmetrically,
    // otherwise the shared secret. Never both.
    verifier: env.JWT_JWKS_URL
      ? { audience, jwksUrl: env.JWT_JWKS_URL }
      : { audience, secret: required(env, 'JWT_SECRET') },
  };
}
