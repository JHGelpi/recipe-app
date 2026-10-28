import { describe, expect, it } from 'vitest';
import { aiMode, loadConfig } from './config';

const env = { DATABASE_URL: 'postgres://x', JWT_SECRET: 's' };

describe('loadConfig', () => {
  it('defaults the AI settings and allows no fetch exceptions', () => {
    const config = loadConfig(env);
    expect(config.ai).toEqual({
      apiKey: null,
      baseUrl: null,
      model: 'claude-sonnet-5-5',
      priceInputPerMTokUsd: 2,
      priceOutputPerMTokUsd: 10,
      capUsd: 2,
      globalCapUsd: 10,
    });
    expect(config.fetchAllowHosts).toEqual([]);
  });

  it('defaults the per-person limits and the photo quota (#67), and reads overrides', () => {
    expect(loadConfig(env).limits).toEqual({
      parsesPerHour: 30,
      uploadsPerMinute: 120,
      photosPerHour: 200,
    });
    expect(loadConfig(env).photoQuotaBytes).toBe(2048 * 1024 * 1024);
    const config = loadConfig({ ...env, API_PARSES_PER_HOUR: '5', PHOTO_QUOTA_MB: '1' });
    expect(config.limits.parsesPerHour).toBe(5);
    expect(config.photoQuotaBytes).toBe(1024 * 1024);
    expect(() => loadConfig({ ...env, API_PHOTOS_PER_HOUR: 'many' })).toThrow(
      'API_PHOTOS_PER_HOUR',
    );
  });

  it('reads the cap, prices, base URL and test hosts', () => {
    const config = loadConfig({
      ...env,
      ANTHROPIC_API_KEY: 'k',
      ANTHROPIC_BASE_URL: 'http://fake-ai:4010',
      AI_MONTHLY_CAP_USD: '5',
      AI_GLOBAL_MONTHLY_CAP_USD: '25',
      LLM_PRICE_INPUT_PER_MTOK_USD: '1',
      IMPORT_FETCH_ALLOW_HOSTS: ' Fake-AI , other ',
    });
    expect(config.ai).toMatchObject({
      apiKey: 'k',
      baseUrl: 'http://fake-ai:4010',
      capUsd: 5,
      globalCapUsd: 25,
      priceInputPerMTokUsd: 1,
    });
    expect(config.fetchAllowHosts).toEqual(['fake-ai', 'other']);
  });

  it('refuses a cap that is not a number', () => {
    expect(() => loadConfig({ ...env, AI_MONTHLY_CAP_USD: 'lots' })).toThrow('AI_MONTHLY_CAP_USD');
    expect(() => loadConfig({ ...env, AI_GLOBAL_MONTHLY_CAP_USD: 'lots' })).toThrow(
      'AI_GLOBAL_MONTHLY_CAP_USD',
    );
  });
});

describe('aiMode', () => {
  it('names the AI the API talks to', () => {
    expect(aiMode({ apiKey: 'k', baseUrl: 'http://fake-ai:4010' })).toBe('fake');
    expect(aiMode({ apiKey: 'k', baseUrl: null })).toBe('claude');
    expect(aiMode({ apiKey: null, baseUrl: null })).toBe('none');
  });
});
