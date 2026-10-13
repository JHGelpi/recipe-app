import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../../../test-support/env';
import { watchMailbox } from '../../../test-support/mail';

export const SEED = {
  adminA: 'admin-a@example.test',
  memberA: 'member-a@example.test',
  viewerA: 'viewer-a@example.test',
  adminB: 'admin-b@example.test',
} as const;

export type Actor = {
  email: string;
  client: SupabaseClient;
  accessToken: string;
  userId: string;
  householdId: string | null;
  role: string | null;
};

/** Signs in through the real email-code flow, so the token hook runs. */
export async function signInFresh(email: string): Promise<Actor> {
  const client = createClient(env.supabaseUrl, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const mailbox = await watchMailbox(env.mailUrl, email);
  const requested = await client.auth.signInWithOtp({ email });
  if (requested.error) throw requested.error;
  const code = await mailbox.nextCode();
  const verified = await client.auth.verifyOtp({ email, token: code, type: 'email' });
  if (verified.error || !verified.data.session) {
    throw verified.error ?? new Error(`No session for ${email}`);
  }
  const accessToken = verified.data.session.access_token;
  const payload = JSON.parse(
    Buffer.from(accessToken.split('.')[1] ?? '', 'base64url').toString('utf8'),
  ) as { sub: string; household_id?: string; household_role?: string };
  return {
    email,
    client,
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
