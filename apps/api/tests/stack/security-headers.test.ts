import { describe, expect, it } from 'vitest';
import { env } from '../../../../test-support/env';

// Issue #64: the proxy sends the security headers on every response. The
// policy's content is checked against index.html in apps/mobile/src/theme/csp.test.ts.
const paths = ['/', '/s/some-share-code', '/api/health'];

describe('security headers (#64)', () => {
  it.each(paths)('%s carries the policy, nosniff and a referrer policy', async (path) => {
    const response = await fetch(`${env.publicUrl}${path}`);
    await response.body?.cancel();
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(response.headers.get('server')).toBeNull();
  });

  it('sends HSTS only for HTTPS through the tunnel, never to plain local HTTP', async () => {
    const local = await fetch(`${env.publicUrl}/`);
    await local.body?.cancel();
    expect(local.headers.get('strict-transport-security')).toBeNull();
    const edge = await fetch(`${env.publicUrl}/`, { headers: { 'X-Forwarded-Proto': 'https' } });
    await edge.body?.cancel();
    expect(edge.headers.get('strict-transport-security')).toBe('max-age=31536000');
  });
});
