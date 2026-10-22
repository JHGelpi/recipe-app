import { householdErrorOf, type HouseholdError, type HouseholdRoleName } from '@recipe-app/domain';
import type { AsUser, UserTx } from '../db/asUser';
import type { PhotoStore } from '../photos/store';

/** A household function refused, with its key (spec §4). */
export class HouseholdRefusal extends Error {
  constructor(readonly key: HouseholdError) {
    super(key);
    this.name = 'HouseholdRefusal';
  }
}

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
export type FriendLink = { id: string; created_at: string; expires_at: string };
/** FR-42: a used invitation, for the sender's short history. */
export type AcceptedInvite = { id: string; accepted_at: string; email: string | null };
export type HouseholdService = {
  createInvite(
    token: string,
    role: HouseholdRoleName,
  ): Promise<{ id: string; code: string; expires_at: string }>;
  listInvites(token: string): Promise<PendingInvite[]>;
  cancelInvite(token: string, id: string): Promise<void>;
  previewInvite(token: string, code: string): Promise<InvitePreview>;
  acceptInvite(
    token: string,
    code: string,
  ): Promise<{ household_id: string; moved_recipes: number }>;
  setRole(token: string, userId: string, role: HouseholdRoleName): Promise<void>;
  removeMember(token: string, userId: string): Promise<void>;
  leave(token: string): Promise<void>;
  rename(token: string, name: string): Promise<void>;
  /** FR-6: a link for a friend to start their own household (production spec §4). */
  createFriendLink(token: string): Promise<{ code: string; expires_at: string }>;
  /** FR-6: the household's live friend links; every role may see them. */
  listFriendLinks(token: string): Promise<FriendLink[]>;
  revokeFriendLink(token: string, id: string): Promise<void>;
  /** FR-42: invites accepted in the last 30 days (Admins). */
  listAcceptedInvites(token: string): Promise<AcceptedInvite[]>;
  /** FR-42: friend links accepted in the last 30 days (every role). */
  listAcceptedFriendLinks(token: string): Promise<AcceptedInvite[]>;
};

const HISTORY = 20;

const iso = (value: Date | string) => new Date(value).toISOString();

/**
 * FR-3–FR-6 over the household functions (ADR-0015). Every call runs as the
 * user through asUser (rule 1); the functions check the caller themselves.
 */
export function createHouseholdService(deps: {
  asUser: AsUser;
  photos: Pick<PhotoStore, 'move'>;
  log?: (event: Record<string, unknown>) => void;
}): HouseholdService {
  async function run<T>(token: string, fn: (tx: UserTx) => Promise<T>): Promise<T> {
    try {
      return await deps.asUser(token, fn);
    } catch (error) {
      const key = householdErrorOf((error as { message?: unknown }).message);
      if ((error as { code?: unknown }).code === 'P0001' && key) throw new HouseholdRefusal(key);
      throw error;
    }
  }

  return {
    async createFriendLink(token) {
      const [row] = await run(
        token,
        (tx) => tx<{ token: string; expires_at: Date }[]>`
        select token, expires_at from public.create_friend_link()`,
      );
      return { code: row!.token, expires_at: iso(row!.expires_at) };
    },

    listFriendLinks: (token) =>
      run(token, async (tx) => {
        // friend_links_select limits this to the caller's household.
        const rows = await tx<{ id: string; created_at: Date; expires_at: Date }[]>`
      select id, created_at, expires_at from public.friend_links
      where deleted_at is null and expires_at > now() and accepted_at is null
      order by created_at desc`;
        return rows.map((row) => ({
          id: row.id,
          created_at: iso(row.created_at),
          expires_at: iso(row.expires_at),
        }));
      }),

    listAcceptedFriendLinks: (token) =>
      run(token, async (tx) => {
        const rows = await tx<{ id: string; accepted_at: Date; email: string | null }[]>`
          select id, accepted_at, accepted_email as email from public.friend_links
          where accepted_at > now() - interval '30 days'
          order by accepted_at desc limit ${HISTORY}`;
        return rows.map((row) => ({ ...row, accepted_at: iso(row.accepted_at) }));
      }),

    listAcceptedInvites: (token) =>
      run(token, async (tx) => {
        const [me] = await tx<
          { role: string | null }[]
        >`select public.auth_household_role() as role`;
        if (me?.role !== 'admin') throw new HouseholdRefusal('forbidden');
        // invites_select shows only this household's invites, to Admins. The
        // person is named while still a member; after leaving, unnamed.
        const rows = await tx<{ id: string; accepted_at: Date; email: string | null }[]>`
          select i.id, i.accepted_at, m.email from public.invites i
          left join public.memberships m
            on m.user_id = i.accepted_by and m.household_id = i.household_id
               and m.deleted_at is null
          where i.accepted_at > now() - interval '30 days'
          order by i.accepted_at desc limit ${HISTORY}`;
        return rows.map((row) => ({ ...row, accepted_at: iso(row.accepted_at) }));
      }),

    async revokeFriendLink(token, id) {
      await run(token, (tx) => tx`select public.revoke_friend_link(${id}::uuid)`);
    },

    async createInvite(token, role) {
      const [row] = await run(
        token,
        (tx) => tx<{ id: string; token: string; expires_at: Date }[]>`
        select id, token, expires_at from public.create_invite(${role}::public.household_role)`,
      );
      return { id: row!.id, code: row!.token, expires_at: iso(row!.expires_at) };
    },

    listInvites: (token) =>
      run(token, async (tx) => {
        const [me] = await tx<
          { role: string | null }[]
        >`select public.auth_household_role() as role`;
        if (me?.role !== 'admin') throw new HouseholdRefusal('forbidden');
        const rows = await tx<
          { id: string; role: HouseholdRoleName; expires_at: Date; created_at: Date }[]
        >`
          select id, role, expires_at, created_at from public.invites
          where accepted_at is null and deleted_at is null and expires_at > now()
          order by created_at desc`;
        return rows.map((row) => ({
          ...row,
          expires_at: iso(row.expires_at),
          created_at: iso(row.created_at),
        }));
      }),

    async cancelInvite(token, id) {
      await run(token, (tx) => tx`select public.cancel_invite(${id}::uuid)`);
    },

    async previewInvite(token, code) {
      const [row] = await run(
        token,
        (tx) => tx<InvitePreview[]>`select * from public.preview_invite(${code})`,
      );
      return row!;
    },

    async acceptInvite(token, code) {
      const [row] = await run(
        token,
        (tx) =>
          tx<
            {
              household_id: string;
              from_household: string;
              moved_recipes: number;
              moved_photos: string[];
            }[]
          >`select * from public.accept_invite(${code})`,
      );
      // The rows moved in the transaction; now their files follow.
      for (const id of row!.moved_photos ?? []) {
        await deps.photos
          .move(row!.from_household, row!.household_id, id)
          .catch((error: unknown) => {
            deps.log?.({ event: 'photo_move_failed', id, message: String(error) });
          });
      }
      return { household_id: row!.household_id, moved_recipes: row!.moved_recipes };
    },

    async setRole(token, userId, role) {
      await run(
        token,
        (tx) => tx`select public.set_member_role(${userId}::uuid, ${role}::public.household_role)`,
      );
    },
    async removeMember(token, userId) {
      await run(token, (tx) => tx`select public.remove_member(${userId}::uuid)`);
    },
    async leave(token) {
      await run(token, (tx) => tx`select public.leave_household()`);
    },
    async rename(token, name) {
      // households_update lets only Admins update their own household.
      const rows = await run(
        token,
        (tx) => tx`
        update public.households set name = ${name}
        where id = (select public.auth_household_id()) returning id`,
      );
      if (rows.length === 0) throw new HouseholdRefusal('forbidden');
    },
  };
}
