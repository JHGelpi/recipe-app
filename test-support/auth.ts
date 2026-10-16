import { AuthClient } from '@supabase/auth-js';
import { env } from './env';
import { watchMailbox } from './mail';

export const SEED = {
  adminA: 'admin-a@example.test',
  memberA: 'member-a@example.test',
  viewerA: 'viewer-a@example.test',
  adminB: 'admin-b@example.test',
} as const;

export type Actor = {
  email: string;
  accessToken: string;
  userId: string;
  householdId: string | null;
  role: string | null;
};

// GoTrue sends at most one email per address per AUTH_EMAIL_MAX_FREQUENCY
// (1s in .env). Each test file signs the seed users in afresh (Vitest gives
// every file its own module copy, so the cache below cannot span files), and
// files can start within that second. A refused request sends no email, so
// waiting and asking again is safe.
const RATE_LIMITED = 'over_email_send_rate_limit';
const RETRY_AFTER_MS = 1_100;
const MAX_TRIES = 5;

async function requestCode(client: InstanceType<typeof AuthClient>, email: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    const { error } = await client.signInWithOtp({ email });
    if (!error) return;
    if (error.code !== RATE_LIMITED || attempt >= MAX_TRIES) throw error;
    await new Promise((resolve) => setTimeout(resolve, RETRY_AFTER_MS));
  }
}

/** Signs in through the real email-code flow, so the token hook runs. */
export async function signInFresh(email: string): Promise<Actor> {
  const client = new AuthClient({
    url: env.authUrl,
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  });
  const mailbox = await watchMailbox(env.mailUrl, email);
  await requestCode(client, email);
  const code = await mailbox.nextCode();
  const verified = await client.verifyOtp({ email, token: code, type: 'email' });
  if (verified.error || !verified.data.session) {
    throw verified.error ?? new Error(`No session for ${email}`);
  }
  const accessToken = verified.data.session.access_token;
  const payload = JSON.parse(
    Buffer.from(accessToken.split('.')[1] ?? '', 'base64url').toString('utf8'),
  ) as { sub: string; household_id?: string; household_role?: string };
  return {
    email,
    accessToken,
    userId: payload.sub,
    householdId: payload.household_id ?? null,
    role: payload.household_role ?? null,
  };
}

const cache = new Map<string, Promise<Actor>>();

export function signInAs(email: string): Promise<Actor> {
  let actor = cache.get(email);
  if (!actor) {
    actor = signInFresh(email);
    cache.set(email, actor);
  }
  return actor;
}
