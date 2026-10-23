import { randomUUID } from 'node:crypto';
import { AuthClient } from '@supabase/auth-js';
import { describe, expect, it } from 'vitest';
import { env } from '../../../../test-support/env';
import { watchMailbox } from '../../../../test-support/mail';
import { adminSql } from '../helpers/db';

// FR-1: a sign-in code works once, only while it is the newest, and only for
// 10 minutes (GOTRUE_MAILER_OTP_EXP). Against the local stack, never production.

const client = () =>
  new AuthClient({
    url: env.authUrl,
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  });

const freshEmail = (tag: string) => `code-${tag}-${randomUUID()}@example.test`;

// GoTrue refuses a second email to one address within its minimum spacing.
const SPACING_MS = 1_200;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function requestCode(email: string): Promise<string> {
  const mailbox = await watchMailbox(env.mailUrl, email);
  const { error } = await client().signInWithOtp({ email });
  expect(error).toBeNull();
  return mailbox.nextCode();
}

async function verify(email: string, token: string) {
  return client().verifyOtp({ email, token, type: 'email' });
}

/** Makes the newest code look `minutes` old, as if the person waited that long. */
async function ageCode(email: string, minutes: number): Promise<void> {
  const ago = `${minutes} minutes`;
  await adminSql`
    update auth.users
    set confirmation_sent_at = case when confirmation_sent_at is null then null
                                    else now() - ${ago}::interval end,
        recovery_sent_at = case when recovery_sent_at is null then null
                                else now() - ${ago}::interval end
    where email = ${email}`;
  await adminSql`
    update auth.one_time_tokens set created_at = now() - ${ago}::interval
    where user_id = (select id from auth.users where email = ${email})`;
}

/** An account that has signed in once, so later codes are for an existing person. */
async function existingAccount(tag: string): Promise<string> {
  const email = freshEmail(tag);
  const { error } = await verify(email, await requestCode(email));
  expect(error).toBeNull();
  await pause(SPACING_MS);
  return email;
}

describe('sign-in codes (FR-1)', () => {
  it('a code signs in once; used again, even within its 10 minutes, it is refused', async () => {
    const email = freshEmail('reuse');
    const code = await requestCode(email);
    const first = await verify(email, code);
    expect(first.error).toBeNull();
    expect(first.data.session?.access_token).toBeTruthy();

    const again = await verify(email, code);
    expect(again.error?.status).toBe(403);
    expect(again.data.session).toBeNull();

    // The same for someone who already had an account.
    const known = await existingAccount('reuse-known');
    const next = await requestCode(known);
    expect((await verify(known, next)).error).toBeNull();
    expect((await verify(known, next)).error?.status).toBe(403);
  });

  it('asking for a new code makes the earlier one stop working', async () => {
    const email = await existingAccount('newer');
    const older = await requestCode(email);
    await pause(SPACING_MS);
    const newer = await requestCode(email);
    expect(newer).not.toBe(older);
    expect((await verify(email, older)).error?.status).toBe(403);
    expect((await verify(email, newer)).error).toBeNull();
  });

  it('a code works at 9 minutes old and is refused at 11', async () => {
    const fresh = await existingAccount('nine');
    const code = await requestCode(fresh);
    await ageCode(fresh, 9);
    expect((await verify(fresh, code)).error).toBeNull();

    const stale = await existingAccount('eleven');
    const old = await requestCode(stale);
    await ageCode(stale, 11);
    const late = await verify(stale, old);
    expect(late.error?.status).toBe(403);
    expect(late.data.session).toBeNull();
  });

  it('a wrong code signs nobody in', async () => {
    const email = await existingAccount('wrong');
    const code = await requestCode(email);
    const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, '0');
    expect((await verify(email, wrong)).error?.status).toBe(403);
    // The right one still works afterwards.
    expect((await verify(email, code)).error).toBeNull();
  });
});
