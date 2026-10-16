export type HouseholdRole = 'admin' | 'member' | 'viewer';
export type Claims = { userId: string; householdId: string; role: HouseholdRole };

const ROLES: readonly string[] = ['admin', 'member', 'viewer'];

function decodeBase64Url(segment: string): string {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * Reads the household claims the access-token hook adds. Used only to shape
 * the UI and to stamp household_id on local rows; the server re-checks
 * everything through RLS.
 */
export function claimsFromToken(token: string): Claims | null {
  try {
    const payload: unknown = JSON.parse(decodeBase64Url(token.split('.')[1] ?? ''));
    if (typeof payload !== 'object' || payload === null) return null;
    const { sub, household_id, household_role } = payload as Record<string, unknown>;
    if (typeof sub !== 'string' || typeof household_id !== 'string') return null;
    if (typeof household_role !== 'string' || !ROLES.includes(household_role)) return null;
    return { userId: sub, householdId: household_id, role: household_role as HouseholdRole };
  } catch {
    return null;
  }
}

export function canWrite(role: HouseholdRole): boolean {
  return role === 'admin' || role === 'member';
}
