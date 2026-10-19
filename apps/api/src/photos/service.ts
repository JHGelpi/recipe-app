import type { TokenClaims } from '../auth/verify';
import type { AsClaims, AsUser } from '../db/asUser';
import { jpegInfo } from './jpeg';
import type { PhotoStore } from './store';

export type PutOutcome = 'stored' | 'missing' | 'gone' | 'forbidden' | 'not_jpeg' | 'wrong_size';
export type PhotoService = {
  put(claims: TokenClaims, id: string, bytes: Uint8Array): Promise<PutOutcome>;
  get(token: string, id: string): Promise<Uint8Array | null>;
  remove(householdId: string, id: string): Promise<void>;
};

type Row = {
  household_id: string;
  width: number;
  height: number;
  deleted: boolean;
  uploaded?: boolean;
};
const WRITERS = ['admin', 'member'];

/**
 * Who may read or write a file is decided by the photo's row, read as the
 * user under RLS (rule 1). The store never sees an id the database did not
 * show this user.
 */
export function createPhotoService(deps: {
  asClaims: AsClaims;
  asUser: AsUser;
  store: PhotoStore;
}): PhotoService {
  return {
    async put(claims, id, bytes) {
      if (!WRITERS.includes(String(claims.household_role))) return 'forbidden';
      const info = jpegInfo(bytes);
      if (!info) return 'not_jpeg';
      return deps.asClaims(claims, async (tx): Promise<PutOutcome> => {
        const [row] = await tx<Row[]>`
          select household_id, width, height, deleted_at is not null as deleted
          from public.photos where id = ${id}`;
        if (!row) return 'missing';
        // Dismissed while uploading: the phone stops retrying on 410.
        if (row.deleted) return 'gone';
        if (row.width !== info.width || row.height !== info.height) return 'wrong_size';
        // RLS checks the member's live role here (rule 4): a demoted member
        // updates nothing, and no file is written. A second upload keeps the
        // first stamp (coalesce), which the uploaded_at guard allows.
        const stamped = await tx`
          update public.photos set uploaded_at = coalesce(uploaded_at, now())
          where id = ${id} returning id`;
        if (stamped.length === 0) return 'forbidden';
        await deps.store.put(row.household_id, id, bytes);
        return 'stored';
      });
    },

    get: (token, id) =>
      deps.asUser(token, async (tx) => {
        const [row] = await tx<Row[]>`
          select household_id, width, height, deleted_at is not null as deleted,
                 uploaded_at is not null as uploaded
          from public.photos where id = ${id}`;
        if (!row || row.deleted) return null;
        // Only an uploaded photo's file may be looked for elsewhere: its own
        // upload is what an unfinished move left behind (final review).
        return row.uploaded
          ? deps.store.repair(row.household_id, id)
          : deps.store.read(row.household_id, id);
      }),

    remove: (householdId, id) => deps.store.remove(householdId, id),
  };
}
