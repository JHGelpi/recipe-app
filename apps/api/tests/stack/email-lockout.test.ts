import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { authClient } from '../../../../test-support/auth';
import { env } from '../../../../test-support/env';
import { watchMailbox } from '../../../../test-support/mail';

// Issue #72: five wrong codes for one email lock it, whatever the code or the
// address, until a new code is requested.
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function requestCode(email: string): Promise<string> {
  const mailbox = await watchMailbox(env.mailUrl, email);
  const { error } = await authClient().signInWithOtp({ email });
  expect(error).toBeNull();
  return mailbox.nextCode();
}

const verify = (email: string, token: string) =>
  authClient().verifyOtp({ email, token, type: 'email' });

it('five wrong codes lock the email even for the right code; a new code unlocks it', async () => {
  const email = `lockout-${randomUUID()}@example.test`;
  const first = await requestCode(email);
  const wrong = first === '00000000' ? '11111111' : '00000000';
  for (let i = 0; i < 5; i++) {
    expect((await verify(email, wrong)).error?.status).toBe(403);
  }
  const locked = await verify(email, first);
  expect(locked.error?.status).toBe(429);
  expect(locked.error?.code).toBe('too_many_wrong_codes');

  // GoTrue spaces emails to one address by AUTH_EMAIL_MAX_FREQUENCY (1s).
  await pause(1_200);
  const second = await requestCode(email);
  const { data, error } = await verify(email, second);
  expect(error).toBeNull();
  expect(data.session?.access_token).toBeTruthy();
});

it('GoTrue’s own code paths are closed at the proxy, so the count cannot be skipped', async () => {
  for (const path of ['/auth/otp', '/auth/verify']) {
    const response = await fetch(`${env.publicUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'a@example.test', token: '00000000', type: 'email' }),
    });
    await response.body?.cancel();
    expect(response.status).toBe(404);
  }
});
