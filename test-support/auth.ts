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

/** Signs in through the real email-code flow, so the token hook runs. */
export async function signInFresh(email: string): Promise<Actor> {
  const client = new AuthClient({
    url: env.authUrl,
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  });
  const mailbox = await watchMailbox(env.mailUrl, email);
  const requested = await client.signInWithOtp({ email });
  if (requested.error) throw requested.error;
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
