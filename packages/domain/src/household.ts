import { z } from 'zod';

/** FR-4: the roles of SPEC §2. */
export const HOUSEHOLD_ROLES = ['admin', 'member', 'viewer'] as const;
export type HouseholdRoleName = (typeof HOUSEHOLD_ROLES)[number];

/**
 * A new household's name (issue #66). Nothing derived from an email address:
 * the name travels on share links to people outside the household. The
 * database functions that create households use the same literal.
 */
export const DEFAULT_HOUSEHOLD_NAME = 'My household';

/**
 * "the Gelpi household" for a chosen name. The default name, or none, gives
 * `otherwise`, since "the My household" reads as the reader's own.
 */
export function householdPhrase(name: string | null | undefined, otherwise: string): string {
  return name && name !== DEFAULT_HOUSEHOLD_NAME ? `the ${name}` : otherwise;
}

/** FR-3: invites (spec §3). */
export const INVITE_DAYS = 7;
export const MAX_PENDING_INVITES = 20;

const roleSchema = z.enum(HOUSEHOLD_ROLES);

/**
 * Issue #71: an invite is a bearer link that anyone holding it can accept, so
 * it never makes an Admin. An Admin promotes someone after they join.
 */
export const INVITE_ROLES = ['member', 'viewer'] as const satisfies readonly HouseholdRoleName[];
export type InviteRoleName = (typeof INVITE_ROLES)[number];

export const inviteCreateSchema = z.strictObject({ role: z.enum(INVITE_ROLES) });
// 32 random bytes in base64url without padding.
export const inviteTokenBodySchema = z.strictObject({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
export const memberRoleBodySchema = z.strictObject({ role: roleSchema });
export const householdRenameSchema = z.strictObject({
  name: z.string().trim().min(1, 'Enter a name').max(200, 'At most 200 characters'),
});

/** The keys the household functions raise (spec §4). */
export const HOUSEHOLD_ERRORS = [
  'forbidden',
  'not_member',
  'last_admin',
  'only_admin',
  'alone',
  'invite_used',
  'invite_expired',
  'invite_cancelled',
  'invite_unknown',
  'already_member',
  'too_many_invites',
  'link_unknown',
] as const;
export type HouseholdError = (typeof HOUSEHOLD_ERRORS)[number];

export function householdErrorOf(message: unknown): HouseholdError | null {
  return (HOUSEHOLD_ERRORS as readonly unknown[]).includes(message)
    ? (message as HouseholdError)
    : null;
}
