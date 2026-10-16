import { AuthClient } from '@supabase/auth-js';
import { config } from '../config';

// GoTrue's client library, used for authentication only. Recipe data goes
// through the local database.
export const auth = new AuthClient({
  url: config.authUrl,
  persistSession: true,
  autoRefreshToken: true,
  detectSessionInUrl: false,
});
