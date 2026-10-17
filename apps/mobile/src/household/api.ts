import type { HouseholdRoleName } from '@recipe-app/domain';
import type { ApiDeps } from '../imports/api';

export type Result<T> = { ok: true; value: T } | { ok: false; message: string };
export type PendingInvite = {
  id: string;
  role: HouseholdRoleName;
  expires_at: string;
  created_at: string;
};
export type InvitePreview = {
  status: 'ok' | 'used' | 'expired' | 'cancelled' | 'unknown' | 'already_member';
  household_name: string | null;
  role: HouseholdRoleName | null;
  moving_recipes: number;
  blocker: 'only_admin' | null;
};

const OFFLINE = 'Changing the household needs a connection';
export const HOUSEHOLD_MESSAGES: Record<string, string> = {
  forbidden: 'Only an Admin can do that',
  not_member: "That person isn't in this household",
  last_admin: 'Make someone else an Admin first',
  only_admin: 'Make someone else an Admin of your household first',
  alone: "You're the only one in this household",
  invite_used: 'This invite has already been used',
  invite_expired: 'This invite has expired',
  invite_cancelled: 'This invite was cancelled',
  invite_unknown: "This invite isn't valid",
  already_member: "You're already in this household",
  too_many_invites: 'Too many pending invites. Cancel some first.',
};

async function request<T>(
  deps: ApiDeps,
  method: string,
  path: string,
  body?: unknown,
): Promise<Result<T>> {
  try {
    const response = await deps.fetch(`${deps.apiUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${deps.token}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (response.status === 204) return { ok: true, value: undefined as T };
    const json = (await response.json().catch(() => null)) as { error?: string } | null;
    if (!response.ok) {
      return {
        ok: false,
        message: HOUSEHOLD_MESSAGES[json?.error ?? ''] ?? 'Something went wrong. Try again.',
      };
    }
    return { ok: true, value: json as T };
  } catch {
    return { ok: false, message: OFFLINE };
  }
}

export const createInvite = (role: HouseholdRoleName, deps: ApiDeps) =>
  request<{ id: string; code: string; expires_at: string }>(deps, 'POST', '/invites', { role });
export const listInvites = (deps: ApiDeps) => request<PendingInvite[]>(deps, 'GET', '/invites');
export const cancelInvite = (id: string, deps: ApiDeps) =>
  request<void>(deps, 'DELETE', `/invites/${id}`);
export const previewInvite = (code: string, deps: ApiDeps) =>
  request<InvitePreview>(deps, 'POST', '/invites/preview', { token: code });
export const acceptInvite = (code: string, deps: ApiDeps) =>
  request<{ household_id: string; moved_recipes: number }>(deps, 'POST', '/invites/accept', {
    token: code,
  });
export const setMemberRole = (userId: string, role: HouseholdRoleName, deps: ApiDeps) =>
  request<void>(deps, 'PATCH', `/members/${userId}`, { role });
export const removeMember = (userId: string, deps: ApiDeps) =>
  request<void>(deps, 'DELETE', `/members/${userId}`);
export const leaveHousehold = (deps: ApiDeps) => request<void>(deps, 'POST', '/household/leave');
export const renameHousehold = (name: string, deps: ApiDeps) =>
  request<void>(deps, 'PATCH', '/household', { name });

/** The link a person opens; built here so it is right on any host (Decisions). */
export function inviteUrl(code: string): string {
  return `${globalThis.location?.origin ?? ''}/invite/${code}`;
}
