// apps/mobile/src/pwa/workboxConfig.test.ts
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const config = createRequire(import.meta.url)('../../workbox.config.cjs') as {
  navigateFallbackDenylist: RegExp[];
};

describe('workbox config', () => {
  it('leaves /healthz to the network', () => {
    expect(config.navigateFallbackDenylist.some((pattern) => pattern.test('/healthz'))).toBe(true);
  });
});
