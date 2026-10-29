// auth-js's default key, named so the app can read the saved session when
// renewing it fails offline, and so index.html and the settings cache can tell
// whose session it is (ADR-0031). Changing it would sign every device out.
export const AUTH_STORAGE_KEY = 'supabase.auth.token';

/** The signed-in person's id from the saved session, or null; never throws. */
export function savedSessionUserId(storage: Pick<Storage, 'getItem'> | undefined): string | null {
  try {
    const raw = storage?.getItem(AUTH_STORAGE_KEY);
    const id = raw ? (JSON.parse(raw) as { user?: { id?: unknown } }).user?.id : null;
    return typeof id === 'string' ? id : null;
  } catch {
    return null;
  }
}
