import {
  aisleChoicePatchSchema,
  aisleChoicePutSchema,
  favoritePatchSchema,
  favoriteSchema,
  importPatchSchema,
  importPutSchema,
  photoPatchSchema,
  photoPutSchema,
  recipePatchSchema,
  recipeSchema,
  SHOPPING_LIMITS,
  shoppingItemPatchSchema,
  shoppingItemPutSchema,
} from '@recipe-app/domain';
import { z } from 'zod';
import type { UserTx } from '../db/asUser';

export const MAX_OPS = 500;
const ALLOWED_TABLES = new Set([
  'recipes',
  'favorites',
  'imports',
  'photos',
  'shopping_items',
  'aisle_choices',
]);
// jsonb columns: sent with tx.json so postgres.js does not build an array literal.
const JSON_COLUMNS = new Set(['ingredients', 'steps']);

const opSchema = z.strictObject({
  op: z.enum(['put', 'patch', 'delete']),
  table: z.string(),
  id: z.guid(),
  data: z.record(z.string(), z.unknown()).optional(),
});
const bodySchema = z.strictObject({ ops: z.array(opSchema).max(MAX_OPS) });

export type Op = z.infer<typeof opSchema>;
export type Result =
  { id: string; status: 'applied' } | { id: string; status: 'rejected'; reason: string };

const applied = (op: Op): Result => ({ id: op.id, status: 'applied' });
const rejected = (op: Op, reason: string): Result => ({ id: op.id, status: 'rejected', reason });

/** Returns the ops, or null when the body is not the documented shape. */
export function parseBody(payload: unknown): Op[] | null {
  const parsed = bodySchema.safeParse(payload);
  return parsed.success ? parsed.data.ops : null;
}

/**
 * Errors the database raises because of what the caller sent: RLS refusal or
 * missing grant (42501), constraint violations (23xxx), bad data (22xxx).
 * Retrying cannot fix these, so they become "rejected". Anything else is
 * unexpected and fails the whole request so the client retries.
 */
function isRefusal(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return (
    typeof code === 'string' && (code === '42501' || code.startsWith('23') || code.startsWith('22'))
  );
}

/** Column values ready for postgres.js: jsonb columns wrapped, everything else as is. */
function columns(tx: UserTx, data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [
      key,
      // postgres.js accepts any JSON value here; its declared type is narrower.
      JSON_COLUMNS.has(key) ? tx.json(value as never) : value,
    ]),
  );
}

async function applyRecipe(
  tx: UserTx,
  op: Op,
  candidate: Record<string, unknown>,
): Promise<Result> {
  if (op.op === 'put') {
    const parsed = recipeSchema.safeParse(candidate);
    if (!parsed.success) return rejected(op, 'invalid');
    const { id, ...fields } = parsed.data;
    const row = columns(tx, { ...fields, deleted_at: fields.deleted_at ?? null });
    // An existing row the caller may not update (another household's, or any
    // row for a viewer) makes the DO UPDATE branch raise 42501.
    await tx`
      insert into public.recipes ${tx({ id, ...row })}
      on conflict (id) do update set ${tx(row)}`;
    return applied(op);
  }
  const parsed = recipePatchSchema.safeParse(candidate);
  if (!parsed.success) return rejected(op, 'invalid');
  const { id, ...fields } = parsed.data;
  const rows = await tx`
    update public.recipes set ${tx(columns(tx, fields))} where id = ${id} returning id`;
  // RLS hides rows the caller may not update, so "no row" covers both cases.
  return rows.length === 0 ? rejected(op, 'not_found_or_forbidden') : applied(op);
}

async function applyFavorite(
  tx: UserTx,
  op: Op,
  candidate: Record<string, unknown>,
): Promise<Result> {
  if (op.op === 'put') {
    const parsed = favoriteSchema.safeParse(candidate);
    if (!parsed.success) return rejected(op, 'invalid');
    const { id, ...fields } = parsed.data;
    const row = { ...fields, deleted_at: fields.deleted_at ?? null };
    // A second row for the same user and recipe violates the unique
    // constraint (23505) and is rejected like any refusal.
    await tx`
      insert into public.favorites ${tx({ id, ...row })}
      on conflict (id) do update set deleted_at = excluded.deleted_at`;
    return applied(op);
  }
  const parsed = favoritePatchSchema.safeParse(candidate);
  if (!parsed.success) return rejected(op, 'invalid');
  const rows = await tx`
    update public.favorites set deleted_at = ${parsed.data.deleted_at}
    where id = ${parsed.data.id} returning id`;
  return rows.length === 0 ? rejected(op, 'not_found_or_forbidden') : applied(op);
}

async function applyImport(
  tx: UserTx,
  op: Op,
  candidate: Record<string, unknown>,
): Promise<Result> {
  if (op.op === 'put') {
    const parsed = importPutSchema.safeParse(candidate);
    if (!parsed.success) return rejected(op, 'invalid');
    const { id, ...fields } = parsed.data;
    const row = { ...fields, deleted_at: fields.deleted_at ?? null };
    // A repeated put (a retried upload) changes nothing: an import's source
    // never changes, and a dismissal already made stays. DO UPDATE (not DO
    // NOTHING) so another household's row still raises 42501 under RLS.
    await tx`
      insert into public.imports ${tx({ id, ...row })}
      on conflict (id) do update
      set deleted_at = coalesce(public.imports.deleted_at, excluded.deleted_at)`;
    return applied(op);
  }
  const parsed = importPatchSchema.safeParse(candidate);
  if (!parsed.success) return rejected(op, 'invalid');
  const { id, ...fields } = parsed.data;
  const rows = await tx`update public.imports set ${tx(fields)} where id = ${id} returning id`;
  return rows.length === 0 ? rejected(op, 'not_found_or_forbidden') : applied(op);
}

async function applyPhoto(tx: UserTx, op: Op, candidate: Record<string, unknown>): Promise<Result> {
  if (op.op === 'put') {
    const parsed = photoPutSchema.safeParse(candidate);
    if (!parsed.success) return rejected(op, 'invalid');
    const { id, ...fields } = parsed.data;
    const row = { ...fields, deleted_at: fields.deleted_at ?? null };
    // As for imports: a retried put changes nothing, and a dismissal stays.
    // A page of another household's import breaks the composite foreign key
    // (23503) and is refused.
    await tx`
      insert into public.photos ${tx({ id, ...row })}
      on conflict (id) do update
      set deleted_at = coalesce(public.photos.deleted_at, excluded.deleted_at)`;
    return applied(op);
  }
  const parsed = photoPatchSchema.safeParse(candidate);
  if (!parsed.success) return rejected(op, 'invalid');
  const { id, ...fields } = parsed.data;
  const rows = await tx`update public.photos set ${tx(fields)} where id = ${id} returning id`;
  return rows.length === 0 ? rejected(op, 'not_found_or_forbidden') : applied(op);
}

async function applyShoppingItem(
  tx: UserTx,
  op: Op,
  candidate: Record<string, unknown>,
): Promise<Result> {
  if (op.op === 'put') {
    const parsed = shoppingItemPutSchema.safeParse(candidate);
    if (!parsed.success) return rejected(op, 'invalid');
    const { id, ...fields } = parsed.data;
    const [existing] = await tx`select 1 from public.shopping_items where id = ${id}`;
    if (!existing) {
      // FR-31 limit (spec §6): counted under RLS, so only the caller's household.
      const [{ live }] = await tx<{ live: number }[]>`
        select count(*)::int as live from public.shopping_items where deleted_at is null`;
      if (live >= SHOPPING_LIMITS.rows) return rejected(op, 'list_full');
    }
    const row = { ...fields, deleted_at: fields.deleted_at ?? null };
    await tx`
      insert into public.shopping_items ${tx({ id, ...row })}
      on conflict (id) do update set ${tx(row)}`;
    return applied(op);
  }
  const parsed = shoppingItemPatchSchema.safeParse(candidate);
  if (!parsed.success) return rejected(op, 'invalid');
  const { id, ...fields } = parsed.data;
  if (Object.keys(fields).length === 0) return applied(op);
  const rows =
    await tx`update public.shopping_items set ${tx(fields)} where id = ${id} returning id`;
  return rows.length === 0 ? rejected(op, 'not_found_or_forbidden') : applied(op);
}

async function applyAisleChoice(
  tx: UserTx,
  op: Op,
  candidate: Record<string, unknown>,
): Promise<Result> {
  if (op.op === 'put') {
    const parsed = aisleChoicePutSchema.safeParse(candidate);
    if (!parsed.success) return rejected(op, 'invalid');
    const { id, ...fields } = parsed.data;
    // Two phones choosing offline make two ids for one item: the key decides,
    // and the last save wins (plan ruling; spec §4 "derived id").
    await tx`
      insert into public.aisle_choices ${tx({ id, ...fields, deleted_at: fields.deleted_at ?? null })}
      on conflict (household_id, item_key) do update set aisle = excluded.aisle, deleted_at = excluded.deleted_at`;
    return applied(op);
  }
  const parsed = aisleChoicePatchSchema.safeParse(candidate);
  if (!parsed.success) return rejected(op, 'invalid');
  const rows =
    await tx`update public.aisle_choices set aisle = ${parsed.data.aisle} where id = ${parsed.data.id} returning id`;
  return rows.length === 0 ? rejected(op, 'not_found_or_forbidden') : applied(op);
}

type Apply = (tx: UserTx, op: Op, candidate: Record<string, unknown>) => Promise<Result>;
const APPLY: Record<string, Apply> = {
  recipes: applyRecipe,
  favorites: applyFavorite,
  imports: applyImport,
  photos: applyPhoto,
  shopping_items: applyShoppingItem,
  aisle_choices: applyAisleChoice,
};

async function applyOne(tx: UserTx, op: Op): Promise<Result> {
  if (!ALLOWED_TABLES.has(op.table)) return rejected(op, 'table_not_allowed');
  if (op.op === 'delete') return rejected(op, 'delete_not_allowed');
  const candidate = { ...(op.data ?? {}), id: op.id };
  return APPLY[op.table]!(tx, op, candidate);
}

/**
 * Applies ops in order inside the caller's transaction. Each op gets its own
 * savepoint, so a refused op is undone alone and its neighbours stand. Every
 * op is idempotent, so a client retry after a failed request is safe.
 */
export async function applyOps(tx: UserTx, ops: Op[]): Promise<Result[]> {
  const results: Result[] = [];
  for (const op of ops) {
    try {
      results.push((await tx.savepoint((savepoint) => applyOne(savepoint, op))) as Result);
    } catch (error) {
      if (!isRefusal(error)) throw error;
      results.push(rejected(op, 'forbidden'));
    }
  }
  return results;
}
