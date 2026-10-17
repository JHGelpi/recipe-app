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

type Row = { household_id: string; width: number; height: number; deleted: boolean };
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
        await deps.store.put(row.household_id, id, bytes);
        await tx`update public.photos set uploaded_at = now() where id = ${id}`;
        return 'stored';
      });
    },

    get: (token, id) =>
      deps.asUser(token, async (tx) => {
        const [row] = await tx<Row[]>`
          select household_id, width, height, deleted_at is not null as deleted
          from public.photos where id = ${id}`;
        if (!row || row.deleted) return null;
        return deps.store.read(row.household_id, id);
      }),

    remove: (householdId, id) => deps.store.remove(householdId, id),
  };
}
