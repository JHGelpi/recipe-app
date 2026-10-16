import { AuthClient } from '@supabase/auth-js';
import { config } from '../config';

// auth-js's default key, named so the app can read the saved session when
// renewing it fails offline. Changing it would sign every device out.
export const AUTH_STORAGE_KEY = 'supabase.auth.token';

// GoTrue's client library, used for authentication only. Recipe data goes
// through the local database.
export const auth = new AuthClient({
  url: config.authUrl,
  storageKey: AUTH_STORAGE_KEY,
  persistSession: true,
  autoRefreshToken: true,
  detectSessionInUrl: false,
});

/** The session auth-js saved, as stored; its shape is checked by the caller. */
export function readSavedSession(): unknown {
  try {
    const raw = globalThis.localStorage?.getItem(AUTH_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}
