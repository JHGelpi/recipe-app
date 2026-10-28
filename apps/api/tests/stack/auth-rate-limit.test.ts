import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { env } from '../../../../test-support/env';

// GoTrue counts /verify per client address in a bucket of 30 that refills at
// AUTH_RATE_LIMIT per 5 minutes. It keys on the X-Client-IP header the proxy
// sets, and skips the limit entirely when no header is configured.
const BURST = 30;
// The suites after this one sign in through the same bucket, so the test
// leaves it full: 30 tokens at AUTH_RATE_LIMIT per 300 s (1000 in .env: 9 s).
const REFILL_MS = Math.ceil((BURST * 300_000) / Number(process.env.AUTH_RATE_LIMIT ?? 30));

// Through the API's code relay (#72), which passes the proxy's X-Client-IP on.
async function verify(email: string, headers: Record<string, string> = {}): Promise<number> {
  const response = await fetch(`${env.apiUrl}/auth/verify`, {
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
    // A new email each time, so the per-email lockout (#72) never answers:
    // every 429 here is GoTrue's per-address limit.
    const email = () => `guess-${randomUUID()}@example.test`;

    const statuses = await burst(BURST + 10, () => verify(email()));
    expect(statuses).toContain(429);

    // Were the limit keyed on a header the client controls, each of these
    // would start a fresh bucket and pass. One may get through on the refill.
    const spoofed = await burst(10, (i) =>
      verify(email(), { 'X-Client-IP': `198.51.100.${i}`, 'X-Forwarded-For': `203.0.113.${i}` }),
    );
    expect(spoofed.filter((status) => status !== 429).length).toBeLessThanOrEqual(1);

    // The bucket refills, so a locked-out address can try again later.
    await expect.poll(() => verify(email()), { timeout: 20_000, interval: 500 }).not.toBe(429);
    await new Promise((resolve) => setTimeout(resolve, REFILL_MS));
  }, 60_000);
});
