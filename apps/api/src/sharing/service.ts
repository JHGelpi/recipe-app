import { randomUUID } from 'node:crypto';
import { buildShareSnapshot, shareSnapshotSchema, type ShareSnapshot } from '@recipe-app/domain';
import type { AsUser, UserTx } from '../db/asUser';
import type { PhotoStore } from '../photos/store';

export type ShareRefusalKey = 'forbidden' | 'share_unavailable' | 'own_household' | 'not_found';
export class ShareRefusal extends Error {
  constructor(readonly key: ShareRefusalKey) {
    super(key);
    this.name = 'ShareRefusal';
  }
}

export type SharingService = {
  create(token: string, recipeId: string): Promise<{ code: string }>;
  stop(token: string, recipeId: string): Promise<number>;
  read(code: string): Promise<{ status: string; snapshot: ShareSnapshot | null }>;
  photo(code: string): Promise<Uint8Array | null>;
  save(token: string, code: string): Promise<{ recipe_id: string }>;
};

type Anonymous = <T>(fn: (tx: UserTx) => Promise<T>) => Promise<T>;
const KEYS: readonly string[] = ['forbidden', 'share_unavailable', 'own_household'];

/** FR-26, FR-27 (ADR-0016). Every statement runs as the user, or as an anonymous caller for reads. */
export function createSharingService(deps: {
  asUser: AsUser;
  asAnonymous: Anonymous;
  store: Pick<PhotoStore, 'copy' | 'read'>;
  now?: () => Date;
}): SharingService {
  const now = deps.now ?? (() => new Date());

  async function refusals<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      const { code, message } = error as { code?: unknown; message?: unknown };
      if (code === 'P0001' && typeof message === 'string' && KEYS.includes(message)) {
        throw new ShareRefusal(message as ShareRefusalKey);
      }
      throw error;
    }
  }

  async function read(code: string) {
    const [row] = await deps.asAnonymous(
      (tx) => tx<
        {
          status: string;
          snapshot: unknown;
          share_id: string | null;
          household_id: string | null;
        }[]
      >`
      select status, snapshot, share_id, household_id from public.read_share(${code})`,
    );
    const parsed = row?.status === 'ok' ? shareSnapshotSchema.safeParse(row.snapshot) : null;
    return {
      status: parsed && !parsed.success ? 'unknown' : (row?.status ?? 'unknown'),
      snapshot: parsed?.success ? parsed.data : null,
      shareId: row?.share_id ?? null,
      householdId: row?.household_id ?? null,
    };
  }

  return {
    create: (token, recipeId) =>
      refusals(() =>
        deps.asUser(token, async (tx) => {
          const [recipe] = await tx<Record<string, unknown>[]>`
            select r.title, r.servings, r.prep_minutes, r.cook_minutes, r.ingredients, r.steps, r.tags,
                   r.notes, r.source_url, r.source_author, r.household_id, h.name as household_name,
                   p.id as photo_id, p.bytes as photo_bytes, p.width as photo_width, p.height as photo_height
            from public.recipes r
            join public.households h on h.id = r.household_id
            left join public.photos p on p.id = r.photo_id and p.uploaded_at is not null and p.deleted_at is null
            where r.id = ${recipeId} and r.deleted_at is null`;
          if (!recipe) throw new ShareRefusal('not_found');
          const shareId = randomUUID();
          const copied =
            typeof recipe.photo_id === 'string'
              ? await deps.store.copy(
                  String(recipe.household_id),
                  recipe.photo_id,
                  String(recipe.household_id),
                  shareId,
                )
              : false;
          const snapshot = shareSnapshotSchema.parse(
            buildShareSnapshot(
              {
                title: String(recipe.title),
                servings: (recipe.servings as number | null) ?? null,
                prep_minutes: (recipe.prep_minutes as number | null) ?? null,
                cook_minutes: (recipe.cook_minutes as number | null) ?? null,
                ingredients: (recipe.ingredients as never) ?? [],
                steps: (recipe.steps as never) ?? [],
                tags: (recipe.tags as string[] | null) ?? [],
                notes: (recipe.notes as string | null) ?? '',
                source_url: (recipe.source_url as string | null) ?? null,
                source_author: (recipe.source_author as string | null) ?? null,
              },
              String(recipe.household_name),
              copied
                ? {
                    bytes: Number(recipe.photo_bytes),
                    width: Number(recipe.photo_width),
                    height: Number(recipe.photo_height),
                  }
                : null,
              now(),
            ),
          );
          const [row] = await tx<{ token: string }[]>`
            select token from public.create_share(${shareId}, ${recipeId}, ${tx.json(snapshot as never)})`;
          return { code: row!.token };
        }),
      ),

    stop: (token, recipeId) =>
      refusals(() =>
        deps.asUser(token, async (tx) => {
          const [row] = await tx<{ n: number }[]>`select public.stop_shares(${recipeId}) as n`;
          return row?.n ?? 0;
        }),
      ),

    async read(code) {
      const { status, snapshot } = await read(code);
      return { status, snapshot };
    },

    async photo(code) {
      const share = await read(code);
      if (share.status !== 'ok' || !share.snapshot?.photo || !share.shareId || !share.householdId)
        return null;
      return deps.store.read(share.householdId, share.shareId);
    },

    save: (token, code) =>
      refusals(async () => {
        const result = await deps.asUser(token, async (tx) => {
          const [row] = await tx<
            {
              recipe_id: string;
              photo_id: string | null;
              source_household: string;
              share_id: string;
            }[]
          >`
            select * from public.save_share(${code})`;
          const [me] = await tx<{ home: string }[]>`select public.auth_household_id() as home`;
          return { ...row!, home: me!.home };
        });
        // The copy's photo file. Missing: the recipe is saved without it (Review Focus 4).
        if (result.photo_id) {
          const copied = await deps.store
            .copy(result.source_household, result.share_id, result.home, result.photo_id)
            .catch(() => false);
          // A photo row without its file would be fetched forever and never shown.
          if (!copied) {
            const photoId = result.photo_id;
            await deps.asUser(token, async (tx) => {
              await tx`update public.recipes set photo_id = null where id = ${result.recipe_id}`;
              await tx`update public.photos set deleted_at = now() where id = ${photoId}`;
            });
          }
        }
        return { recipe_id: result.recipe_id };
      }),
  };
}
