import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { env } from '../../../../test-support/env';

// GoTrue counts /verify per client address in a bucket of 30 that refills at
// AUTH_RATE_LIMIT per 5 minutes. It keys on the X-Client-IP header the proxy
// sets, and skips the limit entirely when no header is configured.
const BURST = 30;

async function verify(email: string, headers: Record<string, string> = {}): Promise<number> {
  const response = await fetch(`${env.authUrl}/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ type: 'email', email, token: '00000000' }),
  });
  await response.body?.cancel();
  return response.status;
}

const burst = (count: number, send: (i: number) => Promise<number>) =>
  Promise.all(Array.from({ length: count }, (_, i) => send(i)));

describe('the auth service rate limit', () => {
  it('refuses code guesses past the limit, and a client-chosen address does not reset it', async () => {
    const email = `guess-${randomUUID()}@example.test`;

    const statuses = await burst(BURST + 10, () => verify(email));
    expect(statuses).toContain(429);

    // Were the limit keyed on a header the client controls, each of these
    // would start a fresh bucket and pass. One may get through on the refill.
    const spoofed = await burst(10, (i) =>
      verify(email, { 'X-Client-IP': `198.51.100.${i}`, 'X-Forwarded-For': `203.0.113.${i}` }),
    );
    expect(spoofed.filter((status) => status !== 429).length).toBeLessThanOrEqual(1);

    // The bucket refills, so the files after this one can still sign in.
    await expect
      .poll(() => verify(email), { timeout: 20_000, interval: 500 })
      .not.toBe(429);
  });
});
