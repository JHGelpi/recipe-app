import type { VerifierConfig } from './auth/verify';
import type { GitHubConfig } from './feedback/service';
import type { AiConfig } from './llm/gateway';

export type Config = {
  port: number;
  databaseUrl: string;
  verifier: VerifierConfig;
  ai: AiConfig;
  /** Test-only: hosts the page fetcher may reach without the address check. */
  fetchAllowHosts: string[];
  /** Where photo files live (ADR-0013). */
  photosDir: string;
  /** FR-45: where feedback is filed; null until a token is set. */
  github: GitHubConfig | null;
  /** Issue #67: per person, on the signed-in routes that fetch pages or write files. */
  limits: { parsesPerHour: number; uploadsPerMinute: number; photosPerHour: number };
  /** Issue #67: the photo files a household may keep, in bytes. */
  photoQuotaBytes: number;
};

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function amount(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a number of 0 or more`);
  }
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
    ai: {
      apiKey: env.ANTHROPIC_API_KEY || null,
      baseUrl: env.ANTHROPIC_BASE_URL || null,
      model: env.LLM_MODEL_PARSE || 'claude-sonnet-5-5',
      priceInputPerMTokUsd: amount(env, 'LLM_PRICE_INPUT_PER_MTOK_USD', 2),
      priceOutputPerMTokUsd: amount(env, 'LLM_PRICE_OUTPUT_PER_MTOK_USD', 10),
      capUsd: amount(env, 'AI_MONTHLY_CAP_USD', 2),
      globalCapUsd: amount(env, 'AI_GLOBAL_MONTHLY_CAP_USD', 10),
    },
    fetchAllowHosts: (env.IMPORT_FETCH_ALLOW_HOSTS ?? '')
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
    photosDir: env.PHOTOS_DIR || '/data/photos',
    github: env.GITHUB_FEEDBACK_TOKEN
      ? {
          token: env.GITHUB_FEEDBACK_TOKEN,
          repo: env.GITHUB_FEEDBACK_REPO || 'JHGelpi/recipe-app',
          // Test-only override: the fake GitHub in docker-compose.test.yml.
          apiUrl: (env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, ''),
        }
      : null,
    limits: {
      parsesPerHour: amount(env, 'API_PARSES_PER_HOUR', 30),
      uploadsPerMinute: amount(env, 'API_UPLOADS_PER_MINUTE', 120),
      photosPerHour: amount(env, 'API_PHOTOS_PER_HOUR', 200),
    },
    photoQuotaBytes: amount(env, 'PHOTO_QUOTA_MB', 2048) * 1024 * 1024,
  };
}

/** Which AI the API calls, logged at start so a stack left in test mode is obvious. */
export function aiMode(ai: {
  apiKey: string | null;
  baseUrl: string | null;
}): 'fake' | 'claude' | 'none' {
  if (ai.baseUrl) return 'fake';
  return ai.apiKey ? 'claude' : 'none';
}
