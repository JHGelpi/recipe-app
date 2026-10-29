import { codeRelayUrl } from '@recipe-app/domain';
import { AuthClient } from '@supabase/auth-js';
import { config } from '../config';

import { AUTH_STORAGE_KEY } from './storageKey';

export { AUTH_STORAGE_KEY };

// GoTrue's client library, used for authentication only. Recipe data goes
// through the local database. Email codes go through the API's relay (#72).
export const auth = new AuthClient({
  url: config.authUrl,
  fetch: (input, init) =>
    fetch(
      typeof input === 'string' ? codeRelayUrl(input, config.authUrl, config.apiUrl) : input,
      init,
    ),
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
