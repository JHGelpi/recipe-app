import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

const env = { DATABASE_URL: 'postgres://x', JWT_SECRET: 's' };

describe('loadConfig', () => {
  it('defaults the AI settings and allows no fetch exceptions', () => {
    const config = loadConfig(env);
    expect(config.ai).toEqual({
      apiKey: null,
      baseUrl: null,
      model: 'claude-sonnet-5-5',
      priceInputPerMTokUsd: 3,
      priceOutputPerMTokUsd: 15,
      capUsd: 2,
    });
    expect(config.fetchAllowHosts).toEqual([]);
  });

  it('reads the cap, prices, base URL and test hosts', () => {
    const config = loadConfig({
      ...env,
      ANTHROPIC_API_KEY: 'k',
      ANTHROPIC_BASE_URL: 'http://fake-ai:4010',
      AI_MONTHLY_CAP_USD: '5',
      LLM_PRICE_INPUT_PER_MTOK_USD: '1',
      IMPORT_FETCH_ALLOW_HOSTS: ' Fake-AI , other ',
    });
    expect(config.ai).toMatchObject({
      apiKey: 'k',
      baseUrl: 'http://fake-ai:4010',
      capUsd: 5,
      priceInputPerMTokUsd: 1,
    });
    expect(config.fetchAllowHosts).toEqual(['fake-ai', 'other']);
  });

  it('refuses a cap that is not a number', () => {
    expect(() => loadConfig({ ...env, AI_MONTHLY_CAP_USD: 'lots' })).toThrow('AI_MONTHLY_CAP_USD');
  });
});
